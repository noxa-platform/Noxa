import { getAdminDb } from '@/app/api/lib/firebase-admin';
import type { StoreType } from '@/lib/types';

// 指定された scene × storeType で、匿名化済みの好評パターン（rating > 0）
// を直近から取得する。個別紐付け情報は含まれない。
export async function getGlobalSuccessPatterns(params: {
  source: 'reply' | 'message';
  scene: string | null;
  storeType: StoreType | null;
  limit?: number;
}): Promise<string[]> {
  const { source, scene, storeType, limit = 3 } = params;

  try {
    const db = getAdminDb();
    let query = db
      .collection('ai_knowledge/patterns/entries')
      .where('source', '==', source)
      .where('rating', '==', 1);

    if (scene) {
      query = query.where('scene', '==', scene);
    }
    if (storeType) {
      query = query.where('storeType', '==', storeType);
    }

    const snap = await query.orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs
      .map((doc) => (doc.data().sanitizedOutput as string) || '')
      .filter((s) => s.trim().length > 0);
  } catch (e) {
    // Firestore の複合インデックス未作成時はエラーになるため、
    // 失敗時は空配列で返して本処理を止めない
    console.error('getGlobalSuccessPatterns error:', e);
    return [];
  }
}

// 集計値から「このシーン × 業種ではどんな特徴の返信が刺さるか」のヒントを作る
export async function getAggregateHint(params: {
  source: 'reply' | 'message';
  scene: string | null;
  storeType: StoreType | null;
}): Promise<string | null> {
  const { source, scene, storeType } = params;
  if (!scene || !storeType) return null;

  try {
    const db = getAdminDb();
    const upKey = `${source}_${scene}_${storeType}_up`;
    const downKey = `${source}_${scene}_${storeType}_down`;

    const [upSnap, downSnap] = await Promise.all([
      db.doc(`ai_knowledge/aggregates/buckets/${upKey}`).get(),
      db.doc(`ai_knowledge/aggregates/buckets/${downKey}`).get(),
    ]);

    const up = upSnap.exists ? (upSnap.data()?.count as number) || 0 : 0;
    const down = downSnap.exists ? (downSnap.data()?.count as number) || 0 : 0;
    const total = up + down;

    // 統計的有意性が乏しいサンプル数は捨てる
    if (total < 10) return null;

    const rate = Math.round((up / total) * 100);
    return `このシーン・業種のサンプル ${total} 件中 👍率 ${rate}%。好評パターンに寄せて書いてください。`;
  } catch (e) {
    console.error('getAggregateHint error:', e);
    return null;
  }
}
