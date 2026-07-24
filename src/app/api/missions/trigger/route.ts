// クライアント側のアクションでミッション達成を報告する API。
//
// 対応するミッション ID（クライアント側で達成判定可能なもの）:
//   - first_customer       : 顧客 1 件目を追加（顧客サービス側から）
//   - first_log            : 接触ログ 1 件目を追加
//   - add_5_customers      : 顧客 5 人以上を達成
//   - share_referral       : 紹介コードをコピー/シェア
//
// それ以外（profile_complete / invite_first_friend / accept_referral）は
// サーバー側の専用 API（beta-profile-reward / referral redeem）から直接 tryClaimMission を呼ぶ。
//
// セキュリティ: クライアントが任意のミッション ID で trigger を呼べると改ざんリスクが
// あるため、ここで受け付ける ID は ALLOWLIST に限定する。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathCustomers, pathCustomerLogs } from '../../lib/access-context';
import { tryClaimMission } from '../lib';
import type { MissionId } from '@/lib/missions';

// クライアントから trigger 可能なミッション ID のホワイトリスト
const CLIENT_TRIGGERABLE: readonly MissionId[] = [
  'first_customer',
  'first_log',
  'add_5_customers',
  'share_referral',
];

interface TriggerBody {
  missionId: string;
  /** 顧客 / ログ系ミッションで使用。サーバ側で実態を検証する */
  workspaceId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as TriggerBody;
    const { missionId, workspaceId } = body;

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: 'missionId は必須です' }, { status: 400 });
    }
    if (!(CLIENT_TRIGGERABLE as readonly string[]).includes(missionId)) {
      return NextResponse.json({ error: 'このミッションはクライアントから受領できません' }, { status: 400 });
    }

    // 顧客 / ログ系は実際の Firestore 状態をサーバで検証する（改ざん防止）
    if (missionId === 'first_customer' || missionId === 'first_log' || missionId === 'add_5_customers') {
      if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
      }
      const ctx = await resolveAccessContext(uid, workspaceId);

      const db = getAdminDb();
      // add_5_customers は 5 件、first_log は横断確認のため最大 5 件、それ以外は 1 件で足りる
      const customerFetchLimit = missionId === 'add_5_customers' || missionId === 'first_log' ? 5 : 1;
      const customersSnap = await db
        .collection(pathCustomers(ctx))
        .limit(customerFetchLimit)
        .get();

      const customerCount = customersSnap.size;

      if (missionId === 'first_customer' && customerCount < 1) {
        return NextResponse.json({ error: 'まだ顧客がいません' }, { status: 400 });
      }
      if (missionId === 'add_5_customers' && customerCount < 5) {
        return NextResponse.json({ error: '顧客が 5 人未満です' }, { status: 400 });
      }
      if (missionId === 'first_log') {
        // ログ 1 件以上を全顧客で横断確認（最大 5 顧客チェック、軽量化）。
        // 先頭顧客だけを見ると、2 件目以降の顧客に付けた初ログを取りこぼす（Day68 で修正）。
        const customerIds = customersSnap.docs.map((d) => d.id);
        if (customerIds.length === 0) {
          return NextResponse.json({ error: 'ログがありません' }, { status: 400 });
        }
        let hasLog = false;
        for (const cid of customerIds) {
          const logsSnap = await db
            .collection(pathCustomerLogs(ctx, cid))
            .limit(1)
            .get();
          if (!logsSnap.empty) {
            hasLog = true;
            break;
          }
        }
        if (!hasLog) {
          return NextResponse.json({ error: 'ログがまだありません' }, { status: 400 });
        }
      }
    }

    // share_referral は意思表示（コピー/シェアボタン押下）のみで OK
    const result = await tryClaimMission(uid, missionId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('missions trigger error:', error);
    return NextResponse.json({ error: 'ミッション処理に失敗しました' }, { status: 500 });
  }
}
