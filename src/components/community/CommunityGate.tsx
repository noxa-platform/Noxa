'use client';

/**
 * コミュニティのバックエンド別ゲート。
 *  - firestore バックエンド: 認証必須（招待制クローズドの最低限の入口制御）。
 *    AuthGuard で囲い、ログイン済みユーザーの uid を CommunityClient に渡す。
 *  - mock バックエンド（既定）: 認証不要でそのまま表示（ローカル閲覧・モック用）。
 */

import { AuthGuard } from '@/components/AuthGuard';
import { CommunityClient } from './CommunityClient';

export function CommunityGate() {
  const useFirestore = process.env.NEXT_PUBLIC_COMMUNITY_BACKEND === 'firestore';

  if (useFirestore) {
    return <AuthGuard>{(user) => <CommunityClient uid={user.uid} />}</AuthGuard>;
  }
  return <CommunityClient />;
}
