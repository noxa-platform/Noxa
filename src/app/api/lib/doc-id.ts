// Firestore の doc ID として安全かを判定する共通ヘルパー（Day101 で ai/feedback に導入 → Day102 で共通化）。
//
// Admin SDK は rules をバイパスするため、クライアント入力や DB 由来の文字列を
// テンプレートリテラルでパスに埋める箇所は必ずここを通す。`/` を含む値だと
// パス階層が変わって**別ドキュメントを読み書きし得る**（セグメント数が奇数になれば
// db.doc() が throw して機能ごと 500 になる）。

/** `/`・`.`/`..`・`__foo__`（Firestore 予約）・200 文字超・非文字列を弾く */
export function isSafeDocId(id: unknown): id is string {
  if (typeof id !== 'string' || !id || id.length > 200) return false;
  if (id.includes('/') || id === '.' || id === '..') return false;
  return !/^__.*__$/.test(id);
}
