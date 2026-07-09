/**
 * 公開プロフィール（profile_pages）の公開範囲。
 * - public:   誰でも閲覧可・検索/一覧に出る
 * - unlisted: URLを知る人のみ実質閲覧可（noindex・一覧除外＝軽いlink-only）
 * - private:  本人と admin のみ
 *
 * 旧 `published`(boolean) からの後方互換: visibility が未設定の既存docは
 * published==true を public、false を private とみなす。
 *
 * firebase に依存しない純モジュール（単体テスト容易・import副作用なし）。
 */
export const VISIBILITY = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

/** 旧 published との後方互換で visibility を解決する */
export function resolveVisibility(p: { visibility?: string; published?: boolean }): Visibility {
  if (p.visibility === 'public' || p.visibility === 'unlisted' || p.visibility === 'private') {
    return p.visibility;
  }
  return p.published ? 'public' : 'private';
}
