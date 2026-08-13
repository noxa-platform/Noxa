/**
 * 店舗端末（共有タブレット）のナビ解決（Day113・純ロジック）。
 *
 * 発端は「**ゲートで弾かれた後に戻り道があるか**」＝条件つきの到達性。店舗端末ログイン
 * （`storeDeviceLogin` が発行する claims: device/shopId/allow）では、個人機能と
 * 許可外モジュールを隠す設計になっている。ところが隠す側だけが実装されていて、
 * **隠された端末が実際に何に到達できるか**が誰にも保証されていなかった:
 *
 *   1. モバイル幅（<768px）では左サイドバーが `hidden md:flex` で消え、下部タブは
 *      `!device.isDevice` の条件で消えていた ＝ **端末の許可モジュールへの導線がゼロ**。
 *      残るリンクはロゴの `/account` だけ。
 *   2. その `/account` は端末を判定しておらず、個人機能・プラン/クレジット・
 *      「＋自分のお店を登録する」・**許可外の店舗モジュール全部**を並べていた。
 *      ＝隠したはずの機能がハブで再露出し、逆に許可モジュールは（モバイルで）どこにも無い。
 *   3. `allowedModules` が空のプロファイルはログインだけ成功して**ナビが真っ白**になり、
 *      理由も出なかった（今週の「無音」と同型）。
 *
 * ここは判定だけを持つ（描画は AccountShell / account ページ）。許可を広げる判定はしない。
 */
import { DEFAULT_MODULES } from '@/lib/shopConfig';

export type DeviceNavItem = {
  /** モジュールキー（pos / seating / ...）。route は `/${key}` */
  key: string;
  label: string;
  href: string;
};

/** 許可モジュールが1つも無い端末プロファイルに出す説明（黙って空にしない） */
export const DEVICE_NO_MODULE_TEXT =
  'この端末に許可されたモジュールがありません。オーナーが「店舗設定 › 端末ログイン」で利用するモジュールを選ぶと表示されます。';

/** 下部タブのアイコン（端末モード用。未定義キーは • にフォールバック） */
const GLYPHS: Record<string, string> = {
  home: '🏠',
  pos: '🧾', seating: '🪑', attendance: '⏰', payroll: '💴', 'first-visit': '✨',
  transport: '🚗', inventory: '📦', trial: '🌱', reservation: '📅', unpaid: '📌', risk: '⚠️',
};

export function deviceGlyph(key: string): string {
  return GLYPHS[key] ?? '•';
}

/**
 * claims の `allow` を、実在するモジュールのナビ項目へ解決する。
 *
 * - 並び順は `DEFAULT_MODULES`（＝店舗運営メニューの正準順）に従う。allow の並びは信用しない。
 * - **未知のキーは落とす**。`/${key}` が `src/app` に無ければ 404 に着地するだけで、
 *   端末には行き止まりが増える（Day112 の遷移先照合と同じ理由）。
 * - 重複は 1 件に畳む。
 */
export function resolveDeviceModules(allow: readonly string[] | null | undefined): DeviceNavItem[] {
  if (!Array.isArray(allow) || allow.length === 0) return [];
  const wanted = new Set(allow.filter((k): k is string => typeof k === 'string' && k.length > 0));
  return DEFAULT_MODULES
    .filter((m) => wanted.has(m.key))
    .map((m) => ({ key: m.key, label: m.label, href: `/${m.key}` }));
}

/** モバイル下部タブの上限（Material bottom-nav-limit。BottomTabBar と揃える） */
export const DEVICE_TAB_LIMIT = 5;

/**
 * 端末モードのモバイル下部タブ。
 *
 * **先頭は必ずホーム**（`/account`＝端末ホーム。許可モジュールを全部並べる）。
 * 上限 5 個に収まらない端末でも、ホーム経由で残りへ必ず到達できるようにするため
 * （タブから溢れたモジュールが、モバイルで永久に開けなくなるのを防ぐ）。
 */
export function resolveDeviceTabs(modules: readonly DeviceNavItem[]): DeviceNavItem[] {
  const home: DeviceNavItem = { key: 'home', label: 'ホーム', href: '/account' };
  return [home, ...modules.slice(0, DEVICE_TAB_LIMIT - 1)];
}
