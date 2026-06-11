// 管理者用: testimonial の承認・拒否・公開用編集
//   - PATCH /api/feedback/[id]
//     body: { action: 'approve' | 'reject', approvedQuote?, approvedPersonaLabel?, approvedLocation? }
//     approve: status='approved' + publishedAt=now + 公開用フィールドを保存
//     reject:  status='rejected'
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { isAdmin } from '@/lib/admin';

async function requireAdmin(request: NextRequest): Promise<{ uid: string; email: string }> {
  const uid = await verifyRequest(request);
  const userRecord = await getAdminAuth().getUser(uid);
  const email = userRecord.email ?? null;
  if (!isAdmin(email)) {
    throw new Error('FORBIDDEN');
  }
  return { uid, email: email! };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await requireAdmin(request);
    const { id } = await context.params;
    const body = await request.json();
    const { action, approvedQuote, approvedPersonaLabel, approvedLocation } = body;

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'action は approve / reject のみ' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection('audit_testimonials').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
    }

    if (action === 'reject') {
      await ref.update({
        status: 'rejected',
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: email,
      });
      return NextResponse.json({ ok: true });
    }

    // approve: 公開用フィールドのバリデーション
    const quote = typeof approvedQuote === 'string' ? approvedQuote.trim() : '';
    const personaLabel = typeof approvedPersonaLabel === 'string' ? approvedPersonaLabel.trim() : '';
    const location = typeof approvedLocation === 'string' ? approvedLocation.trim() : '';

    if (!quote || quote.length > 500) {
      return NextResponse.json({ error: 'approvedQuote は 1〜500 字' }, { status: 400 });
    }
    if (!personaLabel || personaLabel.length > 50) {
      return NextResponse.json({ error: 'approvedPersonaLabel は 1〜50 字' }, { status: 400 });
    }
    if (location.length > 40) {
      return NextResponse.json({ error: 'approvedLocation は 40 字以内' }, { status: 400 });
    }

    const original = snap.data();
    if (!original?.allowPublish) {
      return NextResponse.json({ error: '掲載許諾がないため承認できません' }, { status: 400 });
    }

    await ref.update({
      status: 'approved',
      approvedQuote: quote,
      approvedPersonaLabel: personaLabel,
      approvedLocation: location,
      publishedAt: FieldValue.serverTimestamp(),
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: email,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
    }
    console.error('PATCH /api/feedback/[id] failed:', error);
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }
}
