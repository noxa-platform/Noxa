// 招待コードを発行する（ワンタイム・7日失効）。
//   - admin: 無制限に発行可
//   - 会員: inviteCredits>0 かつ 発行権停止(invitePrivilegeRevoked)でないこと。1発行で1消費。
// クレジット消費と発行はトランザクションで原子的に行う（同時押しでマイナスにしない）。
//
// POST {} -> { code, expiresAt(ISO|null), inviteCredits(残・admin は null) }

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

function genCode(): string {
  // URL-safe・推測困難な短いコード
  return randomBytes(9).toString('base64url');
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const db = getAdminDb();

    const accSnap = await db.doc(`account_users/${uid}`).get();
    const isAdmin = (accSnap.data() as { platformRole?: string } | undefined)?.platformRole === 'admin';

    const code = genCode();
    const inviteRef = db.doc(`noxa_invites/${code}`);
    const userRef = db.doc(`noxa_users/${uid}`);
    const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_MS);

    let remaining: number | null = null;

    await db.runTransaction(async (tx) => {
      const inviteBase = {
        code, issuedBy: uid, issuedAt: Timestamp.now(), expiresAt,
        status: 'active', usedBy: null, usedAt: null,
      };
      if (isAdmin) {
        tx.set(inviteRef, inviteBase);
        return;
      }
      // 会員: クレジット・発行権を検証して消費
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new AuthError('コミュニティのメンバーではありません');
      const u = userSnap.data() as { inviteCredits?: number; invitePrivilegeRevoked?: boolean };
      if (u.invitePrivilegeRevoked === true) throw new AuthError('招待の発行が停止されています');
      const credits = u.inviteCredits ?? 0;
      if (credits <= 0) throw new AuthError('招待枠が残っていません');
      remaining = credits - 1;
      tx.update(userRef, { inviteCredits: remaining, lastInviteIssuedAt: Timestamp.now() });
      tx.set(inviteRef, inviteBase);
    });

    return NextResponse.json({ code, expiresAt: expiresAt.toDate().toISOString(), inviteCredits: isAdmin ? null : remaining });
  } catch (e) {
    if (e instanceof AuthError) {
      // 権限・枠系は 403、トークン系は 401。メッセージで切り分け。
      const status = e.message.includes('トークン') ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('[api/community/issue-invite] error:', e);
    return NextResponse.json({ error: '招待コードの発行に失敗しました' }, { status: 500 });
  }
}
