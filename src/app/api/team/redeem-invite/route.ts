// 店舗メンバー招待コードの受諾（被招待者本人が呼ぶ）。
//
// POST { shopId, code, displayName? } -> { ok, shopId, role, shopName }
//   - 招待の有効性（存在/未使用/期限内）を検証し、単一トランザクションで
//     members/{uid} 登録 + invites/{code}.usedBy 記録を行う（二重使用防止）。
//   - role が cast の場合は席回し名簿（seating_casts）と自動紐付け:
//       1. 既に uid 紐付け済みの名簿があれば何もしない
//       2. 同名 & uid 未設定の名簿があれば uid をセット（既存キャストの本人参加）
//       3. 無ければ新規作成（時給はオーナーが後から設定）
//     → これが「給与¥0」問題（seating_casts.uid 断線）の入口側の解消。
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

function toMs(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  if (typeof v === 'number') return v;
  return 0;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    const code: string | undefined = body?.code;
    const displayName: string = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (!shopId || typeof shopId !== 'string' || !code || typeof code !== 'string') {
      return NextResponse.json({ error: 'shopId と code は必須です' }, { status: 400 });
    }

    const db = getAdminDb();
    const shopSnap = await db.doc(`shop_shops/${shopId}`).get();
    if (!shopSnap.exists) return NextResponse.json({ error: 'お店が見つかりません' }, { status: 404 });
    const shopName = (shopSnap.data() as { name?: string } | undefined)?.name ?? '';

    // アカウントの表示名（displayName 未指定時のフォールバック）
    const userSnap = await db.doc(`account_users/${uid}`).get();
    const accountName = userSnap.exists ? ((userSnap.data() as { displayName?: string }).displayName ?? '') : '';
    const name = displayName || accountName || '新メンバー';

    const inviteRef = db.doc(`shop_shops/${shopId}/invites/${code}`);
    const memberRef = db.doc(`shop_shops/${shopId}/members/${uid}`);
    const castsCol = db.collection(`shop_shops/${shopId}/seating_casts`);

    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) return { status: 404 as const, error: '招待コードが見つかりません' };
      const invite = inviteSnap.data() as { role?: string; createdBy?: string; expiresAt?: unknown; usedBy?: string };
      if (invite.usedBy) return { status: 409 as const, error: 'この招待コードは使用済みです' };
      if (toMs(invite.expiresAt) < Date.now()) return { status: 410 as const, error: 'この招待コードは期限切れです' };

      const memberSnap = await tx.get(memberRef);
      if (memberSnap.exists) return { status: 409 as const, error: '既にこのお店のメンバーです' };

      const role = invite.role ?? 'cast';

      // cast は席回し名簿と紐付け（uid 済み > 同名未紐付け > 新規）
      if (role === 'cast') {
        const byUid = await tx.get(castsCol.where('uid', '==', uid).limit(1));
        if (byUid.empty) {
          const byName = await tx.get(castsCol.where('name', '==', name).limit(5));
          const unlinked = byName.docs.find((d) => !(d.data() as { uid?: string | null }).uid);
          if (unlinked) {
            tx.set(unlinked.ref, { uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          } else {
            tx.set(castsCol.doc(), {
              name, rank: '新人', hourlyWage: 0, isLocked: false, baseStatus: 'Free',
              uid, createdAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }

      tx.set(memberRef, {
        role,
        status: 'active',
        castDisplayName: name,
        invitedBy: invite.createdBy ?? null,
        addedVia: 'invite',
        joinedAt: FieldValue.serverTimestamp(),
      });
      tx.set(inviteRef, { usedBy: uid, usedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { status: 200 as const, role };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, shopId, role: result.role, shopName });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('redeem-invite error:', error);
    return NextResponse.json({ error: '招待の受諾に失敗しました' }, { status: 500 });
  }
}
