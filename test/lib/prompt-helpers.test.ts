import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveWorkspaceContext は Admin SDK を掴むので、doc(path).get() だけのフェイクを刺す
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/app/api/lib/firebase-admin', () => ({ getAdminDb: mocks.getDb }));

import { resolveWorkspaceContext } from '../../src/lib/ai-knowledge/prompt-helpers';
import {
  buildSelfBaseBlock,
  buildStoreProfileBlock,
  STORE_STYLE_MAX_CHARS,
  composePlaybookAndSelf,
  STRICT_RULES_BLOCK,
} from '../../src/lib/ai-knowledge/prompt-helpers';

// AI system プロンプトへ差し込むプロファイル/店舗ブロック生成の characterization。
// 空データで無駄なブロックを出さないこと・一人称の絶対遵守がプロファイルより上位に来ることを固定。

describe('buildSelfBaseBlock', () => {
  it('null・空データは空文字（プロンプトを汚さない）', () => {
    expect(buildSelfBaseBlock(null)).toBe('');
    expect(buildSelfBaseBlock(undefined)).toBe('');
    expect(buildSelfBaseBlock({})).toBe('');
  });

  it('設定済みフィールドを見出し付きで出す（一人称・源氏名を含む）', () => {
    const out = buildSelfBaseBlock({ stageName: 'ルナ', firstPerson: 'うち', defaultTone: 'フランク' });
    expect(out).toContain('## 自分のベース文体（必ず反映）');
    expect(out).toContain('ルナ');
    expect(out).toContain('うち');
    expect(out).toContain('フランク');
  });

  it('見出しは差し替え可能', () => {
    const out = buildSelfBaseBlock({ stageName: 'ルナ' }, '## 別見出し');
    expect(out).toContain('## 別見出し');
  });

  it('avgLength=0 は情報として出さない（falsy スキップ）', () => {
    expect(buildSelfBaseBlock({ avgLength: 0 })).toBe('');
  });

  it('gender は既知キーを和訳、未知キーは原文（female→女性 / vtuber→vtuber）', () => {
    expect(buildSelfBaseBlock({ gender: 'female' })).toContain('性別: 女性');
    expect(buildSelfBaseBlock({ gender: 'vtuber' })).toContain('性別: vtuber');
  });

  // Day95-PM: GENDER_LABELS[data.gender] はプロトタイプ経由でも解決するため、
  // gender='constructor' だと Object 関数が prompt に混入していた（insights と同型）。
  it('gender がプロトタイプ由来のキー（constructor）でも関数が混入しない', () => {
    const out = buildSelfBaseBlock({ gender: 'constructor' });
    expect(out).not.toContain('native code');
    expect(out).toContain('性別: constructor');
  });
});

describe('buildStoreProfileBlock', () => {
  it('null・シグナル無しは空文字', () => {
    expect(buildStoreProfileBlock(null)).toBe('');
    // storeType(enum) だけでは弱シグナル扱いで出さない（storeTypeName / name のどちらか必須）
    expect(buildStoreProfileBlock({ storeType: 'cabaret' })).toBe('');
  });

  it('事業 WS は「店舗名」、個人 WS は「ワークスペース名」で出す', () => {
    const biz = buildStoreProfileBlock({ name: 'ミラージュ', type: 'business', storeTypeName: '中小キャバ' });
    expect(biz).toContain('店舗名: ミラージュ');
    expect(biz).toContain('業種: 中小キャバ');
    const personal = buildStoreProfileBlock({ name: '自分の記録', type: 'personal', storeTypeName: 'フリー' });
    expect(personal).toContain('ワークスペース名: 自分の記録');
  });

  it('自由入力業種(storeTypeName)を enum(storeType)より優先して表示', () => {
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'メンズコンセプトカフェ', storeType: 'cabaret' });
    expect(out).toContain('業種: メンズコンセプトカフェ');
    expect(out).not.toContain('業種: cabaret');
  });

  // ▼ P164: チュートリアルで入力させているのに AI へ届いていなかった 2 項目
  it('🔴 店のルール・接客スタイル（selfBaseStyle）をプロンプトへ載せる', () => {
    // `NewWorkspaceTutorialView` の自由入力は shop doc 直下の `selfBaseStyle` に入る。
    // 🔴 `night-work-playbook` は「**必ず selfBaseStyle を最優先に反映**」とモデルに指示していたのに、
    // **値を渡していなかった**（利用者は入力させられ、モデルは守れと言われ、中身だけ無い状態）。
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'バー', selfBaseStyle: '同伴の話は自分から振らない' });
    expect(out).toContain('同伴の話は自分から振らない');
    expect(out).toContain('最優先で従う');
  });

  it('アップロードしたテキスト（aiProfile.textNotes）も載せる', () => {
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'バー', aiProfileNotes: ['[接客.txt]\n語尾は柔らかく'] });
    expect(out).toContain('語尾は柔らかく');
  });

  it('ルールだけ入力して名前も業種も空でも、ルールは届く', () => {
    // ⚠️ `minimalSignal` に足していないと、**入力したのに丸ごと出ない**（弱シグナル扱いで空文字）
    expect(buildStoreProfileBlock({ selfBaseStyle: '週末は同伴を優先' })).toContain('週末は同伴を優先');
  });

  it('🔴 上限で切ったときは「切れている」と本文に書く（黙って捨てない）', () => {
    const long = 'あ'.repeat(STORE_STYLE_MAX_CHARS + 50);
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'バー', selfBaseStyle: long });
    expect(out).toContain('上限');
    expect(out).toContain('推測で補わないこと');
    // 切ったうえで、切った分は入っていない
    expect(out.match(/あ/g)?.length).toBe(STORE_STYLE_MAX_CHARS);
  });

  it('上限以内なら「切れている」とは言わない（0 件と切り捨てを混ぜない）', () => {
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'バー', selfBaseStyle: '短いルール' });
    expect(out).not.toContain('上限');
  });

  it('電話番号はプロンプトに出さない（PII を AI へ渡さない）', () => {
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'バー', phoneNumber: '090-1234-5678' });
    expect(out).not.toContain('090-1234-5678');
    expect(out).not.toContain('090');
  });
});

describe('composePlaybookAndSelf — 合成順序', () => {
  it('STRICT_RULES_BLOCK を先頭に置き、以降にプレイブック・店舗・自己ブロックを連結', () => {
    const { combined, selfBlock, storeBlock } = composePlaybookAndSelf({
      storeType: 'host',
      selfData: { firstPerson: 'オレ' },
      storeProfile: { name: 'X', storeTypeName: 'ホストクラブ', type: 'business' },
    });
    // 一人称ガード（STRICT）が最優先＝先頭
    expect(combined.startsWith(STRICT_RULES_BLOCK)).toBe(true);
    // 自己ブロック・店舗ブロックが合成に含まれる
    expect(combined).toContain(selfBlock);
    expect(combined).toContain(storeBlock);
    // 店舗ブロックは自己ブロックより前（composePlaybookAndSelf の並び）
    expect(combined.indexOf(storeBlock)).toBeLessThan(combined.indexOf(selfBlock));
  });
});


// Day85（yorulog からの指摘・実測で確認）: shop 側の文体の正本は
// shop_shops/{shopId}/ai_profile/self だが、firestore.rules に ai_profile の定義が無く
// クライアントからは書けない。一方 iOS は personal_self_styles/{uid} 固定で書くため、
// 事業ワークスペースでは iOS で入れた源氏名・職種・文体が AI に一切届いていなかった。
describe('resolveWorkspaceContext — shop の文体フォールバック（Day85）', () => {
  const makeDb = (seed: Record<string, Record<string, unknown>>) => ({
    doc: (path: string) => ({
      get: async () => ({ exists: seed[path] !== undefined, data: () => seed[path] }),
    }),
  });
  const shopCtx = { kind: 'shop', shopId: 'ws1', uid: 'u1' } as never;

  beforeEach(() => mocks.getDb.mockReset());

  it('shop 側に文体が無ければ personal_self_styles/{uid} を使う', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      'shop_shops/ws1': { name: '店A', type: 'business' },
      'personal_self_styles/u1': { stageName: 'ルナ', firstPerson: 'うち' },
    }));
    const { selfData } = await resolveWorkspaceContext(shopCtx);
    expect(selfData?.stageName).toBe('ルナ');
    expect(selfData?.firstPerson).toBe('うち');
  });

  // 🔴 P164: **受け渡しの経路**を測る。
  // ここが無いと、`buildStoreProfileBlock` の単体テストが全部緑でも
  // 「**wsData から storeProfile へ渡していない**」регресを 1 つも捕まえられない
  //（実際、3 段目で受け渡しの 1 行を消しても既存テストは全部緑だった＝**今日直した欠陥そのものの形**）。
  it('🔴 チュートリアルの入力（selfBaseStyle / aiProfile.textNotes）が storeProfile まで届く', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      'shop_shops/ws1': {
        name: '店A', type: 'business', storeTypeName: 'バー',
        selfBaseStyle: '同伴の話は自分から振らない',
        aiProfile: { textNotes: ['[接客.txt]\n語尾は柔らかく'], imageRefs: ['gs://x/y.jpg'] },
      },
    }));
    const { storeProfile } = await resolveWorkspaceContext(shopCtx);
    expect(storeProfile?.selfBaseStyle).toBe('同伴の話は自分から振らない');
    expect(storeProfile?.aiProfileNotes).toEqual(['[接客.txt]\n語尾は柔らかく']);
    // ⚠️ 画像はまだ使わない（毎回 vision へ送ると単価が跳ねる）。渡っていないことも固定する
    expect(storeProfile as unknown as Record<string, unknown>).not.toHaveProperty('imageRefs');
    // 経路の出口まで見る（ブロックの中身に出ているか）
    expect(buildStoreProfileBlock(storeProfile)).toContain('同伴の話は自分から振らない');
  });

  it('textNotes に文字列以外が混ざっていても落とさない（型は Firestore が守らない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      'shop_shops/ws1': { name: '店A', aiProfile: { textNotes: ['ok', 42, null, { a: 1 }] } },
    }));
    const { storeProfile } = await resolveWorkspaceContext(shopCtx);
    expect(storeProfile?.aiProfileNotes).toEqual(['ok']);
  });

  it('shop 側に文体があればそちらを優先する（フォールバックで上書きしない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      'shop_shops/ws1': { name: '店A' },
      'shop_shops/ws1/ai_profile/self': { stageName: '店の設定' },
      'personal_self_styles/u1': { stageName: '個人の設定' },
    }));
    const { selfData } = await resolveWorkspaceContext(shopCtx);
    expect(selfData?.stageName).toBe('店の設定');
  });

  // doc が「存在するだけ」でフォールバックを止めると、空の shop 側が uid 側の実データを覆い隠す
  it('shop 側の doc が実質空（プロンプトに載る項目ゼロ）ならフォールバックする', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      'shop_shops/ws1': { name: '店A' },
      'shop_shops/ws1/ai_profile/self': { updatedAt: 'x' },
      'personal_self_styles/u1': { stageName: 'ルナ' },
    }));
    const { selfData } = await resolveWorkspaceContext(shopCtx);
    expect(selfData?.stageName).toBe('ルナ');
  });

  it('どちらも空なら null のまま（空ブロックを作らない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ 'shop_shops/ws1': { name: '店A' } }));
    const { selfData } = await resolveWorkspaceContext(shopCtx);
    expect(buildSelfBaseBlock(selfData)).toBe('');
  });

  it('personal ワークスペースの経路は従来どおり（shop を読みに行かない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ 'personal_self_styles/u9': { stageName: 'ソロ' } }));
    const { selfData, storeProfile } = await resolveWorkspaceContext({ kind: 'personal', uid: 'u9' } as never);
    expect(selfData?.stageName).toBe('ソロ');
    expect(storeProfile).toBeNull();
  });
});
