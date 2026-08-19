import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../helpers/strip-comments';

// AI 原価の可視性ガード（Day126）。
//
// 「補助機能は無料・生成系は有料」で配る方針でも、**無料機能の原価はかかる**。
// 旧実装では 8 経路がクレジット消費も台帳記録も無しで LLM を呼んでおり、
// 1 店舗あたりの AI 原価が一切見えなかった（＝無料配布の上限を決められない）。
// 「課金するか」は経営判断だが、「記録するか」は選択の余地がない。

const AI_DIR = join(process.cwd(), 'src/app/api/ai');
const LLM_CALL = /generateText\(|generateChat\(|generateChatStream\(|analyzeImages\(/;
const METERED = /reserveAiCredit|logAiLedger|logAiUsage/;

function routes(): { name: string; src: string }[] {
  return readdirSync(AI_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, file: join(AI_DIR, e.name, 'route.ts') }))
    .filter((r) => existsSync(r.file))
    .map((r) => ({ name: r.name, src: stripComments(readFileSync(r.file, 'utf8')) }));
}

describe('AI 経路の原価可視性', () => {
  const all = routes();

  it('走査対象が取れている（パス破綻の空振り防止）', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it('★LLM を呼ぶ経路は必ず課金か記録のどちらかを通る（原価が見えない経路を作らない）', () => {
    const offenders = all.filter((r) => LLM_CALL.test(r.src) && !METERED.test(r.src)).map((r) => r.name);
    expect(offenders).toEqual([]);
  });

  it('★ガード自身が効いている（記録の無い経路を赤にできる）', () => {
    const bad = 'const raw = await generateText(prompt, {});';
    const good = "void logAiUsage(uid, 'x');\nconst raw = await generateText(prompt, {});";
    expect(LLM_CALL.test(bad) && !METERED.test(bad)).toBe(true);
    expect(LLM_CALL.test(good) && !METERED.test(good)).toBe(false);
  });
});
