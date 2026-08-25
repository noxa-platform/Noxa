import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// AI route 全体の PII マスク網羅ガード（Day99）。
//
// Day12 で「顧客のフリーテキストを AI プロバイダへ送る前に電話/メールをマスクする」
// ポリシーを定めたが、実際には ai/chat と ai/message にしか適用されておらず、
// insights / briefing / message/reply / customer-infer-profile は素通しだった（Day99 で是正）。
// 原因は「新しい AI route を足すときにマスクを付け忘れても誰も気づかない」こと。
//
// このテストは route を静的に走査して分類漏れを落とす:
//   - 顧客のフリーテキスト（likesNote / ngNote / importantMemo / chatHistory 等）を扱う route は
//     必ず MASKED（マスクして AI へ送る）か WRITE_ONLY（AI へ送らず書き込むだけ）に分類されている
//   - MASKED に載っている route は maskDeep / maskContactInfo を実際に import している
// 新しい route が増えたら、このテストが「未分類」で赤くなるので判断を強制できる。

const API_ROOT = join(process.cwd(), 'src/app/api');

/** 顧客の自由記述フィールド。ここに電話番号・メールが書かれる。 */
const FREE_TEXT_FIELDS = /likesNote|dislikesNote|ngNote|importantMemo|chatHistory/;

/** 保存済みの顧客フリーテキストを AI プロンプトに載せる route（＝マスク必須） */
const MASKED = [
  'ai/briefing/route.ts',
  'ai/chat/route.ts',
  'ai/customer-infer-profile/route.ts',
  'ai/insights/route.ts',
  'ai/message/reply/route.ts',
  'ai/message/route.ts',
  // Day103 追加: サーバは顧客 doc を読まないが、クライアント（iOS AIService.salesMessage）が
  // `customer.importantMemo` を context に詰めて送る＝保存済みフリーテキストが AI へ出る経路。
  'ai/sales-message/route.ts',
  // pickForAi（内部で maskDeep）で allowlist 抽出しているルート
  'ai/suggest/route.ts',
  // Day127: 来店ログの memo（＝保存済みの顧客フリーテキスト）を送っていたのに
  // 「書込み側」に分類されて素通しになっていた
  'ai/tags/route.ts',
];

/**
 * ユーザーが**貼り付けたテキスト**を AI へ送る route（＝マスク必須・Day127 で分類変更）。
 *
 * 旧分類はこれらを「書込み側だから Day12 の想定外」としてマスク免除にしていた。
 * だが免除の理由は「保存済みの顧客フリーテキストを載せないから」であって、
 * **貼り付けテキスト（LINE のトーク履歴そのもの）は保存済みメモより PII が濃い**。
 * 外部モデルに生の電話番号・メールが出ることに変わりはないので、免除は成り立たない。
 * 抽出スキーマ側に連絡先の項目は無いため、マスクしても機能は落ちない。
 */
const PASTED_TEXT_MASKED = [
  'ai/customer-extract/route.ts',
  'ai/learn-from-text/route.ts',
  'ai/parse/route.ts',
  // P129（生成系の 1 本目）: 入力は料金表の写しや店長のメモ。顧客のフリーテキストを
  // 載せる経路ではないが、**貼り付けテキストである以上マスクを通す**——
  // Day127 で崩れたのは「載せないはずだから免除」という前提そのものだった。
  // 料金設定に連絡先は不要なので、マスクしても機能は落ちない
  'ai/pos-config/route.ts',
  // P148（生成系の 2 本目）: 入力は店の説明の自由文。項目名の提案に連絡先は要らないので、
  // マスクしても機能は落ちない（pos-config と同じ理由）
  'ai/schema-suggest/route.ts',
];

/**
 * 画像だけを送る route。**画像内の PII は機械的にマスクできない**ため、
 * 同意文言（AI_CONSENT_TEXT）と UI の注意書きで担保する領域として明示的に切り出す。
 * 「マスクしているつもり」の分類に混ぜないこと。
 */
const IMAGE_ONLY = [
  'ai/customer-context-extract/route.ts',
  'ai/message/analyze/route.ts',
  'ai/profile-extract/route.ts',
];

/**
 * 顧客のフリーテキストをそもそもプロンプトに載せない route。
 * （盤面データ・集計値・氏名のみ＝ポリシー方針4 で送信可としているもの）
 */
const NO_CUSTOMER_TEXT = [
  'ai/insights-narrative/route.ts',
  'ai/seating-suggest/route.ts',
];

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

// Day127 追加: 「貼り付けテキストなら免除」という分類そのものが穴だった。
// 免除の根拠は「保存済みの顧客フリーテキストを載せないから」だが、貼り付けられるのは
// LINE のトーク履歴そのもので、保存済みメモより PII が濃い。分類を作り直した。

describe('AI route の PII マスク網羅（Day12 ポリシー）', () => {
  const touching = listRouteFiles(API_ROOT)
    .filter((f) => FREE_TEXT_FIELDS.test(readFileSync(f, 'utf-8')))
    .map((f) => relative(API_ROOT, f).split(/[\\/]/).join('/'))
    .sort();

  it('顧客フリーテキストを扱う route はすべて分類済み（新規 route はここで落ちる）', () => {
    const classified = new Set([...MASKED, ...PASTED_TEXT_MASKED, ...IMAGE_ONLY]);
    const unclassified = touching.filter((f) => !classified.has(f));
    expect(unclassified).toEqual([]);
  });

  it('分類表に実在しないファイルが残っていない（削除・改名の取りこぼし検知）', () => {
    // Day103: 分類対象を「フィールド名が出てくる route」から「AI を呼ぶ全 route」へ広げたため、
    // ここはファイルの実在で判定する（route 単位の網羅は下の Day103 ブロックが担保）。
    const all = [...MASKED, ...PASTED_TEXT_MASKED, ...IMAGE_ONLY, ...NO_CUSTOMER_TEXT];
    expect(all.filter((f) => !existsSync(join(API_ROOT, f)))).toEqual([]);
  });

  it.each([...MASKED, ...PASTED_TEXT_MASKED])('%s はマスクヘルパーを import している', (rel) => {
    const src = readFileSync(join(API_ROOT, rel), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*(mask(Deep|ContactInfo)|pickForAi)[^}]*\}\s*from\s*'@\/lib\/ai-privacy'/);
  });

  // import だけ見ると、マスクした値を**使わずに**生のまま送っても緑になる
  // （Day122 の教訓: ガードは「呼んでいるか」ではなく「その式が何をしているか」を見る）
  it.each(PASTED_TEXT_MASKED)('%s は生の貼り付けテキストをプロンプトへ渡していない', (rel) => {
    const src = readFileSync(join(API_ROOT, rel), 'utf-8');
    expect(src).not.toMatch(/\$\{(text|content)\}/);
    expect(src).toMatch(/masked(Text|Content)/);
  });

  // --- Day103 追加: フィールド名ベースの検出では拾えない穴を塞ぐ ---
  //
  // 旧ガードは「route のソースに likesNote 等の**フィールド名が出てくるか**」で対象を選んでいた。
  // そのため `ai/sales-message` のように **クライアントが顧客メモを詰めて送ってくる**（サーバは
  // 顧客 doc を読まない）route は検出できず、Day99 の横断修正から漏れていた。
  // ここでは対象を「AI プロバイダを呼ぶ全 route」へ広げ、3 分類のいずれかへの割り当てを強制する。
  describe('AI プロバイダを呼ぶ route の全数分類（Day103）', () => {
    const aiRoutes = listRouteFiles(API_ROOT)
      .filter((f) => /from '\.{1,2}(\/\.\.)*\/ai-provider'/.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(API_ROOT, f).split(/[\\/]/).join('/'))
      .sort();

    it('AI へ投げる route が 1 本以上検出できている（検出ロジック自体の番人）', () => {
      expect(aiRoutes.length).toBeGreaterThanOrEqual(10);
      expect(aiRoutes).toContain('ai/sales-message/route.ts');
    });

    it('すべて MASKED / PASTED_TEXT_MASKED / IMAGE_ONLY / NO_CUSTOMER_TEXT のどれかに分類されている', () => {
      const classified = new Set([...MASKED, ...PASTED_TEXT_MASKED, ...IMAGE_ONLY, ...NO_CUSTOMER_TEXT]);
      expect(aiRoutes.filter((f) => !classified.has(f))).toEqual([]);
    });

    it('分類表に実在しない route が残っていない（削除・改名の取りこぼし検知）', () => {
      const all = [...MASKED, ...PASTED_TEXT_MASKED, ...IMAGE_ONLY, ...NO_CUSTOMER_TEXT];
      expect(all.filter((f) => !aiRoutes.includes(f))).toEqual([]);
      expect(new Set(all).size).toBe(all.length); // 二重分類なし
    });
  });
});
