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
/**
 * 直前の非空白文字から「この `/` は正規表現の始まりか」を判定する。
 * 除算（`a / b`）と区別するための最小限のヒューリスティック。
 * 直前が識別子・数値・閉じ括弧なら除算、それ以外（演算子・区切り・行頭）なら正規表現。
 */
function isRegexStart(emitted: string): boolean {
  const head = emitted.replace(/\s+$/, '');
  const prev = head.slice(-1);
  if (prev === '') return true;
  // ⚠️ **許可制にする**（禁止制にしない）。`}` や `>` を正規表現の開始と見なすと
  // JSX の `/>` を食って**その行を丸ごと空白に潰す**（実測で 2 ファイル壊れた）。
  // 見つけたい対象は `.replace(/…/)` `split(/…/)` `= /…/` の形なので、これで足りる。
  if ('=(,:[!&|?;+*%~^'.includes(prev)) return true;
  return /\b(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(head);
}

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
      // 🔴 正規表現リテラルを読み飛ばす（2026-09-04 に実測した穴）。
      // これが無いと `.replace(/\\"/g, '"')` の `"` で**文字列モードに入ったまま**になり、
      // **そのファイルの以降のコメントが 1 つも消えない**。
      // ＝ コメント盲を塞いだはずのガードが、その 3 ファイルでだけ効いていなかった
      // （`ai/chat/route.ts` / `ai/tags/route.ts` / `ai/ai-knowledge/pii-sanitizer.ts`。
      //  うち 2 つは PII マスクと prompt-injection の判定対象という最悪の位置）。
      if (c === '/' && isRegexStart(out)) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') break;            // 行内で閉じない＝正規表現ではなかった
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { j += 1; break; }
          j += 1;
        }
        // 🔴 **そのまま出す（空白へ潰さない）**。正規表現リテラルは**コメントではなくコード**で、
        // 潰すと「消しすぎ」になる——ガードが探している式が正規表現の中にある場合、
        // **判定が静かに空振りする**（コメント盲の逆向きの穴）。
        // ここでやりたいのは「引用符で文字列モードに入らないこと」だけ。
        out += src.slice(i, j);
        i = j;
        continue;
      }
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
