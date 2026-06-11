// プロファイル全項埋め報酬 API（profile_complete ミッション統合版）。
//
// 2026-05-12: ミッションシステムに統合済み。受領管理は reward_missions/{uid}.claimed.profile_complete
// に移行。互換のため account_subscriptions/{uid}.betaProfileRewardClaimedAt も並行で書き込む。
//
// 「全項目埋め」の判定基準:
//   - SelfBaseStyle の stageName / staffRole / gender / firstPerson /
//     defaultTone / emojiLevel の 6 項目すべて非空
//   - workspaceId を指定して該当 WS の SelfBaseStyle を見る（WS ごとに違うため
//     最初の 1 つの完成 WS で報酬付与）
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { tryClaimMission } from '../../missions/lib';
import { getMission } from '@/lib/missions';
import { FieldValue } from 'firebase-admin/firestore';

interface ClaimBody {
  workspaceId: string;
}

const REQUIRED_FIELDS = ['stageName', 'staffRole', 'gender', 'firstPerson', 'defaultTone', 'emojiLevel'] as const;

/** プロファイルの埋まり具合を診断（report 用） */
export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const wid = request.nextUrl.searchParams.get('workspaceId');
    if (!wid) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, wid);

    const db = getAdminDb();
    const [selfSnap, missionSnap] = await Promise.all([
      db.doc(`shop_shops/${wid}/ai_profile/self`).get(),
      db.doc(`reward_missions/${uid}`).get(),
    ]);
    const self = selfSnap.exists ? selfSnap.data() ?? {} : {};
    const missions = missionSnap.exists ? (missionSnap.data()?.claimed ?? {}) : {};

    const filled: Record<string, boolean> = {};
    let filledCount = 0;
    for (const k of REQUIRED_FIELDS) {
      const v = self[k];
      const ok = v !== undefined && v !== null && (typeof v !== 'string' || v.trim().length > 0);
      filled[k] = ok;
      if (ok) filledCount++;
    }

    const rewardAmount = getMission('profile_complete')?.rewardCredits ?? 10;

    return NextResponse.json({
      requiredFields: REQUIRED_FIELDS,
      filled,
      filledCount,
      requiredCount: REQUIRED_FIELDS.length,
      allFilled: filledCount === REQUIRED_FIELDS.length,
      rewardAmount,
      claimed: Boolean(missions.profile_complete),
      claimedAt: missions.profile_complete ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('GET beta-profile-reward failed:', error);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
}

/** 報酬を受領する（1 回限り） */
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as ClaimBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, body.workspaceId);

    const db = getAdminDb();
    // 個人ユーザーは personal_self_styles、shop は ai_profile/self
    const selfRef = db.doc(ctx.kind === 'shop'
      ? `shop_shops/${ctx.shopId}/ai_profile/self`
      : `personal_self_styles/${ctx.uid}`);

    // 全項埋めを確認
    const selfSnap = await selfRef.get();
    const self = selfSnap.exists ? selfSnap.data() ?? {} : {};
    for (const k of REQUIRED_FIELDS) {
      const v = self[k];
      const ok = v !== undefined && v !== null && (typeof v !== 'string' || v.trim().length > 0);
      if (!ok) {
        return NextResponse.json(
          { error: 'プロファイルが全項目埋まっていません', missing: k },
          { status: 400 },
        );
      }
    }

    // ミッションシステム経由で受領（冪等）。既受領なら granted: 0 が返る
    const claim = await tryClaimMission(uid, 'profile_complete');
    if (claim.alreadyClaimed) {
      return NextResponse.json({ error: '既に受け取り済みです' }, { status: 409 });
    }

    // 互換: 旧フィールドにも書き込む
    await db.doc(`account_subscriptions/${uid}`).set(
      { betaProfileRewardClaimedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return NextResponse.json({ ok: true, granted: claim.granted });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('POST beta-profile-reward failed:', error);
    return NextResponse.json({ error: '受領に失敗しました' }, { status: 500 });
  }
}
