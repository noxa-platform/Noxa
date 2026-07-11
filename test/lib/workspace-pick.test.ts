import { describe, expect, it } from 'vitest';
import { pickShopId } from '../../src/lib/workspace';

// 操作対象店舗の解決（Day15 の「選択中でない店の設定を書き換える」事故の再発防止・Day25）

describe('pickShopId', () => {
  it('personal 選択は店舗なし', () => {
    expect(pickShopId(['s1'], ['s2'], 'personal')).toEqual({ shopId: null, isOwner: false });
  });
  it('アクティブ選択が owned/member にあればそれを尊重（先頭固定にしない）', () => {
    expect(pickShopId(['s1', 's2'], [], 's2')).toEqual({ shopId: 's2', isOwner: true });
    expect(pickShopId(['s1'], ['s3'], 's3')).toEqual({ shopId: 's3', isOwner: false });
  });
  it('アクティブ選択が無効（脱退済み等）なら owned 先頭 → member 先頭へフォールバック', () => {
    expect(pickShopId(['s1', 's2'], ['s3'], 'gone')).toEqual({ shopId: 's1', isOwner: true });
    expect(pickShopId([], ['s3'], 'gone')).toEqual({ shopId: 's3', isOwner: false });
  });
  it('未選択（null）は owned 先頭 → member 先頭 → null', () => {
    expect(pickShopId(['s1'], [], null)).toEqual({ shopId: 's1', isOwner: true });
    expect(pickShopId([], ['s3'], null)).toEqual({ shopId: 's3', isOwner: false });
    expect(pickShopId([], [], null)).toEqual({ shopId: null, isOwner: false });
  });
  it('owner 判定は owned 側の一致で決まる（member と重複しても owner）', () => {
    expect(pickShopId(['s1'], ['s1'], 's1')).toEqual({ shopId: 's1', isOwner: true });
  });
});
