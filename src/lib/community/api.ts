'use client';

/**
 * コミュニティ招待まわりのクライアント API ヘルパー。
 * すべて Firebase ID Token を Bearer で送り、サーバ(Admin SDK)で検証・処理する。
 * noxa_users / noxa_invites は rules で client 直書き不可（API 経由のみ）。
 */

import { auth } from '@/lib/firebase/config';

export interface CommunityMe {
  isMember: boolean;
  isAdmin: boolean;
  inviteCredits: number | null; // admin は null（無制限）
  invitePrivilegeRevoked: boolean;
}

async function authedPost<T>(path: string, body?: unknown): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('ログインが必要です');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || '通信に失敗しました');
  return data as T;
}

export function fetchCommunityMe(): Promise<CommunityMe> {
  return authedPost<CommunityMe>('/api/community/me');
}

export function issueInvite(): Promise<{ code: string; expiresAt: string | null; inviteCredits: number | null }> {
  return authedPost('/api/community/issue-invite');
}

export function redeemInvite(code: string): Promise<{ ok: boolean; alreadyMember?: boolean }> {
  return authedPost('/api/community/redeem-invite', { code });
}
