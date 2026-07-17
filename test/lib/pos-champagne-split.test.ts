import { describe, it, expect } from 'vitest';
import { calculatorReducer, createInitialState, type OrderItem } from '../../src/lib/pos/engine';
import { createDefaultStoreConfig } from '../../src/lib/pos/defaultConfig';

// シャンパンの「初回/リピートは1本だけ半額」統合→再分割（syncHalfOffOrders）の検証（Day42）。
// 金銭ロジックなのに従来ノーカバレッジだった領域。特に再入時の id 安定性を固定する。

const config = createDefaultStoreConfig();
const CHAMP = config.halfOffRules.champagneNames[0]; // 'リステル'
const PRICE = 20000; // blueToGold レンジ(35000-150000)外＝女子会分岐に落ちない

const champOrder = (id: string, count: number): OrderItem => ({
  id, name: CHAMP, baseName: CHAMP, price: PRICE, originalPrice: PRICE, count,
  canHalfOff: true, isHalfOff: false,
});

/** 指定 orders で customerType=initial に切り替えた後の champagne 行だけ返す */
function syncInitial(orders: OrderItem[]): OrderItem[] {
  const base = createInitialState(config);
  const next = calculatorReducer({ ...base, orders }, { type: 'SET_CUSTOMER_TYPE', payload: 'initial' }, config);
  return next.orders.filter((o) => o.baseName === CHAMP);
}

describe('シャンパン 1本半額の統合→再分割', () => {
  it('初回: 3本を「半額1本＋定価2本」に分割する', () => {
    const champs = syncInitial([champOrder('c1', 3)]);
    const half = champs.find((o) => o.isHalfOff);
    const full = champs.find((o) => !o.isHalfOff);
    expect(half).toMatchObject({ id: 'c1', count: 1, price: 10000 });   // floor(20000/2)
    expect(full).toMatchObject({ id: 'c1_full', count: 2, price: 20000 });
    // 総本数は保存
    expect(champs.reduce((s, o) => s + o.count, 0)).toBe(3);
  });

  it('1本のみのときは半額1本だけ（定価行を作らない）', () => {
    const champs = syncInitial([champOrder('c1', 1)]);
    expect(champs).toHaveLength(1);
    expect(champs[0]).toMatchObject({ id: 'c1', count: 1, isHalfOff: true });
  });

  it('再入安定性: 半額行を消して再同期しても id が _full_full… と伸びない', () => {
    // 1回目の分割結果
    const first = syncInitial([champOrder('c1', 3)]);
    // 半額行(id=c1)を消し、定価行(id=c1_full,count2)だけ残して再同期（ユーザー操作を模擬）
    const remaining = first.filter((o) => !o.isHalfOff); // [{id:'c1_full', count:2}]
    expect(remaining).toHaveLength(1);
    const second = syncInitial(remaining);
    const ids = second.map((o) => o.id).sort();
    // 修正後は base に正規化され c1 / c1_full の2種のみ（c1_full_full を作らない）
    expect(ids).toEqual(['c1', 'c1_full']);
    expect(second.some((o) => /_full_full/.test(o.id))).toBe(false);
    // 総本数(2)と半額1本の不変条件も維持
    expect(second.reduce((s, o) => s + o.count, 0)).toBe(2);
    expect(second.filter((o) => o.isHalfOff)).toHaveLength(1);
  });
});
