// 記録の版（`ir_version`）— 記録エンジン共通仕様 段 3。
// 正本: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md` §1.7「版と前方互換」
//
// 「後から足すと版判定ができなくなる」ため、スキーマが増える前に入れる。
//
// ## 書き込み規則（2026-08-25 決定・yorulog-ios と合意）
//
// | 場面 | ir_version |
// | --- | --- |
// | 新規作成 | **書く** |
// | 通常の更新（merge パッチ / 部分フィールド） | **触らない**（merge なので自然に維持される） |
// | 形を変える移行処理 | 上げてよい。ただし**単調増加のみ**（下げる書込みは禁止） |
// | 欠落している既存 doc | **v0（IR 以前）と読む。エラーにしない** |
//
// **更新のたびに書き手の版を刻んではいけない**理由（これが規則の核）:
// iOS アプリは何か月も更新されずに使われ、その間に Web・nomishugy・noxa-ios が同じ doc を触る。
// 更新時に書き手の版を刻むと、**最後に書いた一番古いクライアントの版が残る**（版の巻き戻り）。
// 新しい版で作られた記録を古いクライアントが 1 回開いて保存しただけで「古い版」に化け、
// 「知らないメジャー版は読み取り専用にする」という判定を**逆向きに壊す**。
//
// **「誰が書いたか」をここに混ぜないこと。** 版は*記録の形*を指す語であって書き手を指す語ではない。
// 書き手を残したいなら別フィールド（`writer` 等）にする。混ぜると上の巻き戻りが起きる。

/** このコードが書ける記録の形の版。形を変えたときだけ上げる（書き手の版ではない） */
export const IR_VERSION = 1;

/** 版が入っていない既存 doc の読み値。IR 以前という意味で、異常ではない */
export const IR_VERSION_LEGACY = 0;

export const IR_VERSION_FIELD = 'ir_version';

/**
 * **新規作成時だけ**使う。既存 doc の更新に使わないこと（版の巻き戻りの原因になる）。
 *
 * すでに `ir_version` を持つデータを渡された場合は**上書きしない**——
 * doc 全体のコピー（アカウント統合・担当移管）で元の版を運ぶ経路があり、
 * そこで現在の版に化けさせると「いつの形か」の情報が失われる。
 */
export function stampIrVersion<T extends Record<string, unknown>>(
  data: T,
): T & { ir_version: number } {
  const existing = readIrVersion(data);
  return { ...data, [IR_VERSION_FIELD]: existing > IR_VERSION_LEGACY ? existing : IR_VERSION } as T & { ir_version: number };
}

/**
 * 版を読む。**欠落・不正はすべて v0** として返し、例外にしない。
 * 既存データは全部欠落なので、欠落は正常な状態として扱う（遡って一括で付ける移行はしない）。
 */
export function readIrVersion(data: unknown): number {
  if (!data || typeof data !== 'object') return IR_VERSION_LEGACY;
  const raw = (data as Record<string, unknown>)[IR_VERSION_FIELD];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return IR_VERSION_LEGACY;
  // 負の版は壊れた書込み。v0 に倒す（読めるが「IR 以前」として扱う）
  return raw < IR_VERSION_LEGACY ? IR_VERSION_LEGACY : Math.floor(raw);
}

/**
 * 知らない（＝このコードより新しい）版か。真なら**読み取り専用として扱う**。
 * 壊すより止める、が仕様の方針（§1.7）。
 */
export function isFutureIrVersion(data: unknown): boolean {
  return readIrVersion(data) > IR_VERSION;
}

/**
 * 移行処理が書き込むべき版。**単調増加のみ**——現在値より低い版は返さない。
 * 古いコードが新しい doc を「移行」しても版を巻き戻さないための番人。
 */
export function nextIrVersion(data: unknown, target: number = IR_VERSION): number {
  const current = readIrVersion(data);
  return current > target ? current : Math.floor(target);
}
