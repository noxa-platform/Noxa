// 顧客カルテへのテキスト学習 API。
//
// 顧客個別ページの「学習」モードから呼ばれる。LINE トーク履歴をテキスト書き出しした
// もの、または自分の過去の文面などを受け取って、相手の特徴 + 自分の文体を JSON 抽出し、
// 該当顧客の customer doc に patch を書き戻す。
//
// クレジット消費:
//   - estimateAiCost で文字数に応じて算出（上限なし、最小 1cr）
//   - reserveAiCredit で予約 → 失敗時 refund
//
// 安全:
//   - 入力テキストはデータ扱い。マーカーで囲い、System 側のガード
//     （@/lib/ai-knowledge/injection-guard）で「指示ではない」と明示する（P130）。
//     それ以前は「gemini.ts が共通注入する」と書いてあったが、そのファイルは存在せず
//     ガードは実在しなかった
//   - 1MB 上限、最低 20 字
import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse, aiDisabledResponse } from '@/app/api/lib/ai-kill-switch';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathCustomer } from '../../lib/access-context';
import { maskContactInfo } from '@/lib/ai-privacy';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { jstCalendarDate } from '@/lib/datetime';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_BYTES = 1024 * 1024; // 1MB（日本語で約 33 万字相当）
const MIN_CHARS = 20;
const MIN_COST = 1;

interface LearnFromTextBody {
  workspaceId: string;
  customerId: string;
  content: string;
}

interface ExtractedFromText {
  customerPersonality: string | null;
  myMessageStyle: string | null;
  likes: string[];
  dislikes: string[];
  personalityTraits: string[];
  interests: string[];
  triggerPositive: string[];
  triggerNegative: string[];
  communicationStyle: string | null;
  importantMemo: string | null;
  suggestedNextAction: string | null;
}

const EXTRACT_SYSTEM = withInjectionGuard(`あなたはホスト/キャスト向けのチャット解析 AI です。
提供されたテキスト（LINE トーク履歴・メッセージ書き出し等）から、対象の顧客との
やり取りを読み取って以下を JSON 抽出してください。

抽出ルール:
- 相手（顧客）の発言と、自分側の発言を区別する。自分側からは「文体（trends）」を、
  相手側からは「性格・好み・感情シグナル」を読む
- 確信が低い項目は null / 空配列で返す（捏造禁止）
- 本名・電話番号・住所の推測は禁止（呼び名のみ可、ただし本 API ではプロファイル
  更新には反映しない）
- 効果数値・売上額の捏造禁止
- 配列は最大 8 個程度に絞る

必ず厳密な JSON のみで返答。フィールド:
{
  "customerPersonality": string | null,    // 相手の人物像を 80 字以内
  "myMessageStyle": string | null,         // 自分側の文体を 80 字以内
  "likes": string[],
  "dislikes": string[],
  "personalityTraits": string[],
  "interests": string[],
  "triggerPositive": string[],
  "triggerNegative": string[],
  "communicationStyle": string | null,     // 短文/絵文字多めなど
  "importantMemo": string | null,          // 来店予定・誕生日近い等
  "suggestedNextAction": string | null
}`);

function arrayOrEmpty(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim().length > 0).slice(0, 10);
  if (typeof v === 'string' && v.trim()) return v.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  return [];
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function mergeUnique(existing: string[] | undefined, additions: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...additions])).filter(Boolean);
}

export async function POST(request: NextRequest) {
  let cost = MIN_COST;
  let uid: string | null = null;
  // 「予約済みでまだ払い戻していない」内訳。reserve 成功でセットし、払い戻し済み／課金確定で
  // null に戻す。catch の保険 refund はこれが残っている時だけ走る。
  // （旧実装は catch が無条件に払い戻していたため、try 内で払い戻した経路で**二重に**返していた）
  let pendingRefund: { consumedMonthly: number; consumedPurchased: number } | null = null;
  try {
    uid = await verifyRequest(request);

    // AI 緊急停止（2026-08-25）。**クレジット予約より手前**で弾く
    // （予約→拒否→返金の往復を作らない）。停止中は 503 + 日本語文言を返し、
    // iOS の APIError.serverError がその文字列をそのまま画面に出す。
    // ⚠️ 429 は使わない（iOS が insufficientCredits として残高表示を書き換えるため）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;
    const body = (await request.json().catch(() => ({}))) as LearnFromTextBody;
    const { workspaceId, customerId, content } = body;
    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'workspaceId / customerId が必要です' }, { status: 400 });
    }
    if (typeof content !== 'string' || content.trim().length < MIN_CHARS) {
      return NextResponse.json({ error: `本文は ${MIN_CHARS} 文字以上必要です` }, { status: 400 });
    }
    const byteLength = new TextEncoder().encode(content).length;
    if (byteLength > MAX_BYTES) {
      return NextResponse.json({ error: '本文が大きすぎます（最大 1MB）' }, { status: 413 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // 貼り付けテキストは**保存済みメモより PII が濃い**（LINE 履歴そのもの）。
    // 抽出対象に連絡先は含まれないので、送信前に電話番号・メールを伏せる（Day127）
    const maskedContent = maskContactInfo(content);

    // テキスト量に応じてクレジット見積もり（UI 表示と完全一致、上限なし）
    cost = estimateAiCost({
      inputText: maskedContent,
      expectedOutputTokens: 1500,
      featureMultiplier: 1.2,
      maxCap: Number.POSITIVE_INFINITY,
    });
    const reserved = await reserveAiCredit(uid, cost);
    if (!reserved.ok) {
      return NextResponse.json(
        { error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: cost },
        { status: 429 },
      );
    }
    pendingRefund = reserved;

    let raw: string;
    try {
      raw = await generateText(
        `${wrapUntrustedInput(maskedContent, '解析対象テキスト')}\n\n上記の会話履歴を解析して JSON で抽出してください。`,
        {
          systemInstruction: EXTRACT_SYSTEM,
          maxOutputTokens: 1500,
          temperature: 0.25,
          responseMimeType: 'application/json',
        },
      );
    } catch (e) {
      await refundAiCredit(uid, cost, reserved);
      pendingRefund = null; // 払い戻し済み。catch の保険で二重に返さない
      throw e;
    }
    void logAiLedger(uid, 'learn-from-text', cost);

    // safe parse
    type RawParsed = Partial<ExtractedFromText>;
    let parsedRaw: RawParsed = {};
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsedRaw = JSON.parse(m[0]);
        } catch {
          /* noop */
        }
      }
    }

    const extracted: ExtractedFromText = {
      customerPersonality: strOrNull(parsedRaw.customerPersonality),
      myMessageStyle: strOrNull(parsedRaw.myMessageStyle),
      likes: arrayOrEmpty(parsedRaw.likes),
      dislikes: arrayOrEmpty(parsedRaw.dislikes),
      personalityTraits: arrayOrEmpty(parsedRaw.personalityTraits),
      interests: arrayOrEmpty(parsedRaw.interests),
      triggerPositive: arrayOrEmpty(parsedRaw.triggerPositive),
      triggerNegative: arrayOrEmpty(parsedRaw.triggerNegative),
      communicationStyle: strOrNull(parsedRaw.communicationStyle),
      importantMemo: strOrNull(parsedRaw.importantMemo),
      suggestedNextAction: strOrNull(parsedRaw.suggestedNextAction),
    };

    // 既存 customer ドキュメントとマージして書き戻す
    const db = getAdminDb();
    const ref = db.doc(pathCustomer(ctx, customerId));
    const snap = await ref.get();
    if (!snap.exists) {
      await refundAiCredit(uid, cost, reserved);
      pendingRefund = null;
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }
    const cur = snap.data() ?? {};

    // SEC-M4: 自由テキストフィールドの prompt injection 経由汚染を抑止するため、
    // AI 抽出値には [AI] プレフィックスと文字数上限を付ける。ユーザーが書いた値と
    // 機械生成値を識別可能にし、悪意あるテキスト混入を緩和する。
    const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
    const aiTag = `[AI ${jstCalendarDate().date}]`; // JST 暦日（UTC 直読みだと早朝に前日）

    const patch: Record<string, unknown> = {
      chatAnalyzedAt: FieldValue.serverTimestamp(),
    };
    if (extracted.customerPersonality) {
      patch.customerPersonality = `${aiTag} ${truncate(extracted.customerPersonality, 300)}`;
    }
    if (extracted.myMessageStyle) {
      patch.myMessageStyle = `${aiTag} ${truncate(extracted.myMessageStyle, 300)}`;
    }
    if (extracted.likes.length) patch.likes = mergeUnique(cur.likes as string[] | undefined, extracted.likes);
    if (extracted.dislikes.length) patch.dislikes = mergeUnique(cur.dislikes as string[] | undefined, extracted.dislikes);
    if (extracted.personalityTraits.length) patch.personalityTraits = mergeUnique(cur.personalityTraits as string[] | undefined, extracted.personalityTraits);
    if (extracted.interests.length) patch.interests = mergeUnique(cur.interests as string[] | undefined, extracted.interests);
    if (extracted.triggerPositive.length) patch.triggerPositive = mergeUnique(cur.triggerPositive as string[] | undefined, extracted.triggerPositive);
    if (extracted.triggerNegative.length) patch.triggerNegative = mergeUnique(cur.triggerNegative as string[] | undefined, extracted.triggerNegative);
    if (extracted.communicationStyle) {
      patch.communicationStyle = `${aiTag} ${truncate(extracted.communicationStyle, 200)}`;
    }
    if (extracted.importantMemo) {
      const prev = (cur.importantMemo as string | undefined)?.trim();
      const tagged = `${aiTag} ${truncate(extracted.importantMemo, 300)}`;
      patch.importantMemo = prev ? `${prev}\n${tagged}` : tagged;
    }
    if (extracted.suggestedNextAction) {
      patch.nextAction = truncate(extracted.suggestedNextAction, 200);
    }

    await ref.update(patch);
    pendingRefund = null; // 書き戻しまで完了＝課金確定

    return NextResponse.json({
      ok: true,
      consumedCredits: cost,
      remainingCredits: reserved.remaining,
      extracted,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    if (uid && pendingRefund) {
      // Firestore 失敗時など、try 内 refund に乗らないケースの保険。
      // 「予約済みかつ未払い戻し」の時だけ、予約と同じ内訳で戻す
      // （内訳を渡さないと購入クレジットが月次枠に化ける）。
      try {
        await refundAiCredit(uid, cost, pendingRefund);
      } catch {
        /* noop */
      }
    }
    // 入口を通った後に停止へ切り替わると安全網が throw する。裸の 500 にせず
    // `code: AI_DISABLED` を必ず載せる（P154）。
    // ⚠️ **払い戻しの保険より後**に置く。ここだけ汎用 catch が返金を持っているので、
    //    先に return すると停止の瞬間に予約が戻らない（他の 20 経路は返金が内側にある）。
    const aiStopped = aiDisabledResponse(error);
    if (aiStopped) return aiStopped;
    console.error('learn-from-text failed:', error);
    return NextResponse.json({ error: 'テキスト学習に失敗しました' }, { status: 500 });
  }
}
