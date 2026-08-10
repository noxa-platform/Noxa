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
import { resolveAccessContext, pathAiProfile } from '../../lib/access-context';
import { tryClaimMission } from '../../missions/lib';
import { getMission } from '@/lib/missions';
import { FieldValue } from 'firebase-admin/firestore';
import { REQUIRED_PROFILE_FIELDS, evaluateProfileCompletion } from './completion';
import { isSafeDocId } from '../../lib/doc-id';

interface ClaimBody {
  workspaceId: string;
}

/**
 * 旧実装（2026-05-12 のミッション統合より前）の受領記録。
 * 受領管理は reward_missions/{uid}.claimed.profile_complete へ移したが、
 * **旧受領者を reward_missions へバックフィルしていない**ため、この記録を見ないと
 * 旧実装で受け取り済みのユーザーが 2 度目の報酬を受け取れてしまう（二重受領）。
 */
function hasLegacyClaim(sub: Record<string, unknown> | undefined): boolean {
  return Boolean(sub?.betaProfileRewardClaimedAt);
}

/** プロファイルの埋まり具合を診断（report 用） */
export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const wid = request.nextUrl.searchParams.get('workspaceId');
    if (!wid) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    // Admin SDK は rules を通らないため、パスに埋める前に doc ID として検証する
    if (!isSafeDocId(wid)) {
      return NextResponse.json({ error: 'workspaceId が不正です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, wid);

    const db = getAdminDb();
    // personal は personal_self_styles、shop は ai_profile/self（POST と同じ context helper で解決）。
    // 旧実装は GET だけ生 shop パス固定で、personal ユーザーの診断が常に空＝報酬 UI が出せなかった。
    const [selfSnap, missionSnap, subSnap] = await Promise.all([
      db.doc(pathAiProfile(ctx)).get(),
      db.doc(`reward_missions/${uid}`).get(),
      db.doc(`account_subscriptions/${uid}`).get(),
    ]);
    const self = selfSnap.exists ? selfSnap.data() ?? {} : {};
    const missions = missionSnap.exists ? (missionSnap.data()?.claimed ?? {}) : {};
    const legacy = hasLegacyClaim(subSnap.exists ? subSnap.data() : undefined);

    const { filled, filledCount, requiredCount, allFilled } = evaluateProfileCompletion(self);
    const rewardAmount = getMission('profile_complete')?.rewardCredits ?? 10;

    return NextResponse.json({
      requiredFields: REQUIRED_PROFILE_FIELDS,
      filled,
      filledCount,
      requiredCount,
      allFilled,
      rewardAmount,
      // 旧実装で受領済みのユーザーにも「受け取る」ボタンを出さない（POST は 409 で弾かれる）
      claimed: Boolean(missions.profile_complete) || legacy,
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
    // Admin SDK は rules を通らないため、パスに埋める前に doc ID として検証する
    if (!isSafeDocId(body.workspaceId)) {
      return NextResponse.json({ error: 'workspaceId が不正です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, body.workspaceId);

    const db = getAdminDb();
    // 個人ユーザーは personal_self_styles、shop は ai_profile/self（GET と同一 helper で一致させる）
    const selfRef = db.doc(pathAiProfile(ctx));
    const subRef = db.doc(`account_subscriptions/${uid}`);

    // 全項埋めを確認（GET と同一の判定ヘルパーで一致させる）
    const [selfSnap, subSnap] = await Promise.all([selfRef.get(), subRef.get()]);
    const self = selfSnap.exists ? selfSnap.data() ?? {} : {};
    const completion = evaluateProfileCompletion(self);
    if (!completion.allFilled) {
      return NextResponse.json(
        { error: 'プロファイルが全項目埋まっていません', missing: completion.firstMissing },
        { status: 400 },
      );
    }

    // 旧実装の受領記録があれば受領済み扱い（reward_missions にバックフィルが無いため、
    // ここを見ないと旧受領者が 2 度目の報酬を受け取れてしまう）
    if (hasLegacyClaim(subSnap.exists ? subSnap.data() : undefined)) {
      return NextResponse.json({ error: '既に受け取り済みです' }, { status: 409 });
    }

    // ミッションシステム経由で受領（冪等）。既受領なら granted: 0 が返る
    const claim = await tryClaimMission(uid, 'profile_complete');
    if (claim.alreadyClaimed) {
      return NextResponse.json({ error: '既に受け取り済みです' }, { status: 409 });
    }

    // 互換: 旧フィールドにも書き込む。ここは付与済みクレジットの控えなので、
    // 失敗しても 500 にしない（報酬は既に確定しており、エラーを返すと利用者は
    // 「もらえなかった」と誤解して再試行 →「既に受け取り済み」で行き止まりになる）。
    try {
      await subRef.set(
        { betaProfileRewardClaimedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.error('beta-profile-reward: 互換フィールドの書込に失敗（報酬は付与済み）:', e);
    }

    return NextResponse.json({ ok: true, granted: claim.granted });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('POST beta-profile-reward failed:', error);
    return NextResponse.json({ error: '受領に失敗しました' }, { status: 500 });
  }
}
