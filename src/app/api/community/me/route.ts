// コミュニティのメンバーシップ状態を返す。
//   isMember … admin もしくは noxa_users/{uid} が存在
//   inviteCredits … admin は null（無制限）、会員は残クレジット
//
// POST {} -> { isMember, isAdmin, inviteCredits, invitePrivilegeRevoked }

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const db = getAdminDb();

    const [accSnap, userSnap] = await Promise.all([
      db.doc(`account_users/${uid}`).get(),
      db.doc(`noxa_users/${uid}`).get(),
    ]);
    const isAdmin = (accSnap.data() as { platformRole?: string } | undefined)?.platformRole === 'admin';
    const u = userSnap.exists ? (userSnap.data() as { inviteCredits?: number; invitePrivilegeRevoked?: boolean }) : null;

    return NextResponse.json({
      isMember: isAdmin || userSnap.exists,
      isAdmin,
      inviteCredits: isAdmin ? null : (u?.inviteCredits ?? 0),
      invitePrivilegeRevoked: u?.invitePrivilegeRevoked === true,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error('[api/community/me] error:', e);
    return NextResponse.json({ error: 'メンバーシップ取得に失敗しました' }, { status: 500 });
  }
}
