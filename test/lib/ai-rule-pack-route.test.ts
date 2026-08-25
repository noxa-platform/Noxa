import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/rule-pack の POST（P151・記録エンジン段 7）。
//
// 店の説明 → 項目 + 導出の**追加提案**。サーバは Firestore に一切書かない。
// 固定する挙動:
//   - 入力検証・認可（店舗は owner 限定）は P148 と同じ境界
//   - **AI が書いた式をそのまま返さない**。段 6 の parseExpr を通し、
//     存在しない項目を参照する式も落とす
//   - 課金: 使える提案が出たときだけ ack（提案ゼロ・不正 JSON は返金）

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), gen: vi.fn(), ack: vi.fn(), usage: vi.fn(), schemaGet: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
  // ⚠️ 現行スキーマは**サーバが読む**（P153-PM22）。クライアント申告だと、
  // 読めなかったときに「項目なし」と区別が付かず、既にある項目を新規として提案してしまう
  getAdminDb: () => ({ doc: () => ({ get: mocks.schemaGet }) }),
}));
vi.mock('../../src/app/api/lib/access-context', () => ({ resolveAccessContext: mocks.resolve }));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 5 }));
vi.mock('@/app/api/lib/credits', () => ({ logAiUsage: mocks.usage }));
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string, _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 20 }),
}));

import { POST } from '../../src/app/api/ai/rule-pack/route';

const req = (body: unknown) => ({ json: async () => body }) as never;

const GOOD = JSON.stringify({
  fields: [
    { key: 'bottle_count', type: 'count', label: 'ボトル本数', roles: ['bottle'], reason: 'シャンパンを推しているため' },
    { key: 'unit_price', type: 'money', label: '単価', roles: [], reason: '本数から売上を出すため' },
  ],
  derivations: [{
    key: 'bottle_sales', label: 'ボトル売上',
    expr: { op: '*', args: [{ field: 'unit_price' }, { field: 'bottle_count' }] },
    reason: '単価と本数から自動で出す',
  }],
});

const okBody = { workspaceId: 'w1', businessType: 'girls_bar', freeText: 'シャンパンを推してる' };

describe('ai/rule-pack POST（AI がルールパックを生成）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'owner' });
    mocks.gen.mockReset().mockResolvedValue(GOOD);
    mocks.ack.mockReset();
    mocks.usage.mockReset();
    mocks.schemaGet.mockReset().mockResolvedValue({ exists: false, data: () => undefined });
  });

  describe('入力検証と認可', () => {
    it('workspaceId 欠落は 400（生成前に短絡）', async () => {
      expect((await POST(req({ freeText: 'x' }))).status).toBe(400);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('業態も説明も無ければ 400', async () => {
      expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('長すぎる説明は 400', async () => {
      expect((await POST(req({ ...okBody, freeText: 'あ'.repeat(2001) }))).status).toBe(400);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('店舗の member は 403（オーナー限定）', async () => {
      mocks.resolve.mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'member' });
      expect((await POST(req(okBody))).status).toBe(403);
      expect(mocks.gen).not.toHaveBeenCalled();
    });

    it('個人ワークスペースは本人なら通る', async () => {
      mocks.resolve.mockResolvedValue({ kind: 'personal', uid: 'u1' });
      expect((await POST(req(okBody))).status).toBe(200);
    });
  });

  describe('プロンプトの組み立て', () => {
    it('説明文はマスクしてから送る', async () => {
      await POST(req({ ...okBody, freeText: '連絡は 090-1234-5678 まで。シャンパン推し' }));
      const prompt = mocks.gen.mock.calls[0][0] as string;
      expect(prompt).not.toContain('090-1234-5678');
      expect(prompt).toContain('シャンパン推し');
    });

    it('現行スキーマは**サーバが読み**、保存済みの壊れた項目は検証で落とす', async () => {
      mocks.schemaGet.mockResolvedValue({
        exists: true,
        data: () => ({ fields: [
          { key: 'sales', type: 'money', label: '売上' },
          { key: 'ボトル', type: 'count', label: '不正キー' }, // 検証で落ちる
        ] }),
      });
      await POST(req(okBody));
      const prompt = mocks.gen.mock.calls[0][0] as string;
      expect(prompt).toContain('sales');
      expect(prompt).not.toContain('ボトル(');
    });

    // ⚠️ クライアントが「項目なし」と申告しても、**サーバが読んだ実体が優先**される。
    // 旧実装はクライアント申告を土台にしており、**端末がスキーマを読めなかっただけ**なのに
    // 「このお店には項目が 1 つも無い」と AI に伝わっていた。結果、既にある項目を新規として
    // 提案し、承認画面では**既存の項目まで「追加」に見える**（段 7 は人が差分を見て承認する
    // 設計なので、承認の材料が事実と違うのが実害）。yorulog が iOS で同型を踏んだ（`156040c`）
    it('クライアントが currentSchema を送ってこなくても、保存済みの項目は重複判定に効く', async () => {
      mocks.schemaGet.mockResolvedValue({
        exists: true,
        data: () => ({ fields: [{ key: 'bottle_count', type: 'count', label: '既存' }] }),
      });
      const j = await (await POST(req(okBody))).json(); // currentSchema を送らない
      expect(j.pack.fields.map((f: { key: string }) => f.key)).toEqual(['unit_price']);
      expect(j.rejected.map((x: { reason: string }) => x.reason)).toContain('既にある項目です');
    });

    it('クライアントの申告は無視される（嘘の currentSchema を送っても実体で判定する）', async () => {
      mocks.schemaGet.mockResolvedValue({
        exists: true,
        data: () => ({ fields: [{ key: 'bottle_count', type: 'count', label: '既存' }] }),
      });
      const j = await (await POST(req({ ...okBody, currentSchema: { fields: [] } }))).json();
      expect(j.pack.fields.map((f: { key: string }) => f.key)).toEqual(['unit_price']);
    });
  });

  describe('出力の検証と課金', () => {
    it('提案が出たら 200 + ack', async () => {
      const r = await POST(req(okBody));
      const j = await r.json();
      expect(r.status).toBe(200);
      expect(j.pack.fields.map((f: { key: string }) => f.key)).toEqual(['bottle_count', 'unit_price']);
      expect(j.pack.derivations[0].key).toBe('bottle_sales');
      expect(j.creditsRemaining).toBe(20);
      expect(mocks.ack).toHaveBeenCalled();
    });

    // AI 生成物をそのまま保存させない。ここが段 7 のいちばん危ない入口
    it('不正な式の導出は落として理由を返す', async () => {
      mocks.gen.mockResolvedValue(JSON.stringify({
        derivations: [{ key: 'bad', label: 'B', expr: { op: '**', args: [{ lit: 1 }, { lit: 2 }] }, reason: 'x' }],
      }));
      const j = await (await POST(req(okBody))).json();
      expect(j.pack.derivations).toEqual([]);
      expect(j.rejected[0].reason).toContain('式が不正です');
      expect(mocks.ack).not.toHaveBeenCalled();
    });

    it('存在しない項目を参照する式は落とす（適用しても永久に null を返すため）', async () => {
      mocks.gen.mockResolvedValue(JSON.stringify({
        derivations: [{ key: 'x1', label: 'X', expr: { field: 'nope' }, reason: 'y' }],
      }));
      const j = await (await POST(req(okBody))).json();
      expect(j.pack.derivations).toEqual([]);
      expect(j.rejected[0].reason).toContain('nope');
    });

    it('既存スキーマと重複するキーは落とす（追加のみ）', async () => {
      mocks.schemaGet.mockResolvedValue({
        exists: true,
        data: () => ({ fields: [{ key: 'bottle_count', type: 'count', label: '既存' }] }),
      });
      const j = await (await POST(req(okBody))).json();
      expect(j.pack.fields.map((f: { key: string }) => f.key)).toEqual(['unit_price']);
      expect(j.rejected.map((x: { reason: string }) => x.reason)).toContain('既にある項目です');
    });

    // ⚠️ 導出も同じ doc から**サーバが読む**。クライアント申告だと、読めなかったときに
    // 「導出は 1 つも無い」に化けて**キーの衝突判定が素通りする**（既存の式を上書きしてしまう）
    it('現行の導出キーと衝突するものも落とす（保存済みの導出を読む）', async () => {
      mocks.schemaGet.mockResolvedValue({
        exists: true,
        data: () => ({
          fields: [],
          derivations: [{ key: 'bottle_sales', label: '既存', expr: { lit: 1 } }],
        }),
      });
      const j = await (await POST(req(okBody))).json();
      expect(j.pack.derivations).toEqual([]);
    });

    it('提案ゼロは 200 だが ack しない（返金される）', async () => {
      mocks.gen.mockResolvedValue(JSON.stringify({ fields: [], derivations: [] }));
      const j = await (await POST(req(okBody))).json();
      expect(j.message).toContain('見つけられませんでした');
      expect(mocks.ack).not.toHaveBeenCalled();
    });

    it('JSON にならない生成物は 500 かつ ack しない', async () => {
      mocks.gen.mockResolvedValue('すみません');
      expect((await POST(req(okBody))).status).toBe(500);
      expect(mocks.ack).not.toHaveBeenCalled();
    });

    it('原価の記録は生成前に通す', async () => {
      await POST(req(okBody));
      expect(mocks.usage).toHaveBeenCalledWith('u1', 'rule-pack');
    });
  });
});
