// 紹介コードを使用する API。
//
// 動作:
//   - 呼び出し元（被招待者）が他人の紹介コードを入力 → 検証
//   - 同一ユーザーが既に redeem 済みなら 409
//   - 自分自身のコードは 400
//   - 検証成功時:
//     - account_subscriptions/{被招待者uid}.referredBy = 招待者uid を書き込み（記録）
//     - crm_referral_codes/{code}.usedCount += 1
//     - 被招待者に accept_referral ミッション付与（+20cr）
//     - 招待者に invite_first_friend ミッション付与（+50cr、初回のみ）
//
// セキュリティ:
//   - referredBy は 1 回限り（既に設定済みなら拒否、改ざん不可）
//   - 自分のコードは拒否
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { tryClaimMission } from '../../missions/lib';
import { FieldValue } from 'firebase-admin/firestore';

interface RedeemBody {
  code: string;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as RedeemBody;
    const rawCode = (body.code ?? '').trim().toUpperCase();
    if (!rawCode || rawCode.length < 4 || rawCode.length > 16) {
      return NextResponse.json({ error: 'コードを入力してください' }, { status: 400 });
    }

    const db = getAdminDb();
    const codeRef = db.doc(`crm_referral_codes/${rawCode}`);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      return NextResponse.json({ error: '無効なコードです' }, { status: 404 });
    }
    const codeData = codeSnap.data()!;
    const referrerUid = codeData.ownerUid as string | undefined;
    if (!referrerUid) {
      return NextResponse.json({ error: '無効なコードです' }, { status: 404 });
    }
    if (referrerUid === uid) {
      return NextResponse.json({ error: '自分のコードは使用できません' }, { status: 400 });
    }

    // referredBy を初回のみ書き込む（transaction で原子化）
    const subRef = db.doc(`account_subscriptions/${uid}`);
    const tx = await db.runTransaction(async (t) => {
      const subSnap = await t.get(subRef);
      const sub = subSnap.exists ? subSnap.data() ?? {} : {};
      if (sub.referredBy) {
        return { ok: false as const, reason: 'ALREADY_REDEEMED' as const };
      }
      t.set(
        subRef,
        {
          referredBy: referrerUid,
          referredAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      // 招待者側の usedCount を increment（race condition 許容、最終的に整合）
      t.set(codeRef, { usedCount: FieldValue.increment(1) }, { merge: true });
      return { ok: true as const };
    });

    if (!tx.ok) {
      return NextResponse.json({ error: '既に紹介コードを使用済みです' }, { status: 409 });
    }

    // 被招待者へ accept_referral 報酬（+20cr）
    const refereeReward = await tryClaimMission(uid, 'accept_referral');
    // 招待者へ invite_first_friend 報酬（+50cr、初回のみ）
    const referrerReward = await tryClaimMission(referrerUid, 'invite_first_friend');

    return NextResponse.json({
      ok: true,
      refereeCreditsGranted: refereeReward.granted,
      referrerCreditsGranted: referrerReward.granted,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('referral redeem error:', error);
    return NextResponse.json({ error: '紹介コード使用に失敗しました' }, { status: 500 });
  }
}
