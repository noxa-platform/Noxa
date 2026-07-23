import { describe, it, expect, beforeEach, vi } from 'vitest';

// withReservedCredits: 全 AI ルート（約15本）が共有する「予約→本処理→失敗時 refund」の
// **唯一の money ロールバック配線**を executable spec 化する（Day67）。credits.ts の
// reserve/refund 単体は Day39/Day66 でカバー済みのため、ここでは両者を束ねるラッパの
// 分岐（不足で短絡・ack で確定・未 ack/throw で払い戻し）と、refund へ渡す消費内訳の
// 対称性（purchased から引いた分を月次に化けさせない）を固定する。

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), refund: vi.fn(), ledger: vi.fn() }));

vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));
// NextResponse.json を最小スタブ化（{__body,__status} で観測）
vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ __body: body, __status: init?.status ?? 200 }) },
}));

import { withReservedCredits } from '../../src/app/api/ai/with-credits';

// reserve 成功時の代表的な戻り（月次2+purchased3 を消費した内訳）
const RESERVED = { ok: true, remaining: 42, total: 50, consumedMonthly: 2, consumedPurchased: 3 };

describe('withReservedCredits（money ロールバック配線）', () => {
  beforeEach(() => {
    mocks.reserve.mockReset();
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset();
  });

  it('クレジット不足: 429 統一フォーマットで短絡し、本処理も refund も走らない', async () => {
    mocks.reserve.mockResolvedValue({ ok: false, remaining: 1, total: 50, consumedMonthly: 0, consumedPurchased: 0 });
    const handler = vi.fn();

    const r = (await withReservedCredits('u1', 5, handler)) as unknown as { __body: unknown; __status: number };
    expect(r.__status).toBe(429);
    expect(r.__body).toEqual({ error: 'AIクレジット不足', creditsRemaining: 1, requiredCredits: 5 });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('ack あり成功: handler の戻りを返し、ledger に (uid, feature, cost) を記録・refund なし', async () => {
    mocks.reserve.mockResolvedValue(RESERVED);

    const r = (await withReservedCredits(
      'u1',
      5,
      async ({ ack, remaining, total }) => {
        expect(remaining).toBe(42); // reserve の残数が ctx に渡る
        expect(total).toBe(50);
        ack();
        return { __body: { ok: true }, __status: 200 } as never;
      },
      'chat',
    )) as unknown as { __body: unknown; __status: number };

    expect(r.__body).toEqual({ ok: true });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.ledger).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).toHaveBeenCalledWith('u1', 'chat', 5);
  });

  it('feature 省略時は ledger の feature が既定の "ai"', async () => {
    mocks.reserve.mockResolvedValue(RESERVED);
    await withReservedCredits('u1', 3, async ({ ack }) => { ack(); return { __body: {}, __status: 200 } as never; });
    expect(mocks.ledger).toHaveBeenCalledWith('u1', 'ai', 3);
  });

  it('ack せず return: reserve の消費内訳どおりに refund し、ledger は記録しない（handler の戻りは素通し）', async () => {
    mocks.reserve.mockResolvedValue(RESERVED);

    // handler が 500 応答を組んで ack せず return（reserve 成功だが消費に至らないケース）
    const r = (await withReservedCredits('u1', 5, async () => ({ __body: 'no-ack', __status: 500 } as never))) as unknown as {
      __body: unknown;
      __status: number;
    };

    expect(r.__status).toBe(500);
    expect(r.__body).toBe('no-ack');
    expect(mocks.ledger).not.toHaveBeenCalled();
    // refund は (uid, cost, reserved) を受け取り、内訳(consumedMonthly/Purchased)を対称に戻せる
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith('u1', 5, RESERVED);
  });

  it('ack 前に throw: 内訳付きで refund し、例外はそのまま伝播（消費なしに巻き戻す）', async () => {
    mocks.reserve.mockResolvedValue(RESERVED);

    await expect(
      withReservedCredits('u1', 5, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');

    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith('u1', 5, RESERVED);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('ack 後に throw: 消費を確定したまま refund しない（例外は伝播・ledger は未到達＝best-effort の記録漏れは許容）', async () => {
    mocks.reserve.mockResolvedValue(RESERVED);

    await expect(
      withReservedCredits('u1', 5, async ({ ack }) => {
        ack(); // 消費確定
        throw new Error('after ack');
      }),
    ).rejects.toThrow('after ack');

    // ack 済みなので払い戻さない（二重課金でも過少払い戻しでもなく「使った通り」で確定）
    expect(mocks.refund).not.toHaveBeenCalled();
    // throw が logAiLedger 到達前に起きるため ledger は呼ばれない（監査ログの取りこぼしは許容仕様）
    expect(mocks.ledger).not.toHaveBeenCalled();
  });
});
