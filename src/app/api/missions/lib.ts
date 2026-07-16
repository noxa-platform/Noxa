// ミッション受領のサーバー側共通ヘルパー。
//
// tryClaim(uid, missionId) は冪等。既に受領済みなら何もせず { granted: 0, alreadyClaimed: true }
// を返す。Firestore transaction で「未受領を確認 → claimed フラグを立てる」を原子化し、
// その後 grantBonusCredits で月次 used カウンタを減算する。
//
// 達成判定の前提:
//   各 API ルート / サービスが「達成条件を満たした」と判断した時点で本ヘルパーを呼ぶ。
//   条件チェック自体は呼び出し側の責任。本ヘルパーは「受領管理」のみを担当する。
import { getAdminDb } from '../lib/firebase-admin';
import { grantBonusCredits } from '../lib/credits';
import { FieldValue } from 'firebase-admin/firestore';
import { getMission, type MissionId } from '@/lib/missions';

export interface ClaimResult {
  granted: number;
  alreadyClaimed: boolean;
  missionId: string;
}

/**
 * ミッション受領を試みる。既に受領済みなら何もしない（冪等）。
 * 不明なミッション ID は granted: 0, alreadyClaimed: false（noop）扱い。
 */
export async function tryClaimMission(uid: string, missionId: MissionId | string): Promise<ClaimResult> {
  const def = getMission(missionId);
  if (!def) {
    return { granted: 0, alreadyClaimed: false, missionId };
  }

  const db = getAdminDb();
  const ref = db.doc(`reward_missions/${uid}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() ?? {} : {};
    const claimed = (data.claimed ?? {}) as Record<string, unknown>;
    if (claimed[missionId]) {
      return { ok: false as const };
    }
    tx.set(
      ref,
      {
        claimed: { [missionId]: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true as const };
  });

  if (!result.ok) {
    return { granted: 0, alreadyClaimed: true, missionId };
  }

  // 付与は claimed を立てた後（別 doc の月次カウンタ）。ここで失敗すると
  // 「受領済みなのにクレジット未付与」で報酬が永久消失し再受領も不可になるため、
  // 失敗したら claimed フラグを戻して再受領可能にする。
  // grantBonusCredits は単一 doc の runTransaction＝原子的で、適用前に throw なら未付与＝
  // フラグを戻しても二重付与にはならない。
  try {
    await grantBonusCredits(uid, def.rewardCredits);
  } catch (e) {
    await ref.set(
      { claimed: { [missionId]: FieldValue.delete() }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    ).catch(() => { /* 巻き戻しも失敗＝claimed は残るが、二重付与よりは安全側 */ });
    throw e;
  }
  return { granted: def.rewardCredits, alreadyClaimed: false, missionId };
}

/**
 * 指定 uid が達成済みの mission ID 一覧を返す。
 */
export async function getClaimedMissionIds(uid: string): Promise<Set<string>> {
  const db = getAdminDb();
  const snap = await db.doc(`reward_missions/${uid}`).get();
  if (!snap.exists) return new Set();
  const claimed = (snap.data()?.claimed ?? {}) as Record<string, unknown>;
  return new Set(Object.keys(claimed).filter((k) => Boolean(claimed[k])));
}
