import { describe, it, expect } from 'vitest';
import { describePushTarget, describePlatform } from '../../src/lib/push-target';

// 通知設定画面の「届く先」表示（Day120 のバグハント）。
// Day119 で `no-token`（対象なのに端末未登録で届かない）を運用者の統計には出したが、
// **本人の画面には何も出ていなかった**。既定 ON かつトグルも ON なのに一件も届かず、
// 利用者からは「設定は ON なのに来ない」としか見えない。

describe('describePushTarget（ON なのに届かない状態を隠さない）', () => {
  it('★端末未登録は警告として明示する（「保存はできるが届かない」と言い切る）', () => {
    const n = describePushTarget({ kind: 'none' });
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('未登録');
    expect(n.text).toContain('届きません');
  });

  it('★確認できなかったときは「未登録」と断定しない（読み取り失敗を否定に倒さない）', () => {
    const n = describePushTarget({ kind: 'unknown' });
    expect(n.tone).not.toBe('warn');
    expect(n.text).toContain('確認できませんでした');
    expect(n.text).not.toContain('未登録');
  });

  it('登録済みのときは届く先を示す（警告は出さない）', () => {
    const n = describePushTarget({ kind: 'registered', platform: 'ios' });
    expect(n.tone).toBe('info');
    expect(n.text).toContain('iOS 端末');
  });

  it('未知の platform 文字列（UA 等）でも壊れた表示にしない', () => {
    expect(describePlatform('Mozilla/5.0 (X11; Linux)')).toBe('登録済みの端末');
    expect(describePlatform(null)).toBe('登録済みの端末');
    expect(describePlatform('android')).toBe('Android 端末');
    expect(describePlatform('web')).toBe('ブラウザ');
  });
});
