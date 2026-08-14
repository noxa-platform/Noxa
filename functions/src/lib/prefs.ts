/**
 * notificationPrefs ON のユーザー uid 一覧を取得するヘルパー。
 *
 * 母集団は「**通知を受け取り得る人**」＝
 *   - `notification_push_tokens/{uid}` を持つ人（端末登録済み＝実際に届く人）
 *   - `account_app_settings/{uid}` を持つ人（設定を保存したことがある人）
 * の和集合。設定 doc が無い uid には `DEFAULT_NOTIFICATION_PREFS` を適用する。
 *
 * Day119 の実バグ: 旧実装は `account_app_settings` を**全件走査するだけ**だった。
 * この doc は「通知設定画面で保存を押したとき」に初めて作られるため、
 * 既定 ON（birthday / nextAction / longTimeNoSee）のはずの利用者でも、
 * **設定画面を一度も開いていない限り通知の対象にすら入らなかった**
 * （端末登録を済ませて通知を待っている人へ、誕生日も期限も一度も届かない）。
 * 「既定値は ON」と書いてあるのに実際は「明示的に ON を保存した人だけ」になっていた。
 */
import { db } from '../admin';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefs,
  UserProfileLite,
} from '../types';

type PrefKey = keyof Required<NotificationPrefs>;

export async function listUidsWithPrefEnabled(key: PrefKey): Promise<string[]> {
  // v2: notificationPrefs は account_app_settings/{uid}.notificationPrefs に置く。
  // 端末登録済み（= push トークンあり）の uid も母集団に含め、設定が無ければ既定値で判定する。
  const [settingsSnap, tokensSnap] = await Promise.all([
    db().collection('account_app_settings').get(),
    db().collection('notification_push_tokens').get(),
  ]);

  const prefsByUid = new Map<string, NotificationPrefs>();
  settingsSnap.forEach((doc) => {
    const data = doc.data() as UserProfileLite | undefined;
    prefsByUid.set(doc.id, data?.notificationPrefs ?? {});
  });

  const candidates = new Set<string>([...prefsByUid.keys()]);
  tokensSnap.forEach((doc) => candidates.add(doc.id));

  const result: string[] = [];
  for (const uid of candidates) {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(prefsByUid.get(uid) ?? {}) };
    if (prefs[key]) result.push(uid);
  }
  return result;
}
