/**
 * ソースからコメントを空白に潰す（行番号は保つ）。静的ガード共通のヘルパー。
 *
 * 静的ガードを生ソースに当てると、**注意書きのコメントを実装として摘発する**（誤検知）。
 * 逆向きの穴の方が重く、判定対象の本体がコメント 1 行だけでも「ちゃんと書いてある」と
 * 見なして素通りする。判定はコードだけに当てること。
 *
 * 由来: Day121-PM で CF の無音ガードに入れた対策。Day123 に別のガード
 * （出所つきスナップショット）でも同じ誤検知が出たため共通化した
 * ——「直した型を兄弟に当てたか」を仕組みで担保する。
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") mode = 'single';
      else if (c === '"') mode = 'double';
      else if (c === '`') mode = 'template';
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; } else out += ' ';
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? c : ' '; i += 1; continue;
    }
    // 文字列/テンプレート内: エスケープを飛ばしつつ終端を待つ
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') || (mode === 'template' && c === '`')) mode = 'code';
    out += c; i += 1;
  }
  return out;
}
