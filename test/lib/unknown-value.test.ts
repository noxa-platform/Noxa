import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isOverwritable, describeUnknownValue } from '@/lib/unknown-value';

// P157: yorulog が iOS 側で「未知値を丸めてから書き戻す」を潰し（P126 / P127）、
// **未知値をそのまま書き戻す**ようになった。**片側だけ直しても、もう片側が丸めれば台無し**なので
// Web 側を洗った結果、`TransportClient` の 3 経路が該当していた:
//   ① 状態を 1 つ進める（`NEXT_STATUS[req.status]`）
//   ② 車両を割り当てる（`status: req.status === 'waiting' ? 'assigned' : req.status`）
//   ③ 車両の状態を回す（`VEHICLE_STATUS_ORDER.indexOf(veh.status)`）
// いずれも**読むときに未知を既定へ丸めた値**から「次」を決めて書いていた。

const isReqStatus = (v: unknown) =>
  v === 'waiting' || v === 'assigned' || v === 'in_progress' || v === 'done';

describe('isOverwritable — 知らない値を丸めた結果で上書きしない', () => {
  it('知っている値は書いてよい', () => {
    for (const v of ['waiting', 'assigned', 'in_progress', 'done']) {
      expect(isOverwritable(v, isReqStatus)).toBe(true);
    }
  });

  // 「まだ誰も書いていない」と「他の書き手が書いた」は別のこと（P154-PM2 の切り分け）
  it('未設定は書いてよい（まだ誰も書いていない）', () => {
    for (const v of [undefined, null, '']) expect(isOverwritable(v, isReqStatus)).toBe(true);
  });

  // ⚠️ ここが本丸。丸めた既定値で上書きすると**別のアプリの状態が黙って消える**
  it('知らない値は書かない', () => {
    for (const v of ['snoozed', 'cancelled', 'arrived', 'なにか', 3, {}]) {
      expect(isOverwritable(v, isReqStatus)).toBe(false);
    }
  });
});

describe('describeUnknownValue — 黙って何も起きないのが一番まずい', () => {
  it('実際の値を見せる（押しても変わらない、で終わらせない）', () => {
    expect(describeUnknownValue('arrived')).toContain('arrived');
    expect(describeUnknownValue('arrived')).toContain('上書きしませんでした');
    expect(describeUnknownValue('arrived')).toContain('別のアプリ');
  });
  it('文字列でない値も読める形にする', () => {
    expect(describeUnknownValue(3)).toContain('3');
    expect(describeUnknownValue({ a: 1 })).toContain('"a"');
  });
});

// 丸めた値を書き戻す経路が復活したら気づけるようにする。
// ⚠️ ガード自体が空振りしないよう、**対象ファイルを実際に読めていること**も見る
describe('TransportClient の書き戻しが生の値で判断している', () => {
  const SRC = 'src/components/modules/transport/TransportClient.tsx';
  const src = readFileSync(SRC, 'utf8');

  it('走査対象が取れている（空振り防止）', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('VEHICLE_STATUS_ORDER');
  });

  it('読み込みで生の値を控えている（statusRaw）', () => {
    // 2 つの購読（リクエスト / 車両）の両方で控える
    expect([...src.matchAll(/statusRaw: v\.status/g)]).toHaveLength(2);
  });

  it('状態を書く 3 経路がすべて isOverwritable を通る', () => {
    expect([...src.matchAll(/isOverwritable\(/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('丸めた status から次を決める箇所が生の値の確認より後にある', () => {
    // `NEXT_STATUS[req.status]` の手前に isOverwritable があること
    const guard = src.indexOf('isOverwritable(req.statusRaw');
    const use = src.indexOf('NEXT_STATUS[req.status]');
    expect(guard).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(guard);
  });
});
