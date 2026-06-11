// 管理者用: testimonial 一覧 + LP 公開用の承認済み一覧
//   - GET ?scope=admin   … 管理者のみ。全 status を新しい順に返す（最大 200 件）
//   - GET ?scope=public  … 認証不要。承認 + 掲載許諾済みのみを LP 配信形式で返す
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, verifyRequest, AuthError } from '../lib/firebase-admin';
import { isAdmin } from '@/lib/admin';
import type { PublishedTestimonial, Testimonial } from '@/lib/types';

const ADMIN_LIST_LIMIT = 200;
const PUBLIC_LIST_LIMIT = 12;

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get('scope') ?? 'admin';
  const db = getAdminDb();

  if (scope === 'public') {
    // LP 用: 承認 + 公開許諾 + publishedAt 降順
    const snap = await db
      .collection('audit_testimonials')
      .where('status', '==', 'approved')
      .where('allowPublish', '==', true)
      .orderBy('publishedAt', 'desc')
      .limit(PUBLIC_LIST_LIMIT)
      .get();

    const items: PublishedTestimonial[] = snap.docs
      .map((doc) => {
        const d = doc.data();
        // 承認時に編集済みフィールドを優先、欠落なら原文にフォールバック
        const quote: string = (d.approvedQuote as string | null) ?? (d.quote as string) ?? '';
        const personaLabel: string = (d.approvedPersonaLabel as string | null) ?? '';
        const location: string = (d.approvedLocation as string | null) ?? '';
        return {
          id: doc.id,
          quote,
          persona: personaLabel,
          location,
        };
      })
      .filter((t) => t.quote.length > 0 && t.persona.length > 0);

    return NextResponse.json({ items });
  }

  // scope=admin
  try {
    const uid = await verifyRequest(request);
    const userRecord = await getAdminAuth().getUser(uid);
    if (!isAdmin(userRecord.email)) {
      return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
    }
    const snap = await db
      .collection('audit_testimonials')
      .orderBy('createdAt', 'desc')
      .limit(ADMIN_LIST_LIMIT)
      .get();

    const items: Testimonial[] = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Testimonial, 'id'>),
    }));

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('GET /api/feedback failed:', error);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
}
