'use client';

/**
 * コミュニティのバックエンド別ゲート。
 *  - firestore バックエンド（既定・Day10 本番化）: 認証必須（招待制クローズドの最低限の入口制御）。
 *    AuthGuard で囲い、ログイン済みユーザーの uid を CommunityClient に渡す。
 *  - mock バックエンド（NEXT_PUBLIC_COMMUNITY_BACKEND=mock 明示時）: 認証不要でそのまま表示（ローカル閲覧・モック用）。
 */

import { AuthGuard } from '@/components/AuthGuard';
import { CommunityClient } from './CommunityClient';
import { InviteGate } from './InviteGate';
import { isFirestoreCommunityBackend } from '@/lib/community/repository';

export function CommunityGate() {
  const useFirestore = isFirestoreCommunityBackend();

  if (useFirestore) {
    // ログイン必須 → さらに「招待制メンバー」のみ入室可
    return (
      <AuthGuard>
        {(user) => (
          <InviteGate>
            {(me) => <CommunityClient uid={user.uid} me={{ isAdmin: me.isAdmin, inviteCredits: me.inviteCredits }} />}
          </InviteGate>
        )}
      </AuthGuard>
    );
  }
  return <CommunityClient />;
}
