'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { db } from '@/lib/firebase/config';
import { describeFirestoreError } from '@/lib/firestore-error';
import { valueForScope, type ScopedSnapshot } from '@/lib/scoped-snapshot';
import type { User } from 'firebase/auth';

/** 未取得・別ユーザーのときに使う空値（プランは確定していない） */
const EMPTY_SUB: { sub: Sub | null; error: string | null } = { sub: null, error: null };

interface Sub {
  planTier: string;
  status?: string;
  aiCreditsTotal: number;
  aiCreditsUsed?: number;
  purchasedCredits?: number;
  currentPeriodEnd?: { seconds: number } | null;
}

function SubscriptionView({ user }: { user: User }) {
  /**
   * 契約情報は**出所（uid）つき**で持ち、読み取り失敗と「未加入」を区別する（Day123）。
   * 旧実装は `getDoc` に catch が無く、失敗しても `sub` は null のまま＝**課金していても
   * 「Noxa Free」と表示**していた（残クレジットも 0 と出る）。金額に関わる表示で
   * 「確認できなかった」を「無料プラン」に倒すのは、今週ずっと直してきた偽の情報そのもの。
   */
  const [snapshot, setSnapshot] = useState<ScopedSnapshot<{ sub: Sub | null; error: string | null }> | null>(null);

  useEffect(() => {
    const uid = user.uid;
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, `account_subscriptions/${uid}`));
        if (alive) setSnapshot({ scope: uid, value: { sub: snap.exists() ? (snap.data() as Sub) : null, error: null } });
      } catch (e) {
        if (alive) setSnapshot({ scope: uid, value: { sub: null, error: describeFirestoreError(e, 'プラン情報の取得') } });
      }
    })();
    return () => { alive = false; };
  }, [user.uid]);

  const { sub, error: subError } = valueForScope(snapshot, user.uid, EMPTY_SUB);

  const planTier = sub?.planTier ?? 'free';
  // 読めなかったときに「Noxa Free」と言い切らない（課金済みでも無料に見える・Day123）
  const planLabel = subError
    ? '確認できませんでした'
    : planTier === 'free' ? 'Noxa Free' : `Noxa ${planTier.charAt(0).toUpperCase()}${planTier.slice(1)}`;

  return (
    <AccountShell user={user}>
      <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Account · Plan</div>
      <h1 className="noxa-h1" style={{ margin: '0 0 32px' }}>プラン・課金</h1>

      <div className="flex flex-col" style={{ gap: 20, maxWidth: 720 }}>
        <div
          className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #1A1228 0%, #221830 100%)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 'var(--noxa-radius-lg)',
            padding: 28,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute', top: -60, right: -60,
              width: 240, height: 240,
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.22) 0%, transparent 60%)',
            }}
          />
          <div className="relative">
            <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Current plan</div>
            <div
              style={{
                fontFamily: 'var(--noxa-font-display-en)',
                fontSize: 36,
                color: 'var(--noxa-text-primary)',
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              {planLabel}
            </div>
            {sub?.currentPeriodEnd && (
              <div style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>
                次回更新 {new Date(sub.currentPeriodEnd.seconds * 1000).toLocaleDateString('ja-JP')}
              </div>
            )}
          </div>
        </div>

        {subError && (
          <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: 0, padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>
            {subError} 下のプラン・クレジット残高は実際の契約を表していません（0 と表示されていても消費されているとは限りません）。画面を再読み込みしてください。
          </p>
        )}

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="noxa-card">
            <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Monthly</div>
            <div
              style={{
                fontFamily: 'var(--noxa-font-display-en)',
                fontSize: 32,
                color: 'var(--noxa-accent-primary-ink)',
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              {(sub?.aiCreditsTotal ?? 0).toLocaleString()}
            </div>
            <div style={{ color: 'var(--noxa-text-muted)', fontSize: 12, marginTop: 8 }}>
              月間 AI クレジット
            </div>
            <div className="noxa-hairline" style={{ margin: '14px 0' }} />
            <div style={{ color: 'var(--noxa-text-muted)', fontSize: 12 }}>
              使用済 {(sub?.aiCreditsUsed ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="noxa-card">
            <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Purchased</div>
            <div
              style={{
                fontFamily: 'var(--noxa-font-display-en)',
                fontSize: 32,
                color: 'var(--noxa-accent-primary-ink)',
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              {(sub?.purchasedCredits ?? 0).toLocaleString()}
            </div>
            <div style={{ color: 'var(--noxa-text-muted)', fontSize: 12, marginTop: 8 }}>
              追加購入クレジット
            </div>
            <div className="noxa-hairline" style={{ margin: '14px 0' }} />
            <div style={{ color: 'var(--noxa-text-muted)', fontSize: 12 }}>
              IAP 経由で永続
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 20,
            border: '1px solid rgba(184, 156, 251, 0.30)',
            borderRadius: 'var(--noxa-radius-md)',
            background: 'rgba(184, 156, 251, 0.06)',
            color: 'var(--noxa-accent-primary-faint)',
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          β 公開期間中はプラン変更 UI を停止しています。Pro / Business プランの正式提供は今後ご案内予定です。
        </div>
      </div>
    </AccountShell>
  );
}

export default function SubscriptionPage() {
  return <AuthGuard>{(user) => <SubscriptionView user={user} />}</AuthGuard>;
}
