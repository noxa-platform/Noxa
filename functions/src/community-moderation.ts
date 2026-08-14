/**
 * コミュニティ通報の集計 → 自動非表示トリガー
 *
 * noxa_reports/{reportId} の作成を監視し、同一対象（noxa_posts or noxa_comments）への
 * 「異なる通報者」の数を集計する。3 人以上から通報されたら対象に hidden=true を立て、
 * クライアントの一覧・詳細から除外させる（荒らし対策の最低ライン）。
 *
 * 設計:
 *   - 通報者は reporterUid で重複排除（同一人物が連打しても 1 とカウント）。
 *   - 集計は「未解決」の通報のみ（status=='resolved' を除外）。admin が unhide + resolve
 *     した通報を数え続けると、一度閾値を超えたコンテンツは新規通報 1 件で即再非表示になり、
 *     管理者の unhide が無力化される。status 欠落は open 扱いで数える（iOS/旧 doc の回帰防止）。
 *   - hidden / reportCount は CF(admin) のみが書く（rules で本人編集から保護済み）。
 *   - 閾値未満でも reportCount を更新し、admin 画面で件数が見えるようにする。
 *   - 既に hidden の対象は再計算不要（早期 return）。
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

const REGION = 'asia-northeast1';
const HIDE_THRESHOLD = 3; // 異なる通報者がこの人数に達したら自動非表示

export const hideReportedContent = onDocumentCreated(
  { document: 'noxa_reports/{reportId}', region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const targetType = data.targetType as string | undefined; // 'thread' | 'reply'
    const targetId = data.targetId as string | undefined;
    if (!targetId || (targetType !== 'thread' && targetType !== 'reply')) return;

    const targetRef = db().doc(
      targetType === 'thread' ? `noxa_posts/${targetId}` : `noxa_comments/${targetId}`,
    );

    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) return; // 既に削除済み
    if (targetSnap.data()?.hidden === true) return; // 既に非表示なら再計算不要

    // 同一対象への通報を集計し、通報者(reporterUid)で重複排除。
    // クエリは equality 2つのまま（複合 index 不要）。status は集計ループで判定する。
    const reportsSnap = await db()
      .collection('noxa_reports')
      .where('targetId', '==', targetId)
      .where('targetType', '==', targetType)
      .get()
      .catch((e) => {
        // 読めなかったのを「通報ゼロ」と同じ扱い（何もせず return）にすると、
        // **閾値を超えた投稿が自動非表示にならないまま残る**（運営は気づけない）。
        // 記録して throw し、関数の失敗として再試行させる（Day118）
        logger.error('[community-moderation] 通報の集計に失敗したため自動非表示を保留する', { targetId, targetType, error: String(e) });
        throw e;
      });

    // 「未解決」の通報のみカウントする。admin が unhide + resolve した通報を数え続けると、
    // 一度閾値を超えたコンテンツは新規通報 1 件で即再非表示になり管理者の unhide が無力化される。
    // status 欠落（iOS/旧 doc 等）は open 扱いで数える＝除外は明示 resolved のみ（回帰防止）。
    const reporters = new Set<string>();
    for (const r of reportsSnap.docs) {
      const rd = r.data();
      if (rd.status === 'resolved') continue;
      const uid = rd.reporterUid;
      if (typeof uid === 'string' && uid) reporters.add(uid);
    }
    const distinct = reporters.size;

    await targetRef.set(
      { reportCount: distinct, ...(distinct >= HIDE_THRESHOLD ? { hidden: true, hiddenAt: FieldValue.serverTimestamp() } : {}) },
      { merge: true },
    );
  },
);
