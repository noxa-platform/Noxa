import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/pos-config の POST（P129・NOXA 初の生成系 AI）。
//
// 日本語の要望 → 料金設定の**提案パッチ**。サーバは Firestore に一切書かない。
// 固定する挙動:
//   - 入力検証: workspaceId / requestText 必須・長すぎる入力・current 必須（reserve 前に短絡）
//   - 認可: 店舗の**オーナー限定**（member でも 403。キャストが自店の料金改定案を作れない）
//   - PII: 貼り付けテキストをマスクしてから送る（Day127）
//   - 検証: モデル出力は validateConfigPatch を通り、範囲外・対象外は落ちる
//   - 課金: 使える提案が出たときだけ ack（＝不正 JSON・提案ゼロは返金される Day67 契約）
//   - 生成物が JSON にならなければ 500 かつ ack しない

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), gen: vi.fn(), ack: vi.fn(), usage: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({ resolveAccessContext: mocks.resolve }));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 3 }));
vi.mock('@/app/api/lib/credits', () => ({ logAiUsage: mocks.usage }));
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string, _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 9 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/pos-config/route';
import { createDefaultStoreConfig } from '../../src/lib/pos/defaultConfig';
import { stripComments } from '../helpers/strip-comments';

const req = (body: unknown) => ({ json: async () => body }) as never;
const current = createDefaultStoreConfig('active', 'テスト店');
const okBody = { workspaceId: 'w1', requestText: '初回のセットを3000円に', current };

describe('ai/pos-config POST（AI 料金設定ビルダー）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'owner' });
    mocks.gen.mockReset().mockResolvedValue('{"initialPricing":{"set":3000}}');
    mocks.ack.mockReset();
    mocks.usage.mockReset();
  });

  describe('入力検証と認可', () => {
    it('workspaceId / requestText / current の欠落は 400（生成前に短絡）', async () => {
      expect((await POST(req({ requestText: 'x', current }))).status).toBe(400);
      expect((await POST(req({ workspaceId: 'w1', current }))).status).toBe(400);
      expect((await POST(req({ workspaceId: 'w1', requestText: '   ', current }))).status).toBe(400);
      expect((await POST(req({ workspaceId: 'w1', requestText: 'x' }))).status).toBe(400);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('長すぎる入力は 400（要約せずに弾く）', async () => {
      const res = await POST(req({ ...okBody, requestText: 'あ'.repeat(4001) }));
      expect(res.status).toBe(400);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('★オーナー以外は 403（キャストが自店の料金改定案を作れない）', async () => {
      mocks.resolve.mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'member' });
      expect((await POST(req(okBody))).status).toBe(403);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('個人ワークスペースは 403', async () => {
      mocks.resolve.mockResolvedValue({ kind: 'personal', uid: 'u1' });
      expect((await POST(req(okBody))).status).toBe(403);
    });

    it('認証失敗は 401', async () => {
      mocks.verify.mockRejectedValue(new AuthError('unauthorized'));
      expect((await POST(req(okBody))).status).toBe(401);
    });
  });

  describe('生成と検証', () => {
    it('★モデル出力を検証してパッチと採用項目を返す', async () => {
      const json = await (await POST(req(okBody))).json();
      expect(json.patch.initialPricing).toEqual({ ...current.initialPricing, set: 3000 });
      expect(json.accepted).toEqual(['initialPricing.set']);
      expect(json.acceptedLabels).toEqual(['初回料金・セット']);
      expect(mocks.ack).toHaveBeenCalled();
    });

    it('★範囲外・対象外の提案は落として理由を返す（黙って通さない）', async () => {
      mocks.gen.mockResolvedValue('{"initialPricing":{"set":3000},"dohanFee":-5,"menuItems":[{"name":"x","price":1}]}');
      const json = await (await POST(req(okBody))).json();
      expect(json.accepted).toEqual(['initialPricing.set']);
      expect(json.patch.dohanFee).toBeUndefined();
      expect(json.patch.menuItems).toBeUndefined();
      expect(json.rejected.map((r: { path: string }) => r.path).sort()).toEqual(['dohanFee', 'menuItems']);
    });

    it('★貼り付けテキストをマスクしてから送る（生の連絡先をモデルへ出さない）', async () => {
      await POST(req({ ...okBody, requestText: '料金の相談は 090-1234-5678 / tenchou@example.com まで。初回3000円' }));
      const prompt = mocks.gen.mock.calls[0][0] as string;
      expect(prompt).not.toContain('090-1234-5678');
      expect(prompt).not.toContain('tenchou@example.com');
      expect(prompt).toContain('初回3000円');
    });

    it('★現行設定のうち「AI が書ける項目」だけを送る（メニュー全件を送って原価を増やさない）', async () => {
      await POST(req(okBody));
      const prompt = mocks.gen.mock.calls[0][0] as string;
      expect(prompt).toContain('initialPricing');
      expect(prompt).not.toContain('menuItems');
      expect(prompt).not.toContain('tableNames');
      expect(prompt).not.toContain('halfOffRules');
    });

    it('★マークダウンで囲まれた JSON も読める（モデルの癖）', async () => {
      mocks.gen.mockResolvedValue('```json\n{"dohanFee": 5000}\n```');
      const json = await (await POST(req(okBody))).json();
      expect(json.patch.dohanFee).toBe(5000);
      expect(mocks.ack).toHaveBeenCalled();
    });

    it('★JSON として読めなければ 500 かつ ack しない（予約分は返金される）', async () => {
      mocks.gen.mockResolvedValue('料金の設定はお店ごとに違うので一概には言えません。');
      const res = await POST(req(okBody));
      expect(res.status).toBe(500);
      expect(mocks.ack).not.toHaveBeenCalled();
    });

    it('★採用ゼロを「成功」として ack しない（何も変わらないのに課金＋反映済みに見せない）', async () => {
      mocks.gen.mockResolvedValue('{"menuItems":[{"name":"x","price":1}]}');
      const res = await POST(req(okBody));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.accepted).toEqual([]);
      expect(json.message).toBeTruthy();          // 何が起きたかを言う
      expect(json.rejected.length).toBeGreaterThan(0);
      expect(mocks.ack).not.toHaveBeenCalled();
    });

    it('★現行と同じ値だけを返してきたら採用ゼロ（金額が動かないのに「変更しました」と出さない）', async () => {
      mocks.gen.mockResolvedValue(JSON.stringify({ dohanFee: current.dohanFee }));
      const json = await (await POST(req(okBody))).json();
      expect(json.accepted).toEqual([]);
      expect(mocks.ack).not.toHaveBeenCalled();
    });

    it('無料/有料に関わらず AI 原価を記録する（Day126）', async () => {
      await POST(req(okBody));
      expect(mocks.usage).toHaveBeenCalledWith('u1', 'pos-config');
    });

    it('サーバは提案を返すだけ（Firestore への書き込み経路を持たない）', () => {
      // 書き込みを持たないことはソースで担保する（モックで「呼ばれない」を見ても
      // 経路が増えたときに気づけない）
      const src = stripComments(require('node:fs').readFileSync('src/app/api/ai/pos-config/route.ts', 'utf8'));
      expect(src).not.toMatch(/getAdminDb|\.set\(|\.update\(|batch\(/);
    });
  });
});
