/**
 * Firebase Auth の失敗を「利用者が次に何をすればいいか分かる日本語」に直す単一ヘルパー（Day125）。
 *
 * 旧実装は login / signup / reset / connections が**それぞれローカルの翻訳関数**を持ち、
 * 扱うコードがバラバラだった（`user-disabled` はどこにも無く、`requires-recent-login` は
 * connections だけ）。さらに連携ダイアログは例外を**一切見ずに**
 * 「パスワードが違うか、リンクに失敗しました。」と決めつけていた。
 *
 * 実害: 原因が `too-many-requests`（試行超過）でも「パスワードが違う」と出るため、
 * 利用者は正しいパスワードを打ち直し続け、**自分でロックを深める**。
 * 「失敗した」ではなく「**何が起きたか**」を出さないと、次の行動が選べない。
 *
 * 規約は `firestore-error.ts` に合わせる:
 *   - 未知コードは汎用文言＋括弧でコードを温存する（サポートで追えなくなるため落とさない）
 *   - 文言は「何が起きたか」＋「どうすればよいか」を含む
 */
import { errorCode } from '@/lib/firestore-error';

/** どの操作の最中か。同じコードでも案内が変わるため文脈を受け取る */
export type AuthContext = 'login' | 'signup' | 'link' | 'reset' | 'account';

/** 資格情報そのものの誤り。**ログイン画面では user-not-found も混ぜる**（ユーザー列挙対策） */
const CREDENTIAL_CODES = ['invalid-credential', 'invalid-login-credentials', 'wrong-password', 'user-not-found'];

/** 利用者が自分で閉じた＝失敗ではない（画面に何も出さない） */
const CANCELLED_CODES = ['popup-closed-by-user', 'cancelled-popup-request', 'user-cancelled'];

const MESSAGES: Record<string, string> = {
  'network-request-failed': 'ネットワークに接続できませんでした。通信状況を確認してもう一度お試しください。',
  'too-many-requests': '試行回数が多いため一時的に制限されています。しばらく時間をおいてからお試しください（パスワードを入れ直しても解除されません）。',
  'requires-recent-login': 'セキュリティのため、一度ログインし直してから操作してください。',
  'user-disabled': 'このアカウントは利用停止されています。運営にお問い合わせください。',
  'email-already-in-use': 'このメールアドレスは既に登録されています。',
  'credential-already-in-use': 'このログイン方法は既に別のアカウントで使われています。「アカウント統合」で1つにまとめられます。',
  'provider-already-linked': 'このログイン方法は既にこのアカウントへ連携済みです。',
  'invalid-email': 'メールアドレスの形式が正しくありません。',
  'missing-email': 'メールアドレスを入力してください。',
  'weak-password': 'パスワードが弱すぎます（8文字以上にしてください）。',
  'popup-blocked': 'ポップアップがブロックされました。ブラウザの設定で許可してからお試しください。',
  'operation-not-allowed': 'このログイン方法は現在利用できません。運営にお問い合わせください。',
  'unauthorized-domain': 'この URL からはログインできません。運営にお問い合わせください。',
};

/** 文脈ごとの「何ができなかったか」（未知の原因でも、せめて何が失敗したかは伝える） */
const FALLBACK: Record<AuthContext, string> = {
  login: 'ログインできませんでした。',
  signup: 'アカウントを作成できませんでした。',
  link: 'アカウントを連携できませんでした。',
  reset: 'パスワード再設定メールを送信できませんでした。',
  account: '操作に失敗しました。',
};

/** 資格情報の誤りの文言。ログインは「メールかパスワードのどちらか」に留める（列挙対策） */
function credentialText(ctx: AuthContext): string {
  if (ctx === 'login') return 'メールアドレスまたはパスワードが間違っています。';
  // 連携はメールアドレスが確定済みなので、パスワードだけを指摘してよい
  if (ctx === 'link') return 'パスワードが違います。';
  return 'メールアドレスまたはパスワードが正しくありません。';
}

/**
 * 認証の失敗を説明する。**利用者が自分でキャンセルした場合は null**（何も出さない）。
 *
 * @param e   捕まえた例外
 * @param ctx どの操作中か
 */
export function describeAuthError(e: unknown, ctx: AuthContext): string | null {
  const code = errorCode(e);
  if (!code) {
    // code を持たない Error は自前のガードが投げた説明文＝それ自体が案内
    if (e instanceof Error && e.message && !/^[A-Z_]+$/.test(e.message)) return e.message;
    return `${FALLBACK[ctx]}時間をおいてもう一度お試しください。`;
  }
  if (CANCELLED_CODES.includes(code)) return null;
  if (CREDENTIAL_CODES.includes(code)) return credentialText(ctx);
  const known = MESSAGES[code];
  if (known) return known;
  // 未知コードは決めつけない（「パスワードが違う」と言い切らない）。コードは温存する
  return `${FALLBACK[ctx]}時間をおいてもう一度お試しください。（${code}）`;
}

/** 再ログインが要るだけかどうか（画面から再ログイン導線を出したいときに使う） */
export function isRecentLoginRequired(e: unknown): boolean {
  return errorCode(e) === 'requires-recent-login';
}

/**
 * HTTP で返ってきた失敗（退会 CF 等）の説明。
 * **サーバが理由を返しているのに捨てない**——401 は再ログインで自力解決できるのに
 * 「サポートへお問い合わせください」と案内すると行き止まりになる（Day114 の同型）。
 */
export function describeHttpFailure(status: number, code: string | null, what: string): string {
  if (status === 401 || status === 403) {
    return `${what}できませんでした。ログインの有効期限が切れている可能性があります。一度ログアウトして再度ログインしてからお試しください。（${code ?? status}）`;
  }
  if (status >= 500) {
    return `${what}できませんでした。時間をおいてもう一度お試しください。解消しない場合は運営にお問い合わせください。（${code ?? status}）`;
  }
  return `${what}できませんでした。（${code ?? status}）`;
}
