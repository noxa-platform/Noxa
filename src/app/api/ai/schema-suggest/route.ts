// 記録エンジン Phase 0（P148）: 店の記録項目を AI が提案する。
//
// yorulog セッションからの依頼（ユーザー指示「それないと話にならない。それをメイン機能に
// したいレベル」）。段 5（`record_schema` + `x` マップ）へ進む前の足がかりで、
// **スキーマも firestore.rules も一切変更しない**——器（`customTags` / `customVisitTypes` /
// `optionalGoals`）は既にあるので、提案を返すだけで体験の核心が出る。
//
// **サーバは Firestore に一切書かない。** 提案までで、保存は既存の設定画面の操作。
// これは P129（料金設定ビルダー）と同じ縛りで、「AI が勝手に設定を変えた」状態を
// 構造的に作らないためにある。
//
// PII: 入力は店長が書く自由文（「シャンパンとチェキを推してる」等）。顧客のフリーテキストを
// 載せる経路ではないが、**貼り付けテキストである以上マスクを通す**（Day127 の教訓＝
// 「書込み側だから免除」という分類の前提が実態と違っていた）。項目名の提案に連絡先は要らない。
import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse } from '@/app/api/lib/ai-kill-switch';
import { logAiUsage } from '@/app/api/lib/credits';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { generateText } from '../ai-provider';
import { withReservedCredits } from '../with-credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { maskContactInfo } from '@/lib/ai-privacy';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { safeParseJson } from '@/lib/ai-knowledge/safe-json';
import {
  validateSchemaSuggestion, SUGGEST_UNITS, MAX_PER_CATEGORY, MAX_NAME_LENGTH, MAX_REASON_LENGTH,
  type ExistingSchema,
} from '@/lib/record-engine/schema-suggest';

/** 店の説明文。長文の貼り付けは提案の質を上げないので入口で弾く */
const MAX_TEXT = 2000;
/** 既存項目の同梱数。これを超える分は重複判定にだけ使い、プロンプトには載せない */
const MAX_EXISTING_IN_PROMPT = 40;

interface SchemaSuggestBody {
  workspaceId: string;
  /** 業態（girls_bar 等）。未知の値でも落とさず、そのまま文脈として渡す */
  businessType?: string;
  /** 店の説明・要望の自由文 */
  freeText?: string;
  existing?: ExistingSchema;
}

const SYSTEM_INSTRUCTION = withInjectionGuard(`あなたはナイトワーク店舗の記録項目を設計する担当者です。
店の説明から、その店で**記録する価値のある項目**を JSON で提案してください。

厳守:
- **追加の提案だけ**を返す。既存項目の改名・削除・並べ替えは返さない
- 既存項目と**同じ意味のもの**は返さない（表記が違うだけのものも返さない）
- 各カテゴリ最大 ${MAX_PER_CATEGORY} 件。少なくてよい。**思いつかないカテゴリは空配列**
- 項目名は ${MAX_NAME_LENGTH} 文字以内。店の人がそのまま画面で見る言葉にする
- reason は**日本語 1 行・${MAX_REASON_LENGTH} 文字以内**。「なぜこの店に要るのか」を書く。
  一般論（「管理に便利です」等）は書かない。**理由の無い提案は捨てられます**
- optionalGoals の unit は ${SUGGEST_UNITS.join(' / ')} のいずれか。他の値は返さない
- monthlyTarget は整数。店の規模が読み取れないなら**省略する**（0 を返さない）
- 説明・前置き・マークダウンを書かない。JSON のみ

カテゴリの意味:
- customTags = 顧客に付ける札（「チェキ好き」「シャンパン入れる人」）。**人の性質**
- customVisitTypes = 来店の区分（「場内指名」「同伴」）。**来店 1 回の種類**
- optionalGoals = 数える対象（「チェキ」「シャンパン本数」）。売上とは別に集計される
  - toggle = 有無だけ / count = 件数 / amount = 金額 / countAndAmount = 件数と金額の両方

出力例:
{"customTags":[{"name":"チェキ好き","reason":"推し施策の対象を絞れる"}],"customVisitTypes":[],"optionalGoals":[{"name":"チェキ","unit":"count","monthlyTarget":50,"reason":"推している施策なので枚数で追える"}]}`);

/** プロンプトに載せる既存項目。件数を絞る（全件載せても提案は良くならず原価だけ増える） */
function digestExisting(existing: ExistingSchema | undefined): string {
  const names = (raw: unknown, pick: (v: unknown) => unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => pick(v))
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .slice(0, MAX_EXISTING_IN_PROMPT);
  };
  const tags = names(existing?.customTags, (v) => (typeof v === 'string' ? v : (v as { name?: unknown })?.name));
  const visits = names(existing?.customVisitTypes, (v) => (typeof v === 'string' ? v : (v as { name?: unknown })?.name));
  const goals = names(existing?.optionalGoals, (v) => (v as { name?: unknown })?.name);
  return [
    `customTags: ${tags.length ? tags.join(' / ') : '（なし）'}`,
    `customVisitTypes: ${visits.length ? visits.join(' / ') : '（なし）'}`,
    `optionalGoals: ${goals.length ? goals.join(' / ') : '（なし）'}`,
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // AI 緊急停止。**クレジット予約より手前**で弾く（予約→拒否→返金の往復を作らない）。
    // 停止中は 503 + code: AI_DISABLED。⚠️ 429 は使わない（iOS が残高不足として扱う）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;

    const body = (await request.json().catch(() => ({}))) as SchemaSuggestBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const freeText = typeof body.freeText === 'string' ? body.freeText.trim() : '';
    const businessType = typeof body.businessType === 'string' ? body.businessType.trim().slice(0, 64) : '';
    if (!freeText && !businessType) {
      return NextResponse.json(
        { error: 'お店のことを一言でも書いてください（業態だけでも構いません）' },
        { status: 400 },
      );
    }
    if (freeText.length > MAX_TEXT) {
      return NextResponse.json({ error: `文章が長すぎます（${MAX_TEXT} 文字まで）` }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, body.workspaceId);
    // 記録項目はワークスペース全体の形を変えるものなので、店ではオーナー専用にする
    // （キャストが勝手に来店区分を増やすと、店全体の集計の切り口が変わる）。
    // 個人ワークスペースは本人しか居ないので resolveAccessContext を通れば十分。
    if (ctx.kind === 'shop' && ctx.role !== 'owner') {
      return NextResponse.json({ error: '記録項目の変更はオーナー専用です' }, { status: 403 });
    }

    // 店長が書く想定だが、他店資料や顧客のメッセージが貼られることがある。
    // 出力先が**店全体の集計の切り口**である以上、指示として読ませない（P130）
    const maskedText = maskContactInfo(freeText);
    const userPrompt = [
      `# 業態\n${businessType || '（未指定）'}`,
      `# いまある項目（これと重複しないものだけ提案する）\n${digestExisting(body.existing)}`,
      maskedText ? wrapUntrustedInput(maskedText, '店の説明') : '',
      '上記をふまえて、追加する価値のある項目だけを JSON で返してください。',
    ].filter(Boolean).join('\n\n');

    const cost = estimateAiCost({
      inputText: userPrompt,
      expectedOutputTokens: 700, // 3 カテゴリ × 最大 10 件 + 理由
      featureMultiplier: 1,
      maxCap: 6,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      // 生成系は有料方針だが価格の確定は人間ゲート。原価の記録だけ先に通す（Day126）
      void logAiUsage(uid, 'schema-suggest');
      const raw = await generateText(userPrompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 700,
        temperature: 0.4, // 語彙の幅は要るが、業態から外れた提案は困る
        responseMimeType: 'application/json',
      });

      const parsed = safeParseJson<unknown>(raw);
      if (parsed === null) {
        // 生成物を残す（Day116-PM）。ack せず return して予約分を返金させる
        console.error('[api/ai/schema-suggest] 生成物が JSON として読めず 500。raw head:', (raw ?? '').slice(0, 200));
        return NextResponse.json({ error: '記録項目の提案に失敗しました' }, { status: 500 });
      }

      const result = validateSchemaSuggestion(parsed, body.existing);
      if (result.accepted === 0) {
        // **提案ゼロを成功として返さない**。何も出ていないのに消費だけ確定すると、
        // ユーザーは「AI が考えてくれた」と思ったまま何も得ていない状態になる。
        // ack しないので予約分は返金される
        return NextResponse.json({
          suggestion: result.suggestion,
          rejected: result.rejected,
          message: 'いまの説明からは、追加した方がよい項目を見つけられませんでした。'
            + 'お店で何を推しているか・何を数えたいかを書くと提案しやすくなります。',
          creditsRemaining: remaining,
        });
      }

      ack(); // 使える提案が出た＝消費確定
      return NextResponse.json({
        suggestion: result.suggestion,
        rejected: result.rejected,
        creditsRemaining: remaining,
      });
    }, 'schema-suggest');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('schema-suggest failed:', error);
    return NextResponse.json({ error: '記録項目の提案に失敗しました' }, { status: 500 });
  }
}
