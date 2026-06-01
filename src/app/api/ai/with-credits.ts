// AI クレジット予約 + 自動 refund の共通ヘルパー。
//
// reserveAiCredit → 本処理 → 失敗時 refundAiCredit のパターンを各 AI API ルートで
// 重複実装していたのを、ここに集約する。本処理が throw した場合はもちろん、
// Firestore 書き戻し失敗など「reserve は成功したが消費に至らなかった」全ケースで
// 確実に refund される（finally で「ack されなければ refund」を実行）。
//
// 使い方:
//   const cost = estimateAiCost({ inputText: ..., ... });
//   return withReservedCredits(uid, cost, async ({ ack, remaining }) => {
//     const result = await callAi(...);
//     await db.update(...);
//     ack(); // 成功確定。これ以降に throw しても refund されない
//     return NextResponse.json({ result, creditsRemaining: remaining });
//   });
//
// ack() を呼ばずに return / throw すれば自動的に refund される。
import { NextResponse } from 'next/server';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../lib/credits';

export interface ReservedContext {
  remaining: number;
  total: number;
  /** クレジット消費を確定させる。これを呼んだ後の例外では refund されない */
  ack: () => void;
}

/**
 * 不足時のレスポンス。429 + creditsRemaining + requiredCredits を返す統一フォーマット。
 */
function insufficientCreditsResponse(remaining: number, required: number) {
  return NextResponse.json(
    {
      error: 'AIクレジット不足',
      creditsRemaining: remaining,
      requiredCredits: required,
    },
    { status: 429 },
  );
}

export async function withReservedCredits<T extends NextResponse>(
  uid: string,
  cost: number,
  handler: (ctx: ReservedContext) => Promise<T>,
  feature: string = 'ai',
): Promise<NextResponse> {
  const reserved = await reserveAiCredit(uid, cost);
  if (!reserved.ok) {
    return insufficientCreditsResponse(reserved.remaining, cost);
  }

  let acked = false;
  const ctx: ReservedContext = {
    remaining: reserved.remaining,
    total: reserved.total,
    ack: () => {
      acked = true;
    },
  };

  try {
    const result = await handler(ctx);
    // ack されたら Noxa 共通 v2 ledger に消費履歴を fire-and-forget で記録
    if (acked) {
      void logAiLedger(uid, feature, cost);
    }
    return result;
  } finally {
    if (!acked) {
      await refundAiCredit(uid, cost);
    }
  }
}
