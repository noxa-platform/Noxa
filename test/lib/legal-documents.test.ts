import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRIVACY_POLICY, TERMS_OF_SERVICE, AD_CLAUSE_PURPOSE, AD_CLAUSE_THIRD_PARTY,
} from '../../src/lib/legal/documents';

// 法務文書の正本ガード（2026-08-21 臨時タスク）。
//
// 広告条項は「今のうちに入れておかないと、後から入れるには本人同意が要る」
// （個人情報保護法 17 条 2 項）という性質のもので、**消えたことに気づけないと致命的**。
// また Noxa / のみシュギ / YoruLog はアカウントを共有するため、文言が 3 サービスで
// 揃っている必要がある。ここでは NOXA 側の実体が正本どおりであることを固定する。

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

describe('公開ページの実体が存在する（App Store 提出のブロッカー）', () => {
  // yorulog-ios の提出は privacy URL が 404 で止まっていた。ページの実体が
  // 消えたり認証の向こう側へ移ったりしたら赤にする
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it.each(['src/app/privacy/page.tsx', 'src/app/terms/page.tsx'])('%s が存在して正本を描画している', (p) => {
    const src = read(p);
    expect(src).toContain("from '@/lib/legal/documents'");
    expect(src).toContain('LegalDocumentView');
  });

  it('★法務ページに認証を掛けない（審査は未ログインで開く）', () => {
    for (const p of ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx', 'src/components/legal/LegalDocumentView.tsx']) {
      const src = read(p);
      expect(src).not.toMatch(/AuthGuard|useAuth|verifyRequest|'use client'/);
    }
  });
});
