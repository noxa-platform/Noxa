/**
 * 「この通知が届く先（端末）があるか」の表示文言（純関数）。
 *
 * Day119 で `no-token`（通知対象なのに端末未登録で送れなかった）を運用者の統計には
 * 出したが、**本人の画面には何も出ていなかった**。通知設定は既定 ON で、画面上も
 * トグルが ON のまま。ところが端末が未登録なら通知は一件も届かず、利用者からは
 * 「設定は ON なのに来ない」としか見えない（＝画面が嘘をついている状態）。
 *
 * 併せて「確認できなかった」を「未登録」に倒さない。読み取り失敗を断定に変えると、
 * 通信エラーのたびに「未登録です」という誤った断定を出すことになる（今週の型①）。
 */
export type PushTargetState =
  /** notification_push_tokens/{uid} を読めなかった（未登録とは言い切れない） */
  | { kind: 'unknown' }
  /** doc が無い or token が空＝どの端末にも届かない */
  | { kind: 'none' }
  /** 登録済み */
  | { kind: 'registered'; platform?: string | null };

export interface PushTargetNotice {
  tone: 'warn' | 'info' | 'muted';
  text: string;
}

/** platform 文字列（'ios' / 'android' / 'web' / UA）を表示名に落とす */
export function describePlatform(platform: string | null | undefined): string {
  const p = (platform ?? '').toLowerCase();
  if (p === 'ios') return 'iOS 端末';
  if (p === 'android') return 'Android 端末';
  if (p === 'web') return 'ブラウザ';
  return '登録済みの端末';
}

export function describePushTarget(state: PushTargetState): PushTargetNotice {
  if (state.kind === 'registered') {
    return { tone: 'info', text: `通知先: ${describePlatform(state.platform)}（登録済み）` };
  }
  if (state.kind === 'unknown') {
    return {
      tone: 'muted',
      text: '通知先の端末を確認できませんでした。設定の保存はできますが、届く先があるかはこの画面では判断できません。',
    };
  }
  return {
    tone: 'warn',
    text: '通知先の端末が未登録です。ここでの設定は保存されますが、いまはどの端末にも届きません。Noxa アプリで通知を許可すると登録されます。',
  };
}
