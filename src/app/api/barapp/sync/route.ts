import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';

// barapp売上データをNoxaのログに同期
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { wid, barId, yearMonth } = await request.json();

    if (!wid || !barId || !yearMonth) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, wid);

    const db = getAdminDb();

    // ワークスペースの linkedBarId を確認
    const wsSnap = await db.doc(`shop_shops/${wid}`).get();
    if (!wsSnap.exists || wsSnap.data()?.linkedBarId !== barId) {
      return NextResponse.json({ error: 'バー連携が一致しません' }, { status: 400 });
    }

    // barappの売上データを取得（bars/{barId}/sales）
    const salesSnap = await db.collection(`bars/${barId}/sales`).get();
    const barappSales = salesSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((s) => {
        const date = (s as Record<string, unknown>).date as string || '';
        return date.startsWith(yearMonth);
      });

    if (barappSales.length === 0) {
      return NextResponse.json({ success: true, synced: 0, message: '対象データなし' });
    }

    // barappのaffiliation（キャスト情報）を取得して名前→顧客マッチング用
    const affiliationsSnap = await db.collection('affiliations')
      .where('barId', '==', barId)
      .where('status', '==', 'active')
      .get();

    const castMap = new Map<string, string>(); // castUserId → castName
    affiliationsSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.castUserId && d.castName) {
        castMap.set(d.castUserId, d.castName);
      }
    });

    // Noxaの顧客一覧を取得（名前マッチング用）
    const customersSnap = await db.collection(`shop_shops/${wid}/customers`).get();
    const customersByName = new Map<string, string>(); // name → customerId
    customersSnap.docs.forEach((doc) => {
      const name = doc.data().name as string;
      if (name) customersByName.set(name, doc.id);
    });

    // 既存の同期済みログを確認（重複防止）
    const existingSyncSnap = await db.collection(`shop_shops/${wid}/barapp_sync_log`)
      .where('yearMonth', '==', yearMonth)
      .limit(1)
      .get();

    if (!existingSyncSnap.empty) {
      return NextResponse.json({ success: true, synced: 0, message: '同期済み' });
    }

    let synced = 0;

    for (const sale of barappSales) {
      const s = sale as Record<string, unknown>;
      const amount = (s.totalAmount as number) || (s.amount as number) || 0;
      const date = (s.date as string) || '';
      const castUserId = (s.castUserId as string) || '';
      const castName = castUserId ? castMap.get(castUserId) || '' : '';

      // キャスト名で顧客を検索（簡易マッチング）
      // barappの売上は「どのキャストの売上か」なので、キャスト自身のログとして保存
      if (amount > 0) {
        await db.collection(`shop_shops/${wid}/barapp_synced_sales`).add({
          source: 'barapp',
          barId,
          originalId: sale.id || '',
          date,
          amount,
          castUserId,
          castName,
          syncedAt: new Date(),
        });
        synced++;
      }
    }

    // 同期ログを保存（重複防止用）
    await db.collection(`shop_shops/${wid}/barapp_sync_log`).add({
      yearMonth,
      barId,
      syncedCount: synced,
      syncedAt: new Date(),
    });

    // ワークスペースの同期ステータスを更新
    await db.doc(`shop_shops/${wid}`).set({
      barappSyncStatus: {
        lastSyncAt: new Date(),
        syncedSalesCount: synced,
      },
    }, { merge: true });

    return NextResponse.json({ success: true, synced });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('barapp sync error:', error);
    return NextResponse.json({ error: '同期に失敗しました' }, { status: 500 });
  }
}
