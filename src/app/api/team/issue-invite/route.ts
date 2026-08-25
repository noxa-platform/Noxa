// 店舗メンバー招待コードの発行（owner/manager 専用）。
//
// POST { shopId, role } -> { code, url, role, expiresAt }
//   role: 'cast' | 'manager' | 'accounting'
//   コードは shop_shops/{shopId}/invites/{code} に保存（7日で失効・1回使い切り）。
//   受諾は /api/team/redeem-invite（Admin SDK）で行い、使用済みは usedBy が付く。
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { requireShopRole } from '../../lib/team-auth';
import { isSafeDocId } from '../../lib/doc-id';
import { stampIrVersion } from '@/lib/ir-version';

const INVITE_ROLES = ['cast', 'manager', 'accounting'] as const;
type InviteRole = (typeof INVITE_ROLES)[number];
const EXPIRE_DAYS = 7;

/** 紛らわしい文字（0/O/1/I/L）を除いた 10 文字コード */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    const role: string | undefined = body?.role;
    // Admin SDK は rules をバイパスするため、パスに埋める id はここで検証する
    // （`/` 入りだと権限確認と書込の向き先がまとめてズレ、奇数セグメントでは
    //   db.doc() が throw して 500 になる。Day102 の横展開）
    if (!isSafeDocId(shopId)) {
      return NextResponse.json({ error: 'shopId は必須です' }, { status: 400 });
    }
    if (!role || !INVITE_ROLES.includes(role as InviteRole)) {
      return NextResponse.json({ error: `role は ${INVITE_ROLES.join('/')} のいずれかです` }, { status: 400 });
    }

    const db = getAdminDb();
    const auth = await requireShopRole(db, shopId, uid, ['owner', 'manager']);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const code = generateCode();
    const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRE_DAYS * 86400000);
    await db.doc(`shop_shops/${shopId}/invites/${code}`).set(stampIrVersion({
      role,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      // usedBy は未使用のうちは付けない（使用時に redeem API が書く）
    }));

    const origin = request.headers.get('origin') ?? request.nextUrl.origin;
    const url = `${origin}/store/join?shop=${encodeURIComponent(shopId)}&code=${encodeURIComponent(code)}`;
    return NextResponse.json({ code, url, role, expiresAt: expiresAt.toMillis() });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('issue-invite error:', error);
    return NextResponse.json({ error: '招待の発行に失敗しました' }, { status: 500 });
  }
}
