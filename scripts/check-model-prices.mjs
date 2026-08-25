#!/usr/bin/env node
// OpenRouter の公開 API と src/lib/ai-models.ts の単価表を突き合わせる（P153 ④）。
//
// 表の単価は放置すると必ず失効する（実際 2026-05-12 の値のまま 19 行中 6 行がズレていた）。
// 原価の議論・ベンチマークのコスト概算がこの表を土台にしているので、
// 「安いつもりで高いモデルを回していた」を防ぐために定期的に流す。
//
//   node scripts/check-model-prices.mjs          … 差分を表示（差分があれば exit 1）
//   node scripts/check-model-prices.mjs --json   … 機械可読で出す
//
// ⚠️ 書き換えはしない（値の更新は人がレビューして入れる）。
// ⚠️ ネットワークが要るのでテストからは呼ばない（CI をネット依存にしない）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = join(here, '..', 'src', 'lib', 'ai-models.ts');
const ENDPOINT = 'https://openrouter.ai/api/v1/models';
const asJson = process.argv.includes('--json');

/** ai-models.ts から id と単価を読む（TS を実行せずに正規表現で拾う） */
function readTable() {
  const src = readFileSync(TABLE_PATH, 'utf-8');
  const re = /\{ id: '([^']+)',[^}]*?inputCostUsdPerM: ([0-9.]+), outputCostUsdPerM: ([0-9.]+)/g;
  const rows = [];
  for (const m of src.matchAll(re)) {
    rows.push({ id: m[1], input: Number(m[2]), output: Number(m[3]) });
  }
  if (rows.length === 0) throw new Error(`単価表を読み取れませんでした: ${TABLE_PATH}`);
  return rows;
}

async function fetchLive() {
  const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const body = await res.json();
  const map = new Map();
  for (const m of body.data ?? []) {
    const p = m.pricing ?? {};
    // 単価が無い / 数値にならないモデルは「分からない」として入れない（0 にしない）
    const input = Number(p.prompt) * 1e6;
    const output = Number(p.completion) * 1e6;
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    map.set(m.id, { input, output });
  }
  return map;
}

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);

try {
  const [table, live] = [readTable(), await fetchLive()];
  const drifted = [];
  const missing = [];
  for (const row of table) {
    const now = live.get(row.id);
    if (!now) { missing.push(row.id); continue; }
    if (!near(row.input, now.input) || !near(row.output, now.output)) {
      drifted.push({ id: row.id, table: row, live: now });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ checked: table.length, drifted, missing }, null, 2));
  } else {
    console.log(`照合: ${table.length} 行 / OpenRouter 公開 ${live.size} モデル`);
    for (const d of drifted) {
      console.log(
        `  差異 ${d.id}: 表 $${d.table.input}/$${d.table.output} → 実際 $${d.live.input}/$${d.live.output}`,
      );
    }
    for (const id of missing) console.log(`  ⚠️ 提供終了かリネーム: ${id}（OpenRouter に無い）`);
    if (drifted.length === 0 && missing.length === 0) console.log('  差分なし');
  }
  process.exit(drifted.length + missing.length > 0 ? 1 : 0);
} catch (e) {
  // ネットワーク断で「差分なし」と誤読させない
  console.error('照合できませんでした:', e instanceof Error ? e.message : e);
  process.exit(2);
}
