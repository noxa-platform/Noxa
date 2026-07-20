/**
 * ハンドル（公開ID）の純ルール（firebase 非依存・Day25 に handle.ts から分離）。
 * /u/<handle> の URL キーになるため、検証・候補生成をテストで固定する。
 */

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export const RESERVED_HANDLES = new Set([
  'admin', 'support', 'noxa', 'account', 'api', 'null', 'undefined', 'root', 'system',
  'help', 'about', 'login', 'signup', 'u', 's', 'p', 'me', 'official', 'staff', 'noxaofficial',
]);

/** 正規化して妥当なら小文字ハンドルを返す（不正・予約語は null） */
export function validateHandle(raw: string): string | null {
  const h = (raw ?? '').trim().toLowerCase();
  if (!HANDLE_RE.test(h)) return null;
  if (RESERVED_HANDLES.has(h)) return null;
  return h;
}

export type HandleChangePlan = { oldH: string; newH: string; noop: boolean };

/**
 * ハンドル変更の正規化プラン（firebase 非依存・テスト対象・Day57）。
 * new が不正/予約語なら null。old も new と同じく正規化（trim・小文字化）してから比較する。
 *
 * 目的: changeUserHandle の doc パス（profile_pages/{handle}）は case-sensitive のため、
 * 未正規化の old を渡すと存在しない doc を読み（空データで新 doc 作成＋旧 doc 未削除＝
 * データ損失・孤児プロフィール）になる。正規化を一元化してこの footgun を塞ぐ。
 * 同一（正規化後）は noop=true（再ケーシングでの誤 HANDLE_TAKEN も回避）。
 */
export function planHandleChange(oldHandleRaw: string, newHandleRaw: string): HandleChangePlan | null {
  const newH = validateHandle(newHandleRaw);
  if (!newH) return null;
  const oldH = (oldHandleRaw ?? '').trim().toLowerCase();
  return { oldH, newH, noop: oldH === newH };
}

/** 表示名/メールから候補ハンドルを生成（英数字以外を除去、3〜20字に整形・予約語を回避） */
export function suggestHandle(seed: string): string {
  let s = (seed ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (s.length < 3) s = `noxa_${s}`;
  s = s.slice(0, 20);
  while (s.length < 3) s += '0';
  // 予約語（admin 等）をそのまま提案すると onboarding の初期表示で即エラーになるため回避
  if (RESERVED_HANDLES.has(s)) s = `${s}_`.slice(0, 20);
  return s;
}
