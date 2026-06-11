'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { getActiveShop, pickShopId } from '@/lib/workspace';
import { Shell, Section, Empty, Eyebrow } from '@/components/modules/schedule/ScheduleClient';

/**
 * 給与 — Noxa OS（実データ・閲覧）
 * shop_shops/{shopId}/payrolls/{uid}/items を読む（本人/オーナー）。
 * 給与計算・確定はオーナー側（書込は owner/manager のみ）。ここは明細の閲覧。
 */
const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

type Period = { id: string; label: string; total: number; breakdown: { label: string; amount: number }[]; status: string };

function mapPeriod(id: string, d: DocumentData): Period {
  const bd: { label: string; amount: number }[] = [];
  if (Array.isArray(d.breakdown)) for (const b of d.breakdown) bd.push({ label: (b.label as string) ?? '', amount: typeof b.amount === 'number' ? b.amount : 0 });
  else {
    for (const [k, label] of [['base', '基本給'], ['back', 'バック'], ['bonus', 'ボーナス'], ['penalty', '控除']] as const) {
      if (typeof d[k] === 'number') bd.push({ label, amount: d[k] as number });
    }
  }
  return {
    id,
    label: (d.label as string) ?? (d.period as string) ?? id,
    total: typeof d.total === 'number' ? d.total : (typeof d.amount === 'number' ? d.amount : bd.reduce((s, x) => s + x.amount, 0)),
    breakdown: bd,
    status: (d.status as string) ?? '',
  };
}

export function PayrollClient({ user }: { user: User }) {
  const device = useDeviceClaims(user);
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [noShop, setNoShop] = useState(false);

  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      // shopId 解決: device claims → アクティブ店舗（WorkspaceSwitcher 尊重）
      let shopId: string | null = device.isDevice ? device.shopId || null : null;
      try {
        if (!shopId) {
          const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
          const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
          shopId = pickShopId(owned.docs.map((d) => d.id), ms.docs.map((d) => d.id), getActiveShop()).shopId;
        }
        if (!shopId) { if (alive) { setNoShop(true); setLoading(false); } return; }
        const snap = await getDocs(collection(db, `shop_shops/${shopId}/payrolls/${user.uid}/items`));
        const list: Period[] = []; snap.forEach((d) => list.push(mapPeriod(d.id, d.data())));
        list.sort((a, b) => b.label.localeCompare(a.label));
        if (alive) setPeriods(list);
      } catch { /* skip */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);

  return (
    <Shell title="給与" eyebrow="Noxa OS · Payroll" crumb="payroll">
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : noShop ? (
        <Section label="給与"><Empty>所属店舗が見つかりません。店舗に所属すると給与明細が表示されます。</Empty></Section>
      ) : periods.length === 0 ? (
        <Section label="給与明細"><Empty>確定済みの給与明細はまだありません（オーナーが給与を確定するとここに表示されます）。</Empty></Section>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {periods.map((p) => (
            <section key={p.id} style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <h2 style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16, fontWeight: 500, margin: 0 }}>{p.label}{p.status ? <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginLeft: 8 }}>{p.status}</span> : null}</h2>
                <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--noxa-accent-primary-ink)' }}>{yen(p.total)}</span>
              </div>
              {p.breakdown.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
                  {p.breakdown.map((b, i) => (
                    <li key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--noxa-text-muted)' }}>{b.label}</span>
                      <span style={{ fontFamily: mono, fontVariantNumeric: 'tabular-nums', color: b.amount < 0 ? 'var(--noxa-status-error)' : 'var(--noxa-text-primary)' }}>{yen(b.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      <p style={{ margin: '16px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
        ※ 実データ（shop_shops/payrolls）。給与の確定・編集はオーナー権限で行います。
      </p>
    </Shell>
  );
}

export default PayrollClient;
