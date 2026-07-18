import { describe, it, expect } from 'vitest';
import { reportDocId } from '../../src/lib/community/report-id';

// 通報 doc の決定的 ID（1ユーザー1対象=1通報の冪等化）の回帰。

describe('reportDocId', () => {
  it('kind_targetId_uid で決定的に組む', () => {
    expect(reportDocId('thread', 't1', 'u1')).toBe('thread_t1_u1');
    expect(reportDocId('reply', 'r9', 'u1')).toBe('reply_r9_u1');
  });

  it('同一ユーザー×同一対象は常に同じ ID（重複通報が同一 doc へ集約＝水増し不可）', () => {
    expect(reportDocId('thread', 't1', 'u1')).toBe(reportDocId('thread', 't1', 'u1'));
  });

  it('別ユーザー・別対象・別種別は別 ID（正当な通報は分離）', () => {
    const base = reportDocId('thread', 't1', 'u1');
    expect(reportDocId('thread', 't1', 'u2')).not.toBe(base); // 別ユーザー
    expect(reportDocId('thread', 't2', 'u1')).not.toBe(base); // 別対象
    expect(reportDocId('reply', 't1', 'u1')).not.toBe(base);  // 別種別
  });
});
