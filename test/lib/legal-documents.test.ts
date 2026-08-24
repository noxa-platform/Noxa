import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRIVACY_POLICY, TERMS_OF_SERVICE, SUPPORT_INFO, AD_CLAUSE_PURPOSE, AD_CLAUSE_THIRD_PARTY,
} from '../../src/lib/legal/documents';

// 法務文書の正本ガード（2026-08-21 臨時タスク）。
//
// 広告条項は「今のうちに入れておかないと、後から入れるには本人同意が要る」
// （個人情報保護法 17 条 2 項）という性質のもので、**消えたことに気づけないと致命的**。
// また Noxa / のみシュギ / YoruLog はアカウントを共有するため、文言が 3 サービスで
// 揃っている必要がある。ここでは NOXA 側の実体が正本どおりであることを固定する。
// ※ 唯一の例外は事業者の呼称で、正本の「当社」を「当方」へ統一している（下の describe を参照）。

describe('プライバシーポリシー（公開ページの実体）', () => {
  const purpose = PRIVACY_POLICY.sections.find((s) => s.title.includes('利用目的'));
  const thirdParty = PRIVACY_POLICY.sections.find((s) => s.title.includes('第三者提供'));

  it('★利用目的の節に広告条項が正本のまま入っている', () => {
    expect(purpose).toBeDefined();
    expect(purpose!.body).toContain(AD_CLAUSE_PURPOSE);
  });

  it('★広告条項を足しても既存の利用目的を消していない', () => {
    // 「追加する（既存項目は消さない）」が正本の指示。上書きすると
    // 本来の利用目的が落ちて、機能提供そのものの根拠が消える
    for (const keep of ['アプリ機能の提供・運営', 'サポート対応', '不正利用防止', '法令遵守']) {
      expect(purpose!.body).toContain(keep);
    }
  });

  it('★第三者提供の節が正本のまま入っている', () => {
    expect(thirdParty).toBeDefined();
    expect(thirdParty!.body).toContain(AD_CLAUSE_THIRD_PARTY);
  });

  it('★個票を渡さない約束が明記されている（実装制約の法的な裏付け）', () => {
    expect(thirdParty!.body).toContain('個別データ（個票）を提供することはありません');
  });

  it('★業務委託先の開示が残っている（App Store のプライバシー開示で必要）', () => {
    // 正本は「第三者提供の節を置き換える」だが、丸ごと差し替えると委託先の開示が消える。
    // 正本の文面には手を入れず、委託先を併記する形にしている
    for (const p of ['Google LLC', 'Apple Inc.', 'OpenRouter, Inc.', 'Functional Software, Inc.']) {
      expect(thirdParty!.body).toContain(p);
    }
  });

  it('★実装していない約束を書かない（広告オプトアウトの導線）', () => {
    // 正本 §3 は「オプトアウト設定を用意し、ポリシーに導線を書く」と求めるが、
    // 設定自体は未実装（今回のタスクは「実装しない」）。**無い機能をポリシーに書くと
    // それ自体が虚偽記載になる**ため、実装と同時に入れる。ここはその見張り。
    const all = PRIVACY_POLICY.sections.map((s) => s.body).join('\n');
    expect(all).not.toMatch(/オプトアウト|広告の最適化を(無効|オフ)/);
  });

  it('AI へ送る情報の扱いが書かれている（画像はマスクできない旨を含む）', () => {
    const ai = PRIVACY_POLICY.sections.find((s) => s.title.includes('AI'));
    expect(ai).toBeDefined();
    expect(ai!.body).toContain('画像');
  });

  it('アカウント共通であることが明記されている（3 サービスで同じ文書）', () => {
    expect(PRIVACY_POLICY.lead).toContain('YoruLog');
    expect(PRIVACY_POLICY.lead).toContain('のみシュギ');
    expect(TERMS_OF_SERVICE.lead).toContain('YoruLog');
  });
});

// 事業者の呼称（2026-08-21 決定）。
//
// egshugy は**個人事業主**であり法人ではない。「当社」は法人を指す語なので事実として誤り。
// 広告条項の正本が「当社」で書かれていたためそのまま取り込んでいたが、呼称だけ「当方」へ統一する。
// 混在は「どれが正本か分からない」を招くので、**文書データ側で 1 つに揃っていること**を固定する
// （ソースを grep するとコメント内の説明文まで数えてしまうため、描画される文字列だけを見る）。
describe('事業者の呼称は「当方」に統一されている', () => {
  const legalText = [PRIVACY_POLICY, TERMS_OF_SERVICE, SUPPORT_INFO]
    .flatMap((d) => [d.title, d.lead, ...d.sections.flatMap((s) => [s.title, s.body])])
    .join('\n');

  it.each(['当社', '当事業者', '弊社'])('法務文言に「%s」が出てこない（個人事業主なので誤り）', (word) => {
    expect(legalText).not.toContain(word);
  });

  it('★事業者を指す語は「当方」で、実際に使われている（置換で消してしまっていない）', () => {
    expect(legalText.split('当方').length - 1).toBeGreaterThanOrEqual(9);
  });

  it('★広告条項の中身は呼称以外そのまま（呼称統一のついでに文意を変えていない）', () => {
    expect(AD_CLAUSE_PURPOSE).toContain('広告その他の情報の配信、表示および最適化');
    expect(AD_CLAUSE_THIRD_PARTY).toContain('個々の利用者の売上金額');
    expect(AD_CLAUSE_THIRD_PARTY).toContain('特定の個人を識別することができない形式に加工した統計情報');
  });

  it('第三者の企業名は置換の巻き添えになっていない', () => {
    // 「社」を含む委託先（Google LLC 等）を機械置換で壊していないこと
    for (const p of ['Google LLC', 'Apple Inc.', 'OpenRouter, Inc.', 'Functional Software, Inc.']) {
      expect(legalText).toContain(p);
    }
  });
});

// サポートページ（App Store Connect のサポート URL 必須項目）。
// 事実情報を創作しないことと、法務文書と食い違う約束をしないことを固定する。
describe('サポートページ', () => {
  const text = [SUPPORT_INFO.lead, ...SUPPORT_INFO.sections.flatMap((s) => [s.title, s.body])].join('\n');

  it('★連絡手段が既存の表記と同じ（新しい窓口を作っていない）', () => {
    // メールはプライバシーポリシーの「お問い合わせ」節と同じもの
    const inPolicy = PRIVACY_POLICY.sections.find((s) => s.title.includes('お問い合わせ'))!.body;
    expect(inPolicy).toContain('wpuhs2216@gmail.com');
    expect(text).toContain('wpuhs2216@gmail.com');
  });

  it('★存在しない連絡手段を書かない（電話番号・住所・チャット窓口）', () => {
    // 既存の表記が無いものを「サポートページらしさ」で足さない。
    // ※「電話番号」という語自体は AI のマスク説明で正当に出てくるので、
    //   語ではなく**連絡先として提示している形**を見る（最初にこの検査が緩すぎて誤検出した）
    expect(text).not.toMatch(/\d{2,4}-\d{2,4}-\d{3,4}/);              // 電話番号らしい数字列
    expect(text).not.toMatch(/お電話|TEL[:：]|電話[:：]/);                // 電話窓口の提示
    expect(text).not.toMatch(/所在地|住所[:：]/);                        // 住所の提示
    expect(text).not.toMatch(/チャットサポート|フリーダイヤル|問い合わせフォーム/);
  });

  it('3 サービスの関係が分かる（アカウント共通であること）', () => {
    for (const name of ['YoruLog', 'のみシュギ']) expect(text).toContain(name);
  });

  it('★よくある質問が法務文書と矛盾しない（削除・AI 送信の説明）', () => {
    expect(text).toContain('アカウントを削除');
    expect(text).toContain('復元できません');   // プライバシーポリシー 5. と同じ
    expect(text).toContain('画像');             // 画像はマスクできない旨（同 4.）
  });

  it('★プライバシーポリシー・利用規約へ実リンクがある（本文にパスを文字列で書かない）', () => {
    expect(SUPPORT_INFO.links?.map((l) => l.href).sort()).toEqual(['/privacy', '/terms']);
    expect(text).not.toContain('/privacy');
  });
});

describe('公開ページの実体が存在する（App Store 提出のブロッカー）', () => {
  // yorulog-ios の提出は privacy URL が 404 で止まっていた。ページの実体が
  // 消えたり認証の向こう側へ移ったりしたら赤にする
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it.each(['src/app/privacy/page.tsx', 'src/app/terms/page.tsx', 'src/app/support/page.tsx'])('%s が存在して正本を描画している', (p) => {
    const src = read(p);
    expect(src).toContain("from '@/lib/legal/documents'");
    expect(src).toContain('LegalDocumentView');
  });

  it('★法務ページに認証を掛けない（審査は未ログインで開く）', () => {
    for (const p of ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx', 'src/app/support/page.tsx', 'src/components/legal/LegalDocumentView.tsx']) {
      const src = read(p);
      expect(src).not.toMatch(/AuthGuard|useAuth|verifyRequest|'use client'/);
    }
  });
});
