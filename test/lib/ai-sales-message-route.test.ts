import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/sales-message の POST を LLM モック＋クレジットモックで検証する（Day103）。
//
// このルートは iOS `AIService.salesMessage`（LINE 連続送信の一括ドラフト生成）専用の
// 薄いラッパーで、Web からの呼び出しが無いためゼロカバレッジだった。
// 本テストで固定する不変条件:
//   - 🔐 PII: customerName / context / hint は AI へ渡る前に maskContactInfo を通る
//     （iOS は context 未指定時に `customer.importantMemo` を既定で詰める＝Day12 のマスク対象。
//       サーバが顧客 doc を読まないため Day99 の静的ガードから漏れていた実バグ）
//   - reserve / refund の対称性（失敗経路では必ず戻す・成功経路では戻さない）
//   - LLM 出力のパース契約（JSON 配列 / 非配列 / 非 JSON フォールバック / 空）

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), gen: vi.fn(), reserve: vi.fn(), refund: vi.fn(), ledger: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/sales-message/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
/** JSON パース自体が失敗するリクエスト（route 側は catch して {} 扱い） */
const brokenReq = () => ({ json: async () => { throw new Error('bad json'); } }) as never;
const okReserve = { ok: true, remaining: 4, total: 10, consumedMonthly: 6, consumedPurchased: 0 };
/** generateText に渡った prompt（第1引数） */
const lastPrompt = () => String(mocks.gen.mock.calls.at(-1)?.[0] ?? '');

describe('ai/sales-message POST（営業メッセージ生成）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.gen.mockReset().mockResolvedValue('["案1","案2","案3"]');
    mocks.reserve.mockReset().mockResolvedValue(okReserve);
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset();
  });

  describe('入力検証と認可', () => {
    it('customerName 欠落は 400（reserve 前に短絡）', async () => {
      const res = await POST(req({ context: '背景' }));
      expect(res.status).toBe(400);
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('customerName が空白のみも 400（trim 後の判定）', async () => {
      expect((await POST(req({ customerName: '　  ' }))).status).toBe(400);
      expect(mocks.reserve).not.toHaveBeenCalled();
    });

    it('body が JSON として壊れていても 500 にせず 400', async () => {
      expect((await POST(brokenReq())).status).toBe(400);
    });

    it('認証失敗（AuthError）は 401・課金に到達しない', async () => {
      mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(401);
      expect(mocks.reserve).not.toHaveBeenCalled();
    });
  });

  describe('🔐 PII マスク（Day12 ポリシー / Day103 で是正した実バグ）', () => {
    it('context の電話番号・メールは伏字化されてから AI へ渡る', async () => {
      // iOS は context 未指定時に customer.importantMemo を詰める（＝この形の文字列が来る）
      await POST(req({
        customerName: 'あい',
        context: '常連。連絡先 090-1234-5678 / taro@example.com。同伴多め',
      }));
      const prompt = lastPrompt();
      expect(prompt).not.toContain('090-1234-5678');
      expect(prompt).not.toContain('taro@example.com');
      expect(prompt).toContain('[電話番号非表示]');
      expect(prompt).toContain('[メール非表示]');
      expect(prompt).toContain('同伴多め'); // 文脈自体は残す（機能を殺さない）
    });

    it('全角で書かれた電話番号（０９０−…）も NFKC 正規化して伏字化する', async () => {
      await POST(req({ customerName: 'あい', context: 'ＴＥＬ ０９０−１２３４−５６７８' }));
      expect(lastPrompt()).toContain('[電話番号非表示]');
      expect(lastPrompt()).not.toContain('０９０'); // 全角のまま素通ししない
    });

    it('hint（ユーザー入力）と customerName（名前欄）にも同じ基準を適用する', async () => {
      await POST(req({
        customerName: '太郎 090-1111-2222',
        context: '',
        hint: '折り返しは 080-3333-4444 へ',
      }));
      const prompt = lastPrompt();
      expect(prompt).not.toContain('090-1111-2222');
      expect(prompt).not.toContain('080-3333-4444');
      expect(prompt).toContain('太郎');
    });

    it('内線・金額など 10 桁未満の数字はマスクしない（誤爆させない）', async () => {
      await POST(req({ customerName: 'あい', context: '前回 12000 円・内線 1234' }));
      const prompt = lastPrompt();
      expect(prompt).toContain('12000');
      expect(prompt).toContain('1234');
      expect(prompt).not.toContain('[電話番号非表示]');
    });
  });

  describe('プロンプト構成', () => {
    it('context / hint 未指定なら該当行を出さない（空行だけの背景を作らない）', async () => {
      await POST(req({ customerName: 'あい' }));
      const prompt = lastPrompt();
      expect(prompt).toContain('顧客名: あい');
      expect(prompt).not.toContain('背景:');
      expect(prompt).not.toContain('追加の指示:');
    });

    it('context / hint があれば両方載る', async () => {
      await POST(req({ customerName: 'あい', context: '誕生日が近い', hint: 'カジュアルめ' }));
      const prompt = lastPrompt();
      expect(prompt).toContain('背景: 誕生日が近い');
      expect(prompt).toContain('追加の指示: カジュアルめ');
    });

    it('JSON 応答を要求し、3 パターン生成の system instruction を渡す', async () => {
      await POST(req({ customerName: 'あい' }));
      const opts = mocks.gen.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(opts.responseMimeType).toBe('application/json');
      expect(String(opts.systemInstruction)).toContain('3 パターン');
    });
  });

  describe('クレジットの予約・返却の対称性', () => {
    it('残高不足（reserve.ok=false）は 429・generateText 未呼び出し・必要数を返す', async () => {
      mocks.reserve.mockResolvedValue({ ...okReserve, ok: false, remaining: 0 });
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.creditsRemaining).toBe(0);
      expect(body.requiredCredits).toBeGreaterThan(0);
      expect(mocks.gen).not.toHaveBeenCalled();
      expect(mocks.refund).not.toHaveBeenCalled(); // 確保していないので戻さない
    });

    it('成功時は ledger に記録し refund しない（消費確定）', async () => {
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ drafts: ['案1', '案2', '案3'], creditsRemaining: 4 });
      expect(mocks.ledger).toHaveBeenCalledWith('u1', 'sales-message', expect.any(Number));
      expect(mocks.refund).not.toHaveBeenCalled();
    });

    it('generateText が失敗したら確保分を戻してから 500（取りっぱぐれ防止）', async () => {
      mocks.gen.mockRejectedValue(new Error('provider down'));
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(500);
      expect(mocks.refund).toHaveBeenCalledWith('u1', expect.any(Number), okReserve);
      expect(mocks.ledger).not.toHaveBeenCalled();
    });

    it('返却額は予約額と同額（差額を抜き取らない）', async () => {
      mocks.gen.mockRejectedValue(new Error('provider down'));
      await POST(req({ customerName: 'あい', context: 'そこそこ長い背景テキスト'.repeat(20) }));
      const reservedCost = mocks.reserve.mock.calls[0][1];
      expect(mocks.refund.mock.calls[0][1]).toBe(reservedCost);
    });
  });

  describe('LLM 出力のパース契約', () => {
    it('JSON 配列内の空文字・非文字列は落とす', async () => {
      mocks.gen.mockResolvedValue('["案1","   ",42,null,"案2"]');
      const res = await POST(req({ customerName: 'あい' }));
      expect((await res.json()).drafts).toEqual(['案1', '案2']);
    });

    it('非 JSON のプレーンテキストは 1 件のドラフトとして採用（生成は無駄にしない）', async () => {
      mocks.gen.mockResolvedValue('こんばんは、あいです✨');
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(200);
      expect((await res.json()).drafts).toEqual(['こんばんは、あいです✨']);
      expect(mocks.refund).not.toHaveBeenCalled();
    });

    it('JSON だが配列でない（オブジェクト）→ 0 件なので返金して 500', async () => {
      mocks.gen.mockResolvedValue('{"message":"むり"}');
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(500);
      expect(mocks.refund).toHaveBeenCalledTimes(1);
      expect(mocks.ledger).not.toHaveBeenCalled();
    });

    it('空文字・空白のみの応答は返金して 500（0 件を成功にしない）', async () => {
      mocks.gen.mockResolvedValue('   ');
      const res = await POST(req({ customerName: 'あい' }));
      expect(res.status).toBe(500);
      expect(mocks.refund).toHaveBeenCalledTimes(1);
    });

    it('空配列も返金して 500', async () => {
      mocks.gen.mockResolvedValue('[]');
      expect((await POST(req({ customerName: 'あい' }))).status).toBe(500);
      expect(mocks.refund).toHaveBeenCalledTimes(1);
    });
  });
});
