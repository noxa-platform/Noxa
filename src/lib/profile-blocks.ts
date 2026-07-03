/**
 * NOXAページ（公開プロフィール）のブロック定義と純ロジック。
 *
 * 設計（docs/superpowers/plans/2026-06-20-noxa-page-lane-a.md の Lane B）:
 *   - プロフィール = ブロックの並び（JSON配列）。profile_pages/{handle}.blocks に保存。
 *   - v1 のブロック: text / link / schedule（手入力）。画像系は Phase2（Storage 基盤が前提）。
 *   - renderer は未知 type・壊れブロックを skip して絶対に落ちない。
 *   - blocks が空/未定義の既存ページは旧フィールド（bio/sns）から描画（後方互換）。
 *   - 編集は blocks を正本として書く（one-way migration。初回編集時に旧フィールドから変換）。
 *
 * firebase 非依存の純モジュール（単体テスト対象）。
 */
/** handle.ts の SnsLink と同形（firebase 非依存を保つためローカル定義） */
type SnsLink = { platform: string; url: string };

export const BLOCK_VERSION = 1;

export type ProfileBlock =
  | { id: string; type: 'text'; visible: boolean; v: number; value: string }
  | { id: string; type: 'link'; visible: boolean; v: number; label: string; url: string; platform?: string }
  | { id: string; type: 'schedule'; visible: boolean; v: number; value: string };

export type BlockType = ProfileBlock['type'];

let seq = 0;
export function newBlockId(): string {
  seq = (seq + 1) % 1000;
  return `blk_${Date.now().toString(36)}_${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function createBlock(type: 'text' | 'schedule', value?: string): ProfileBlock;
export function createBlock(type: 'link', value?: { label: string; url: string; platform?: string }): ProfileBlock;
export function createBlock(type: BlockType, value?: unknown): ProfileBlock {
  const base = { id: newBlockId(), visible: true, v: BLOCK_VERSION };
  if (type === 'link') {
    const v = (value ?? {}) as { label?: string; url?: string; platform?: string };
    return { ...base, type: 'link', label: v.label ?? '', url: v.url ?? '', ...(v.platform ? { platform: v.platform } : {}) };
  }
  if (type === 'schedule') return { ...base, type: 'schedule', value: typeof value === 'string' ? value : '' };
  return { ...base, type: 'text', value: typeof value === 'string' ? value : '' };
}

/** http(s) のみ許可（javascript: 等のスキーム注入防止） */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Firestore から読んだ生データを安全な ProfileBlock[] に正規化する。
 * 未知 type・必須フィールド欠落・危険 URL のブロックは黙って捨てる（描画を落とさない）。
 */
export function normalizeBlocks(raw: unknown): ProfileBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    const id = typeof o.id === 'string' && o.id ? o.id : newBlockId();
    const visible = o.visible !== false;
    const v = typeof o.v === 'number' ? o.v : BLOCK_VERSION;
    if (o.type === 'text' && typeof o.value === 'string') {
      out.push({ id, type: 'text', visible, v, value: o.value });
    } else if (o.type === 'schedule' && typeof o.value === 'string') {
      out.push({ id, type: 'schedule', visible, v, value: o.value });
    } else if (o.type === 'link' && typeof o.url === 'string' && isSafeUrl(o.url)) {
      out.push({
        id, type: 'link', visible, v,
        label: typeof o.label === 'string' ? o.label : '',
        url: o.url,
        ...(typeof o.platform === 'string' ? { platform: o.platform } : {}),
      });
    }
    // 未知 type は skip（前方互換: 新しいアプリが作ったブロックを旧クライアントが壊さない）
  }
  return out;
}

/** 旧フィールド（bio / sns[]）からブロックへ変換（初回編集時の one-way migration 用） */
export function blocksFromLegacy(page: { bio?: string; sns?: SnsLink[] }): ProfileBlock[] {
  const out: ProfileBlock[] = [];
  if (page.bio && page.bio.trim()) out.push(createBlock('text', page.bio.trim()));
  for (const s of page.sns ?? []) {
    if (!s.url || !isSafeUrl(s.url)) continue;
    out.push(createBlock('link', { label: '', url: s.url, platform: s.platform }));
  }
  return out;
}

/** 並べ替え（境界外は no-op の新配列） */
export function moveBlock(blocks: ProfileBlock[], index: number, dir: -1 | 1): ProfileBlock[] {
  const j = index + dir;
  if (index < 0 || index >= blocks.length || j < 0 || j >= blocks.length) return [...blocks];
  const next = [...blocks];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** 保存前サニタイズ: 空 text/schedule・URL 不正 link を落とし、上限数で切る */
export const MAX_BLOCKS = 30;
export function sanitizeForSave(blocks: ProfileBlock[]): ProfileBlock[] {
  return blocks
    .filter((b) => {
      if (b.type === 'link') return isSafeUrl(b.url);
      return b.value.trim().length > 0;
    })
    .slice(0, MAX_BLOCKS);
}
