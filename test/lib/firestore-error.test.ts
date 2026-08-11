import { describe, expect, it } from 'vitest';
import { describeFirestoreError, errorCode, isPermissionDenied } from '../../src/lib/firestore-error';

/**
 * 失敗文言の単一化（Day106）。
 * 目的は「現場スタッフが次に何をすればいいか分かる」こと＋「サポートが原因コードを追える」こと。
 * どちらかが欠けると回帰なので、両方を固定する。
 */

describe('errorCode', () => {
  it('Firestore の code をそのまま取る', () => {
    expect(errorCode({ code: 'permission-denied' })).toBe('permission-denied');
  });
  it('モジュール接頭辞つき（auth/...）は接頭辞を落とす', () => {
    expect(errorCode({ code: 'auth/network-request-failed' })).toBe('network-request-failed');
  });
  it('code を持たない例外・非オブジェクトは null', () => {
    expect(errorCode(new Error('boom'))).toBeNull();
    expect(errorCode(null)).toBeNull();
    expect(errorCode('permission-denied')).toBeNull();
    expect(errorCode({ code: 123 })).toBeNull();
    expect(errorCode({ code: '' })).toBeNull();
  });
});

describe('describeFirestoreError', () => {
  it('既知コードは「何が起きたか＋どうすればよいか」を日本語で返す', () => {
    const m = describeFirestoreError({ code: 'permission-denied' }, '売上の記録');
    expect(m).toContain('売上の記録に失敗しました');
    expect(m).toContain('権限がありません');
    expect(m).toContain('管理者');
  });
  it('原因コードは括弧書きで残す（サポート時の追跡に必要）', () => {
    expect(describeFirestoreError({ code: 'unavailable' }, '目標の保存')).toContain('（unavailable）');
  });
  it('what 省略時は先頭の「〜に失敗しました」を付けない', () => {
    const m = describeFirestoreError({ code: 'unauthenticated' });
    expect(m.startsWith('ログインの有効期限')).toBe(true);
  });
  it('未知コードでも操作名と原因を落とさない（汎用文言＋原因）', () => {
    const m = describeFirestoreError({ code: 'internal' }, '打刻の修正');
    expect(m).toContain('打刻の修正に失敗しました');
    expect(m).toContain('時間をおいて');
    expect(m).toContain('（internal）');
  });
  it('code を持たない Error（自前ガードの説明文）は message を主文にする', () => {
    // 「使用中の卓です」等は原因そのものが案内。汎用文言で包むと括弧の中に埋もれて読まれない
    const m = describeFirestoreError(new Error('この卓は使用中です'), '開卓');
    expect(m).toBe('開卓に失敗しました。この卓は使用中です');
    expect(m).not.toContain('時間をおいて');
  });
  it('原因が何も無くても文言だけは必ず出る（空文字にしない）', () => {
    expect(describeFirestoreError(undefined)).toBe('操作に失敗しました。時間をおいて再度お試しください。');
  });
  it('生の code/message だけを画面に出す旧挙動には戻さない（説明文を必ず含む）', () => {
    const m = describeFirestoreError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }, '勤怠の読み込み');
    expect(m).not.toContain('Missing or insufficient permissions.');
    expect(m.length).toBeGreaterThan('permission-denied'.length + 10);
  });
});

describe('isPermissionDenied', () => {
  it('permission-denied のみ true', () => {
    expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true);
    expect(isPermissionDenied({ code: 'unavailable' })).toBe(false);
    expect(isPermissionDenied(new Error('x'))).toBe(false);
  });
});
