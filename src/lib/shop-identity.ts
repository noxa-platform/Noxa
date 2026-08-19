/**
 * 店舗の同一性（Day126・純関数）。
 *
 * 統一規格の芯は **「同一性を名前で持たない」** ことに尽きる。
 * 店名は変わる（改名・業態変更・移転）。名前で紐付けていると、変えた瞬間に
 * 過去の売上・顧客・給与との繋がりが切れる。
 *
 * 内部の不変 ID は Firestore の doc id で既に確保できているので、ここで足すのは
 * **人が読める不変の店舗コード**（サポート・帳票・店舗間の受け渡しで使う）。
 *
 * 設計上の要点:
 *   - **doc id から決定的に導出する**。乱数で採番して衝突確認クエリを投げる方式は、
 *     採番時に `shop_shops` 全体への読み取り権限が要る（rules 上は非メンバーに開けない）。
 *     決定的導出なら権限も採番テーブルも要らず、**既存店舗にも遡って同じコードが出る**
 *     （移行スクリプト不要）。
 *   - 紛らわしい文字（I / L / O / U）を除いた Crockford Base32。電話・手書きでの伝達を想定。
 *   - コードは**表示用の識別子**であって秘密ではない（PIN や招待コードとは別物）。
 */

/** 紛らわしい文字を除いた 32 文字（Crockford Base32 から U を除き I/L/O も不採用） */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** FNV-1a（32bit）。識別子の導出用で暗号強度は不要 */
function fnv1a(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function toBase32(value: number, length: number): string {
  let v = value >>> 0;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

/**
 * 店舗 ID から人が読める店舗コードを導出する（`NX-XXXX-XXXX`）。
 * 同じ ID なら常に同じコード。店名を変えても業態を変えても不変。
 */
export function shopCodeFromId(shopId: string): string {
  const id = (shopId ?? '').trim();
  if (!id) return '';
  // 2 系統のハッシュから 20bit ずつ取り 40bit 相当にする（4 文字 × 2 ブロック）
  const a = fnv1a(id, 0x811c9dc5);
  const b = fnv1a(`${id}:noxa`, 0x9dc5811c);
  return `NX-${toBase32(a, 4)}-${toBase32(b, 4)}`;
}

/** 形式が店舗コードとして妥当か（入力欄の検証・帳票の取り込み用） */
export function isValidShopCode(code: string): boolean {
  return /^NX-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test((code ?? '').trim().toUpperCase());
}

/** 入力されたコードを正規化（小文字・全角スペース・区切り無しを吸収） */
export function normalizeShopCode(input: string): string | null {
  const raw = (input ?? '').trim().toUpperCase().replace(/[\s　]/g, '').replace(/^NX-?/, '');
  const body = raw.replace(/-/g, '');
  if (body.length !== 8) return null;
  const code = `NX-${body.slice(0, 4)}-${body.slice(4)}`;
  return isValidShopCode(code) ? code : null;
}
