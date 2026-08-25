// 記録エンジン段 7（P151）: AI がルールパック（項目 + 導出）を生成する。
//
// 正本の設計: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md` §2.5 / 決定事項 3。
//
// **サーバは Firestore に一切書かない。** 返すのは提案だけで、適用は人の操作
// （iOS が差分プレビューを出し、チェックしたものだけを適用 API へ送る）。
// P129（料金設定）・P148（記録項目）と同じ縛りで、「AI が勝手に設定を変えた」を構造的に作らない。
//
// **AI が書いた式をそのまま保存しない。** `validateRulePack` が段 6 の `parseExpr` を通し、
// 深さ・ノード数・演算子・**存在しない項目の参照**まで見て落とす。
// 生成物を信用しないのは、段 7 が「エンジンのコードを触らずに機能が増える」入口で、
// ここを素通しにすると**壊れた式が黙って本番の集計に居座る**ため。
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
import { parseRecordSchema } from '@/lib/record-engine/record-schema';
import { validateRulePack, MAX_PACK_FIELDS, MAX_PACK_DERIVATIONS } from '@/lib/record-engine/rule-pack';
import type { Expr } from '@/lib/record-engine/derivation';

const MAX_TEXT = 2000;

interface RulePackBody {
  workspaceId: string;
  businessType?: string;
  /** 「何を管理したいか」の自由文 */
  freeText?: string;
  /** 現行スキーマ（クライアントが購読済みのものを渡す。サーバは書かない＝提案の土台にのみ使う） */
  currentSchema?: unknown;
  /** 現行の導出（キーの衝突判定に使う） */
  currentDerivations?: { key: string; label: string; expr: Expr }[];
}

const SYSTEM_INSTRUCTION = withInjectionGuard(`あなたはナイトワーク店舗の記録の仕組みを設計する担当者です。
店の説明から、**記録する項目**と、そこから**計算して出す値**を JSON で提案してください。

厳守:
- **追加の提案だけ**。既存の項目・導出の改名・削除・並べ替えは返さない
- fields は最大 ${MAX_PACK_FIELDS} 件、derivations は最大 ${MAX_PACK_DERIVATIONS} 件。少なくてよい
- **key は英小文字で始まり、英小文字・数字・_ のみ 40 字まで**（例: bottle_count）。
  日本語や大文字は使わない。**label に日本語の表示名**を書く
- reason は日本語 1 行。「なぜこの店に要るのか」を書く。**理由の無いものは捨てられます**
- type は money / count / duration / when / period / grade / category / tags / ref / note のいずれか
- derivations の expr は**次の形だけ**。他の書き方は捨てられます:
  - {"lit": 数値}
  - {"field": "項目のkey"}
  - {"op": "+"|"-"|"*"|"/", "args": [式, 式]}
  - {"cmp": ">"|">="|"<"|"<="|"=="|"!=", "args": [式, 式]}  → 1 か 0 を返す
  - {"if": 式, "then": 式, "else": 式}
  - {"coalesce": [式, 式]}  → 左が計算できなければ右
- **式が参照してよいのは、既存の項目か、この提案で足す項目だけ**。無い項目を参照すると捨てられます
- 値が無いかもしれない項目を計算に使うときは {"coalesce": [{"field":"x"}, {"lit":0}]} と書く
  （**書かないと、その項目が空の記録では結果が「計算できない」になります**）
- 説明・前置き・マークダウンを書かない。JSON のみ

出力例:
{"fields":[{"key":"bottle_count","type":"count","label":"ボトル本数","roles":["bottle"],"reason":"シャンパンを推しているので本数で追える"}],"derivations":[{"key":"bottle_sales","label":"ボトル売上","expr":{"op":"*","args":[{"coalesce":[{"field":"bottle_unit_price"},{"lit":0}]},{"coalesce":[{"field":"bottle_count"},{"lit":0}]}]},"reason":"単価と本数から自動で出す"}]}`);

function digestSchema(fields: { key: string; type: string; label: string }[], derivKeys: string[]): string {
  const f = fields.slice(0, 60).map((x) => `${x.key}(${x.type}: ${x.label})`);
  return [
    `項目: ${f.length ? f.join(' / ') : '（なし）'}`,
    `導出: ${derivKeys.length ? derivKeys.slice(0, 30).join(' / ') : '（なし）'}`,
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // 停止スイッチは**クレジット予約より手前**（予約→拒否→返金の往復を作らない）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;

    const body = (await request.json().catch(() => ({}))) as RulePackBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const freeText = typeof body.freeText === 'string' ? body.freeText.trim() : '';
    const businessType = typeof body.businessType === 'string' ? body.businessType.trim().slice(0, 64) : '';
    if (!freeText && !businessType) {
      return NextResponse.json(
        { error: '何を管理したいかを一言でも書いてください（業態だけでも構いません）' },
        { status: 400 },
      );
    }
    if (freeText.length > MAX_TEXT) {
      return NextResponse.json({ error: `文章が長すぎます（${MAX_TEXT} 文字まで）` }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, body.workspaceId);
    // 記録の仕組みはワークスペース全体の形。店では owner 専用（P148 と同じ境界）
    if (ctx.kind === 'shop' && ctx.role !== 'owner') {
      return NextResponse.json({ error: '記録の仕組みの変更はオーナー専用です' }, { status: 403 });
    }

    // 現行スキーマもクライアント由来なので、そのまま信じずに検証を通してから使う
    const { schema: currentSchema } = parseRecordSchema(body.currentSchema);
    const currentDerivations = Array.isArray(body.currentDerivations) ? body.currentDerivations : [];
    const currentDerivKeys = currentDerivations
      .map((d) => (typeof d?.key === 'string' ? d.key : ''))
      .filter(Boolean);

    // 店長が書く想定だが、他店資料や顧客のメッセージが貼られることがある。
    // 出力先が**店全体の集計の切り口と計算式**である以上、指示として読ませない（P130）
    const maskedText = maskContactInfo(freeText);
    const userPrompt = [
      `# 業態\n${businessType || '（未指定）'}`,
      `# いまある項目と導出（これと重複しないものだけ提案する）\n${digestSchema(currentSchema.fields, currentDerivKeys)}`,
      maskedText ? wrapUntrustedInput(maskedText, '店の説明') : '',
      '上記をふまえて、追加する価値のある項目と導出だけを JSON で返してください。',
    ].filter(Boolean).join('\n\n');

    const cost = estimateAiCost({
      inputText: userPrompt,
      expectedOutputTokens: 1200, // 式を含むぶん schema-suggest より長い
      featureMultiplier: 1,
      maxCap: 8,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      void logAiUsage(uid, 'rule-pack');
      const raw = await generateText(userPrompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 1200,
        temperature: 0.3, // 式を作らせるので、ぶれは小さいほどよい
        responseMimeType: 'application/json',
      });

      const parsed = safeParseJson<unknown>(raw);
      if (parsed === null) {
        console.error('[api/ai/rule-pack] 生成物が JSON として読めず 500。raw head:', (raw ?? '').slice(0, 200));
        return NextResponse.json({ error: '記録の仕組みの提案に失敗しました' }, { status: 500 });
      }

      const result = validateRulePack(parsed, currentSchema, currentDerivKeys);
      if (result.accepted === 0) {
        // **提案ゼロを成功として返さない**。ack しないので予約分は返金される
        return NextResponse.json({
          pack: result.pack,
          rejected: result.rejected,
          message: 'いまの説明からは、追加した方がよい項目や計算を見つけられませんでした。'
            + '何を数えたいか・どう計算したいかを書くと提案しやすくなります。',
          creditsRemaining: remaining,
        });
      }

      ack();
      return NextResponse.json({
        pack: result.pack,
        rejected: result.rejected,
        creditsRemaining: remaining,
      });
    }, 'rule-pack');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('rule-pack failed:', error);
    return NextResponse.json({ error: '記録の仕組みの提案に失敗しました' }, { status: 500 });
  }
}
