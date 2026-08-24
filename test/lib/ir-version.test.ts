import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  IR_VERSION, IR_VERSION_LEGACY, IR_VERSION_FIELD,
  stampIrVersion, readIrVersion, isFutureIrVersion, nextIrVersion,
} from '@/lib/ir-version';

// 記録の版（段 3）。仕様 §1.7 の規則を固定する。
// 「後から足すと版判定ができなくなる」ため、スキーマが増える前に入れた。

describe('readIrVersion — 欠落を異常にしない', () => {
  // 既存データは全部欠落している。欠落を「不正」にすると全件が異常になる
  it('欠落は v0（IR 以前）として読む', () => {
    expect(readIrVersion({})).toBe(IR_VERSION_LEGACY);
    expect(readIrVersion(undefined)).toBe(IR_VERSION_LEGACY);
    expect(readIrVersion(null)).toBe(IR_VERSION_LEGACY);
    expect(readIrVersion('文字列')).toBe(IR_VERSION_LEGACY);
  });

  it('数値でない・壊れた値も v0 に倒す（例外にしない）', () => {
    expect(readIrVersion({ ir_version: 'v1' })).toBe(IR_VERSION_LEGACY);
    expect(readIrVersion({ ir_version: NaN })).toBe(IR_VERSION_LEGACY);
    expect(readIrVersion({ ir_version: Infinity })).toBe(IR_VERSION_LEGACY);
    expect(readIrVersion({ ir_version: -3 })).toBe(IR_VERSION_LEGACY);
  });

  it('正しい版はそのまま読む（小数は切り捨て）', () => {
    expect(readIrVersion({ ir_version: 1 })).toBe(1);
    expect(readIrVersion({ ir_version: 7 })).toBe(7);
    expect(readIrVersion({ ir_version: 2.9 })).toBe(2);
  });
});

describe('stampIrVersion — 新規作成でだけ使う', () => {
  it('版を持たないデータに現在の版を刻む', () => {
    expect(stampIrVersion({ amount: 1000 })).toEqual({ amount: 1000, [IR_VERSION_FIELD]: IR_VERSION });
  });

  it('元のフィールドを落とさない', () => {
    const out = stampIrVersion({ a: 1, b: null, c: { d: 2 } });
    expect(out.a).toBe(1);
    expect(out.b).toBeNull();
    expect(out.c).toEqual({ d: 2 });
  });

  // doc 全体のコピー（アカウント統合・担当移管）で元の版を運ぶ経路がある。
  // そこで現在の版へ化けさせると「いつの形か」が失われる
  it('既に版を持つデータは上書きしない', () => {
    expect(stampIrVersion({ ir_version: 5, x: 1 }).ir_version).toBe(5);
  });

  it('壊れた版を持つデータは現在の版で埋める', () => {
    expect(stampIrVersion({ ir_version: 'x', y: 1 }).ir_version).toBe(IR_VERSION);
  });
});

describe('isFutureIrVersion — 知らない版は読み取り専用（壊すより止める）', () => {
  it('現在の版より新しければ true', () => {
    expect(isFutureIrVersion({ ir_version: IR_VERSION + 1 })).toBe(true);
  });
  it('現在の版・古い版・欠落は false（読み書きしてよい）', () => {
    expect(isFutureIrVersion({ ir_version: IR_VERSION })).toBe(false);
    expect(isFutureIrVersion({ ir_version: IR_VERSION_LEGACY })).toBe(false);
    expect(isFutureIrVersion({})).toBe(false);
  });
});

describe('nextIrVersion — 移行は単調増加のみ', () => {
  it('現在値より低い版は返さない（古いコードが新しい doc を巻き戻さない）', () => {
    expect(nextIrVersion({ ir_version: 9 }, 1)).toBe(9);
  });
  it('現在値より高い目標なら上げる', () => {
    expect(nextIrVersion({ ir_version: 1 }, 3)).toBe(3);
  });
  it('欠落からは目標版へ上げられる', () => {
    expect(nextIrVersion({}, IR_VERSION)).toBe(IR_VERSION);
  });
});

// 規則そのものが破られていないかをソースで見張る。
// 「更新のたびに書き手の版を刻む」と、最後に書いた一番古いクライアントの版が残る（版の巻き戻り）。
describe('版の巻き戻りを作らない（更新経路で刻まない）', () => {
  // 版を刻む経路の一覧。**すべて新規作成点であること**を確認したうえで載せる。
  // （addDoc は常に新規／POS 会計は毎回新しい伝票）
  const files = [
    'src/lib/pos/store.ts',
    'src/components/modules/sales/SalesClient.tsx',
    'src/components/modules/customers/CustomersClient.tsx',
    'src/components/modules/schedule/ScheduleClient.tsx',
    'src/components/modules/attendance/AttendanceClient.tsx',
    'src/components/modules/business-card/BusinessCardClient.tsx',
    'src/components/modules/unpaid/UnpaidClient.tsx',
    'src/components/modules/risk/RiskClient.tsx',
    'src/components/modules/inventory/InventoryClient.tsx',
    'src/components/modules/transport/TransportClient.tsx',
    'src/components/modules/reservation/ReservationClient.tsx',
    'src/components/modules/trial/TrialClient.tsx',
  ];

  it.each(files)('%s は stampIrVersion を使っている', (f) => {
    expect(readFileSync(f, 'utf8')).toContain('stampIrVersion(');
  });

  it.each(files)('%s は merge 書き込みに版を刻んでいない', (f) => {
    const src = readFileSync(f, 'utf8');
    // stampIrVersion(...) と同じ呼び出しの中に merge: true が現れないこと
    for (const m of src.matchAll(/stampIrVersion\(/g)) {
      const open = src.indexOf('(', m.index!);
      let depth = 0, end = src.length;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      expect(src.slice(open, end)).not.toMatch(/merge:\s*true/);
    }
  });

  it('ir_version を直書きしている箇所が無い（ヘルパー経由に統一）', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/ir_version\s*:/);
    }
  });

  // 版を刻むのは新規作成だけ、という規則をリポジトリ全体で見張る。
  // updateDoc に stampIrVersion が現れたら、それは更新経路に刻んでいる＝版の巻き戻りの種
  it('updateDoc に stampIrVersion を渡している箇所が無い', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/updateDoc\([^)]*stampIrVersion/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
