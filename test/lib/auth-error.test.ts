import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeAuthError, describeHttpFailure, isRecentLoginRequired } from '../../src/lib/auth-error';
import { stripComments } from '../helpers/strip-comments';

// 「失敗の理由を、確かめずに決めつけて案内する」（Day125）。
//
// 今週ずっと直してきた型①（確認失敗を確定的な否定にすり替える）の裏返し。
// 受け手は文言どおりの**間違った次の行動**を取る:
//   - 連携ダイアログ: 原因が試行超過でも「パスワードが違う」→ 正しいパスワードを打ち直し続ける
//   - 退会: 401（再ログインで直る）でも「サポートへお問い合わせください」→ 行き止まり
//   - 売上取消: 通信断でも「権限がありません」→ 権限を持つ本人が他人に依頼する
//   - ID 変更: 読み取り失敗でも「このIDは使用済みです」→ 空いている ID を諦める

const err = (code: string) => Object.assign(new Error('firebase'), { code });

describe('describeAuthError（原因を決めつけない）', () => {
  it('資格情報の誤りは、ログイン画面ではメール/パスワードのどちらかに留める（ユーザー列挙対策）', () => {
    expect(describeAuthError(err('auth/invalid-credential'), 'login')).toBe('メールアドレスまたはパスワードが間違っています。');
    // 存在しないメールも同じ文言に混ぜる（アカウントの有無を漏らさない）
    expect(describeAuthError(err('auth/user-not-found'), 'login')).toBe('メールアドレスまたはパスワードが間違っています。');
  });

  it('連携はメールが確定済みなのでパスワードだけを指摘してよい', () => {
    expect(describeAuthError(err('auth/wrong-password'), 'link')).toBe('パスワードが違います。');
  });

  it('★試行超過を「パスワードが違う」と言わない（打ち直しでロックを深めさせない）', () => {
    const msg = describeAuthError(err('auth/too-many-requests'), 'link');
    expect(msg).toContain('試行回数が多い');
    expect(msg).not.toContain('パスワードが違');
  });

  it('★通信断・利用停止・再ログイン要求はそれぞれ別の案内になる', () => {
    expect(describeAuthError(err('auth/network-request-failed'), 'login')).toContain('通信状況');
    expect(describeAuthError(err('auth/user-disabled'), 'login')).toContain('利用停止');
    expect(describeAuthError(err('auth/requires-recent-login'), 'account')).toContain('ログインし直して');
  });

  it('★未知コードは決めつけず、コードを温存する（サポートで追える）', () => {
    const msg = describeAuthError(err('auth/internal-error'), 'signup');
    expect(msg).toContain('アカウントを作成できませんでした。');
    expect(msg).toContain('（internal-error）');
  });

  it('★利用者が自分で閉じたポップアップは失敗として出さない（null）', () => {
    expect(describeAuthError(err('auth/popup-closed-by-user'), 'login')).toBeNull();
    expect(describeAuthError(err('auth/cancelled-popup-request'), 'login')).toBeNull();
  });

  it('code を持たない Error は自前ガードの説明文＝そのまま主文に使う', () => {
    expect(describeAuthError(new Error('最低1つのログイン方法が必要です'), 'account')).toBe('最低1つのログイン方法が必要です');
  });

  it('LAST_PROVIDER のような内部コードは主文にしない（利用者に読めない）', () => {
    expect(describeAuthError(new Error('LAST_PROVIDER'), 'account')).toContain('操作に失敗しました。');
  });

  it('文脈ごとに「何ができなかったか」が変わる', () => {
    expect(describeAuthError({}, 'reset')).toContain('パスワード再設定メールを送信できませんでした。');
    expect(describeAuthError({}, 'login')).toContain('ログインできませんでした。');
  });

  it('isRecentLoginRequired は再認証だけを拾う', () => {
    expect(isRecentLoginRequired(err('auth/requires-recent-login'))).toBe(true);
    expect(isRecentLoginRequired(err('auth/network-request-failed'))).toBe(false);
  });
});

describe('describeHttpFailure（サーバが返した理由を捨てない）', () => {
  it('★401 は再ログインを案内する（サポート問い合わせの行き止まりにしない）', () => {
    const msg = describeHttpFailure(401, 'UNAUTHORIZED', '退会処理');
    expect(msg).toContain('再度ログイン');
    expect(msg).not.toContain('サポートまでお問い合わせください。（');
    expect(msg).toContain('UNAUTHORIZED');
  });

  it('5xx はサーバ側の失敗として再試行＋問い合わせを案内する', () => {
    expect(describeHttpFailure(500, 'INTERNAL', '退会処理')).toContain('時間をおいて');
  });

  it('コードが取れなくても status を残す', () => {
    expect(describeHttpFailure(418, null, '退会処理')).toContain('418');
  });
});

// --- ガード: 原因を決めつける固定文言を増やさない ---

const TARGETS = [
  'src/components/auth/LinkAccountDialog.tsx',
  'src/app/account/login/page.tsx',
  'src/app/account/signup/page.tsx',
  'src/app/account/reset/page.tsx',
  'src/app/account/connections/page.tsx',
  'src/app/account/delete/page.tsx',
  'src/app/account/link/page.tsx',
  'src/app/store-login/page.tsx',
  'src/components/modules/sales/SalesClient.tsx',
  'src/components/modules/notifications/NotificationsClient.tsx',
];

/** 原因を名指しする表現（確かめずに出すと、受け手が間違った次の行動を取る） */
const VERDICT = /パスワードが違|権限がありません|通信に失敗|通信状態|使用済み|サポートまでお問い合わせ|status:\s*'taken'/;
/** 判断の根拠を示している印（例外の中身を見て分岐している） */
const EVIDENCE = /describeAuthError|describeFirestoreError|describeHttpFailure|isPermissionDenied|errorCode\(|instanceof Error/;

/**
 * catch の中で「根拠を示さずに原因を名指ししている」形を拾う。
 * 見るのは**式そのもの**（import の有無ではない・Day122 の教訓）。
 * `catch {`（例外を受け取らない）だけでなく `catch (e) {` も対象——例外を**受け取っていても
 * 中身を見ずに**決めつけていれば同じ実害になる（旧 delete 画面は `console.error(e)` だけして
 * 常に「サポートまでお問い合わせください」と出していた）。
 */
export function blindCatchVerdicts(src: string): string[] {
  const out: string[] = [];
  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i + 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(start, i);
    if (VERDICT.test(body) && !EVIDENCE.test(body)) out.push(body.replace(/\s+/g, ' ').trim().slice(0, 80));
  }
  return out;
}

describe('原因の断定ガード', () => {
  const files = TARGETS.map((p) => ({ path: p, src: stripComments(readFileSync(join(process.cwd(), p), 'utf8')) }));

  it('走査対象が取れている（パス破綻の空振り防止）', () => {
    expect(files).toHaveLength(TARGETS.length);
    for (const f of files) expect(f.src.length).toBeGreaterThan(200);
  });

  it('★例外を見ない catch で原因を名指ししていない', () => {
    const offenders: string[] = [];
    for (const f of files) for (const hit of blindCatchVerdicts(f.src)) offenders.push(`${f.path}: ${hit}`);
    expect(offenders).toEqual([]);
  });

  it('★認証画面がローカルの翻訳関数を持たない（文言の定義を割らない・Day122 の同型）', () => {
    const offenders = files
      .filter((f) => /function parse\w*(Auth|Signup|Reset)?Error\s*\(/.test(f.src))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('★ガード自身が効いている（旧実装の形を赤にできる）', () => {
    const old = "try { await link(); } catch { setError('パスワードが違うか、リンクに失敗しました。'); }";
    // 例外を受け取っていても中身を見ていなければ同じ（旧 delete 画面の形）
    const oldWithArg = "try { await del(); } catch (e) { console.error(e); setError('退会処理に失敗しました。サポートまでお問い合わせください'); }";
    const fixed = "try { await link(); } catch (e) { setError(describeAuthError(e, 'link')); }";
    // 根拠を示したうえでの名指しは正しい（権限エラーだと確かめてから権限の話をする）
    const evidenced = "try { await del(); } catch (e) { setOpError(isPermissionDenied(e) ? '権限がありません' : describeFirestoreError(e, '削除')); }";
    expect(blindCatchVerdicts(old)).toHaveLength(1);
    expect(blindCatchVerdicts(oldWithArg)).toHaveLength(1);
    expect(blindCatchVerdicts(fixed)).toHaveLength(0);
    expect(blindCatchVerdicts(evidenced)).toHaveLength(0);
  });

  it('★コメントを実装と誤検知しない（Day121-PM / Day123 / Day124 と同じ穴を開けない）', () => {
    const commented = "try { await link(); } catch (e) {\n  // 旧実装: catch { setError('パスワードが違う…') } と決めつけていた\n  setError(describeAuthError(e, 'link'));\n}";
    expect(blindCatchVerdicts(stripComments(commented))).toHaveLength(0);
  });
});
