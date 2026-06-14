// 招待コードを引き換えてコミュニティ会員になる。
//   - コード検証（存在/active/未使用/未失効）→ used 化 → noxa_users/{uid} 作成
//   - 招待元へ notification_inbox で通知（連帯責任はなし。invitedBy は監査用に記録）
//   - 多重アカ対策は MVP では UID＋IP の記録のみ
// 既に会員なら何もせず ok（コードは消費しない）。
//
// POST { code } -> { ok, alreadyMember? }

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

// 新規会員に付与する初期招待枠（シード期は太め。運営が後で調整＝ダイヤル制）
const INITIAL_INVITE_CREDITS = 5;

class RedeemError extends Error {}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const code: string | undefined = typeof body?.code === 'string' ? body.code.trim() : undefined;
    if (!code) return NextResponse.json({ error: '招待コードを入力してください' }, { status: 400 });

    const db = getAdminDb();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

    const inviteRef = db.doc(`noxa_invites/${code}`);
    const userRef = db.doc(`noxa_users/${uid}`);
    const accSnap = await db.doc(`account_users/${uid}`).get();
    const isAdmin = (accSnap.data() as { platformRole?: string } | undefined)?.platformRole === 'admin';

    let alreadyMember = false;
    let issuedBy: string | null = null;

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (isAdmin || userSnap.exists) { alreadyMember = true; return; } // 既に会員＝コード消費しない

      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) throw new RedeemError('招待コードが見つかりません');
      const inv = inviteSnap.data() as { status?: string; expiresAt?: Timestamp; usedBy?: string | null; issuedBy?: string };
      if (inv.status !== 'active' || inv.usedBy) throw new RedeemError('この招待コードは既に使用済みです');
      if (inv.expiresAt instanceof Timestamp && inv.expiresAt.toMillis() < Date.now()) throw new RedeemError('この招待コードは期限切れです');
      issuedBy = inv.issuedBy ?? null;

      tx.update(inviteRef, { status: 'used', usedBy: uid, usedAt: Timestamp.now() });
      tx.set(userRef, {
        uid,
        invitedBy: issuedBy,
        invitedAt: Timestamp.now(),
        inviteCredits: INITIAL_INVITE_CREDITS,
        invitePrivilegeRevoked: false,
        signupIp: ip, // 監査用（多重アカ検知）
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    // 招待元へ通知（トランザクション外・ベストエフォート）
    if (!alreadyMember && issuedBy) {
      await db.collection('notification_inbox').add({
        userId: issuedBy,
        kind: 'invite_used',
        title: '招待が使われました',
        body: 'あなたの招待からコミュニティに新しいメンバーが参加しました。',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true, alreadyMember });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof RedeemError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[api/community/redeem-invite] error:', e);
    return NextResponse.json({ error: '招待の引き換えに失敗しました' }, { status: 500 });
  }
}
