/**
 * コミュニティ通報の集計 → 自動非表示トリガー
 *
 * noxa_reports/{reportId} の作成を監視し、同一対象（noxa_posts or noxa_comments）への
 * 「異なる通報者」の数を集計する。3 人以上から通報されたら対象に hidden=true を立て、
 * クライアントの一覧・詳細から除外させる（荒らし対策の最低ライン）。
 *
 * 設計:
 *   - 通報者は reporterUid で重複排除（同一人物が連打しても 1 とカウント）。
 *   - hidden / reportCount は CF(admin) のみが書く（rules で本人編集から保護済み）。
 *   - 閾値未満でも reportCount を更新し、admin 画面で件数が見えるようにする。
 *   - 既に hidden の対象は再計算不要（早期 return）。
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
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

    // 同一対象への通報を集計し、通報者(reporterUid)で重複排除
    const reportsSnap = await db()
      .collection('noxa_reports')
      .where('targetId', '==', targetId)
      .where('targetType', '==', targetType)
      .get()
      .catch(() => null);
    if (!reportsSnap) return;

    const reporters = new Set<string>();
    for (const r of reportsSnap.docs) {
      const uid = r.data().reporterUid;
      if (typeof uid === 'string' && uid) reporters.add(uid);
    }
    const distinct = reporters.size;

    await targetRef.set(
      { reportCount: distinct, ...(distinct >= HIDE_THRESHOLD ? { hidden: true, hiddenAt: FieldValue.serverTimestamp() } : {}) },
      { merge: true },
    );
  },
);
