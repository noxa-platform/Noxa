import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { FieldValue } from 'firebase-admin/firestore';
import { sanitizePii, extractStructuralFeatures } from '@/lib/ai-knowledge/pii-sanitizer';
import type { StoreType } from '@/lib/types';

// AI 生成物への 👍/👎 フィードバックを保存
// 加えてワークスペースが aiContribution にオプトインしている場合、
// PII 除去済みテキスト + 構造特徴 + 集計値を ai_knowledge/* に書き出す。
//
// customerId は省略可: AI チャット (/ai) のような顧客に紐付かない場面では
// shop_shops/{wid}/ai_chat_feedback/{auto} に書く。
// threadId が指定されたら一緒に保存して、後から「どのトークで出た回答か」を辿れるようにする。
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const {
      workspaceId,
      customerId,
      threadId,
      messageTs,
      source,
      scene,
      prompt,
      output,
      rating,
      notes,
    } = await request.json().catch(() => ({}));

    if (!workspaceId || !source || typeof rating !== 'number') {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // rating は -1 / +1 のみ許可
    const normalizedRating = rating > 0 ? 1 : -1;
    const outputStr = String(output || '');

    const db = getAdminDb();

    // (1) ワークスペース内のフィードバック記録。
    //   - customerId あり: 顧客サブコレクションに保存（既存挙動）
    //   - customerId なし: workspace 直下の ai_chat_feedback に保存
    const feedbackPayload = {
      uid,
      source: String(source),
      scene: scene || null,
      prompt: prompt || null,
      output: outputStr,
      rating: normalizedRating,
      notes: notes || null,
      threadId: threadId || null,
      messageTs: typeof messageTs === 'number' ? messageTs : null,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (customerId) {
      await db
        .collection(`shop_shops/${workspaceId}/customers/${customerId}/ai_feedback`)
        .add(feedbackPayload);
    } else {
      await db
        .collection(`shop_shops/${workspaceId}/ai_chat_feedback`)
        .add(feedbackPayload);
    }

    // (2) オプトイン時のみ、匿名化集合学習データを書き出す
    try {
      const wsSnap = await db.doc(`shop_shops/${workspaceId}`).get();
      const wsData = wsSnap.exists ? wsSnap.data() : null;
      const optedIn = wsData?.aiContribution === true;

      if (optedIn && outputStr.trim().length > 0) {
        const storeType = (wsData?.storeType as StoreType) || 'other';
        const sanitized = sanitizePii(outputStr);
        const features = extractStructuralFeatures(outputStr);

        // (2-a) 個別の匿名化パターンを保存（原文は保存しない、伏字化後のみ）
        await db.collection('ai_knowledge/patterns/entries').add({
          sanitizedOutput: sanitized,
          features,
          source: String(source),             // 'reply' | 'message'
          scene: scene || 'generic',
          storeType,
          rating: normalizedRating,
          createdAt: FieldValue.serverTimestamp(),
          // workspaceId / customerId / uid は保存しない（非紐付け）
        });

        // (2-b) 集計カウンターを原子的に更新
        //   key: {source}_{scene}_{storeType}_{rating>0?up:down}
        const bucketKey = `${source}_${scene || 'generic'}_${storeType}_${normalizedRating > 0 ? 'up' : 'down'}`;
        await db.doc(`ai_knowledge/aggregates/buckets/${bucketKey}`).set({
          count: FieldValue.increment(1),
          source: String(source),
          scene: scene || 'generic',
          storeType,
          rating: normalizedRating,
          lastUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } catch (e) {
      // 匿名化書き出し失敗は致命的ではないので続行
      console.error('anonymized contribution error:', e);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI feedback error:', error);
    return NextResponse.json({ error: 'フィードバック保存失敗' }, { status: 500 });
  }
}
