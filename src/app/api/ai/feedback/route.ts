import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathAiFeedback } from '../../lib/access-context';
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

/**
 * グローバル集合学習（`ai_knowledge/*`＝**ワークスペース横断**の共有コレクション）へ
 * 寄与してよい source（Day101）。
 *
 * 読み出し側 `getGlobalSuccessPatterns` / `getAggregateHint` は
 * `source: 'reply' | 'message'`（LINE 返信案・メッセージ案）しか引かないため、
 * それ以外の source を書いても**誰も読まないまま横断コレクションに残るだけ**。
 * とくに `chat`（AI 経営アシスタントの回答）は売上・顧客名・メモを含む長文で、
 * 伏字化（sanitizePii）は短い返信案向けのベストエフォートなので取りこぼし面積が大きい。
 * workspaceId を保存しない設計＝後から特定ワークスペース分だけ消せないため、安全側に絞る。
 */
const CONTRIBUTABLE_SOURCES = new Set(['reply', 'message']);

/** 匿名化パターンとして保存する伏字化テキストの上限（他ワークスペースのプロンプトに載るため） */
const SANITIZED_MAX_LEN = 2000;

/** 本文系フィールドの合計バイト上限（1MB の doc 上限に当たって 500 になる前に弾く） */
const TEXT_MAX_BYTES = 1_000_000;

/**
 * Firestore の doc ID として安全かを判定する。
 * 集計キーは `source`/`scene`（クライアント入力）と `storeType`（WS doc 由来）を素で連結するため、
 * `/` を含む値だとパス階層が変わって**別ドキュメントを書き換え得る**。
 */
function isSafeDocId(id: string): boolean {
  if (!id || id.length > 200) return false;
  if (id.includes('/') || id === '.' || id === '..') return false;
  return !/^__.*__$/.test(id);
}

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
    const sourceStr = String(source);

    // 本文が極端に長い場合は保存前に弾く（Firestore の 1MB doc 上限に当たって 500 になる前に）
    const textBytes = Buffer.byteLength(
      outputStr + String(prompt || '') + String(notes || ''),
      'utf-8',
    );
    if (textBytes > TEXT_MAX_BYTES) {
      return NextResponse.json({ error: 'フィードバック本文が大きすぎます' }, { status: 413 });
    }

    const db = getAdminDb();

    // (1) ワークスペース内のフィードバック記録。
    //   - customerId あり: 顧客サブコレクションに保存（既存挙動）
    //   - customerId なし: workspace 直下の ai_chat_feedback に保存
    const feedbackPayload = {
      uid,
      source: sourceStr,
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
      // 顧客フィードバックは context helper で解決（ai/message が読む pathAiFeedback と一致・Day63PM）
      await db
        .collection(pathAiFeedback(ctx, customerId))
        .add(feedbackPayload);
    } else {
      // customerId なしの chat feedback は WS 直下。personal 等価コレクション未定義のため
      // 現状 shop 直下のまま（別 finding: personal 向け ai_chat_feedback は設計要）
      await db
        .collection(`shop_shops/${workspaceId}/ai_chat_feedback`)
        .add(feedbackPayload);
    }

    // (2) オプトイン時のみ、匿名化集合学習データを書き出す
    //     寄与できる source は CONTRIBUTABLE_SOURCES に限る（Day101。読み手のいない
    //     source をワークスペース横断コレクションへ出さない）
    try {
      const contributable =
        CONTRIBUTABLE_SOURCES.has(sourceStr) && outputStr.trim().length > 0;
      const wsSnap = contributable ? await db.doc(`shop_shops/${workspaceId}`).get() : null;
      const wsData = wsSnap?.exists ? wsSnap.data() : null;
      const optedIn = wsData?.aiContribution === true;

      if (optedIn) {
        const storeType = (wsData?.storeType as StoreType) || 'other';
        const sceneKey = scene ? String(scene) : 'generic';
        const sanitized = sanitizePii(outputStr).slice(0, SANITIZED_MAX_LEN);
        const features = extractStructuralFeatures(outputStr);

        // (2-a) 個別の匿名化パターンを保存（原文は保存しない、伏字化後のみ）
        await db.collection('ai_knowledge/patterns/entries').add({
          sanitizedOutput: sanitized,
          features,
          source: sourceStr,                  // 'reply' | 'message'
          scene: sceneKey,
          storeType,
          rating: normalizedRating,
          createdAt: FieldValue.serverTimestamp(),
          // workspaceId / customerId / uid は保存しない（非紐付け）
        });

        // (2-b) 集計カウンターを原子的に更新
        //   key: {source}_{scene}_{storeType}_{rating>0?up:down}
        //   `/` を含む値でパス階層が変わる（＝別 doc を書き換える）のを防ぐため安全性を検証し、
        //   危険なキーは集計だけスキップする（パターン保存は済んでいる）
        const bucketKey = `${sourceStr}_${sceneKey}_${storeType}_${normalizedRating > 0 ? 'up' : 'down'}`;
        if (isSafeDocId(bucketKey)) {
          await db.doc(`ai_knowledge/aggregates/buckets/${bucketKey}`).set({
            count: FieldValue.increment(1),
            source: sourceStr,
            scene: sceneKey,
            storeType,
            rating: normalizedRating,
            lastUpdatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } else {
          console.warn('skip aggregate: unsafe bucket key');
        }
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
