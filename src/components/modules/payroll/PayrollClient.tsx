'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, auth } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { useShopId } from '@/lib/useShopId';
import { getActiveShop } from '@/lib/workspace';
import { resolveShopIdState, SHOP_UNRESOLVED_TEXT, SHOP_NOT_FOUND_TEXT } from '@/lib/shop-id-state';
import { activeMembershipIds } from '@/lib/membership';
import { describeFirestoreError } from '@/lib/firestore-error';
import { Shell, Section, Empty, Eyebrow } from '@/components/modules/schedule/ScheduleClient';

/**
 * 給与 — Noxa OS（実データ・閲覧）
 * shop_shops/{shopId}/payrolls/{uid}/items を読む（本人/オーナー）。
 * 給与計算・確定はオーナー側（書込は owner/manager のみ）。ここは明細の閲覧。
 */
const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

type Period = { id: string; label: string; total: number; breakdown: { label: string; amount: number }[]; status: string };

function toMs(v: unknown): number { if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000; if (typeof v === 'number') return v; return 0; }

// 当月の勤務(shifts)×自分の時給(seating_casts.hourlyWage)から見込み給与(基本給)を算出
async function computeDraft(shopId: string, uid: string): Promise<Period | null> {
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  try {
    const sh = await getDocs(query(collection(db, `shop_shops/${shopId}/shifts`), where('castUid', '==', uid)));
    let mins = 0;
    sh.forEach((doc) => { const x = doc.data(); const date = (x.date as string) ?? ''; if (!date.startsWith(ym)) return; const s = toMs(x.startAt), e = toMs(x.endAt); if (s && e && e > s) mins += (e - s) / 60000; });
    if (mins <= 0) return null;
    const cw = await getDocs(query(collection(db, `shop_shops/${shopId}/seating_casts`), where('uid', '==', uid)));
    const wage = cw.empty ? 0 : ((cw.docs[0].data().hourlyWage as number) ?? 0);
    const hours = mins / 60;
    const base = Math.round(hours * wage);
    return { id: `draft-${ym}`, label: `${ym.replace('-', '年')}月（見込み）`, total: base, status: '見込み', breakdown: [{ label: `基本給（勤務 ${hours.toFixed(1)}h × 時給 ¥${wage.toLocaleString('ja-JP')}）`, amount: base }] };
  } catch { return null; }
}

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
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      // shopId 解決: device claims → アクティブ店舗（WorkspaceSwitcher 尊重）
      let shopId: string | null = device.isDevice ? device.shopId || null : null;
      try {
        if (!shopId) {
          // 読み取りは独立させ、失敗を「所属していない」と混ぜない（Day109・shop-id-state.ts）
          let failure: string | null = null;
          const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)))
            .then((snap) => snap.docs.map((d) => d.id))
            .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
          const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`))
            .then((snap) => activeMembershipIds(snap.docs))
            .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
          const st = resolveShopIdState({ owned, memberships: ms, active: getActiveShop() });
          if (st.unresolved) {
            // 未所属と言い切らず、確認できなかったことを出す（給与は「明細が無い」と誤解されやすい）
            if (alive) { setLoadError(failure ?? SHOP_UNRESOLVED_TEXT); setLoading(false); }
            return;
          }
          shopId = st.shopId;
        }
        if (!shopId) { if (alive) { setNoShop(true); setLoading(false); } return; }
        const snap = await getDocs(collection(db, `shop_shops/${shopId}/payrolls/${user.uid}/items`));
        const list: Period[] = []; snap.forEach((d) => list.push(mapPeriod(d.id, d.data())));
        // id（YYYY-MM）降順。label（"2026年12月" 等）の文字列比較だと 12月が 7月より下に並ぶ
        list.sort((a, b) => b.id.localeCompare(a.id));
        // 当月の確定明細が無ければ、勤務実績からの見込みを先頭に表示
        const draft = await computeDraft(shopId, user.uid);
        const merged = draft && !list.some((p) => p.id === draft.id) ? [draft, ...list] : list;
        if (alive) setPeriods(merged);
      } catch (e) {
        // 権限エラー等の握りつぶし＝「明細が無い」ように見える誤解を防ぐ
        if (alive) setLoadError(describeFirestoreError(e, '給与明細の読み込み'));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);

  return (
    <Shell title="給与" eyebrow="ノクサ · 給与" crumb="payroll">
      <PayrollFinalize user={user} />
      {loadError && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{loadError}</p>}
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : noShop ? (
        <Section label="給与"><Empty>{`${SHOP_NOT_FOUND_TEXT}店舗に所属すると給与明細が表示されます。`}</Empty></Section>
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

// ─────────────────────────────────────────────
// オーナー専用: 月次給与の確定
// ─────────────────────────────────────────────
type FinRow = { castUid: string; name: string; hours: number; wage: number; base: number; total: number; staleOpens?: number };
type Adj = { back: string; bonus: string; penalty: string };

async function finalizePost(body: unknown): Promise<{ period: string; rows: FinRow[] }> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('ログインが必要です');
  const res = await fetch('/api/team/finalize-payroll', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || '通信に失敗しました');
  return data as { period: string; rows: FinRow[] };
}

function PayrollFinalize({ user }: { user: User }) {
  const shop = useShopId(user);
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rows, setRows] = useState<FinRow[] | null>(null);
  const [adj, setAdj] = useState<Record<string, Adj>>({});
  const [wageOv, setWageOv] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // role ベース表示: オーナー(canManage) に加えて manager も確定可（API 側も owner/manager 許可）
  const [isManager, setIsManager] = useState(false);
  // role の**取得失敗**（権限が無いことと区別する・Day115）
  const [roleError, setRoleError] = useState<string | null>(null);
  useEffect(() => {
    if (!shop.shopId || shop.canManage) return;
    let alive = true;
    getDoc(doc(db, `shop_shops/${shop.shopId}/members/${user.uid}`))
      .then((s) => { if (alive) { setIsManager((s.data() as { role?: string } | undefined)?.role === 'manager'); setRoleError(null); } })
      // 取得失敗を「権限なし」と同一視しない（Day108 と同型）。通信断で店長の給与確定 UI が
      // 丸ごと消え、理由も出ないため「権限を剥奪された」ように見える
      .catch((e) => { if (alive) setRoleError(describeFirestoreError(e, '権限の確認')); });
    return () => { alive = false; };
  }, [shop.shopId, shop.canManage, user.uid]);

  // 権限を確認できなかったときは「非表示」で終わらせず理由を出す（Day115）
  if (!shop.loading && shop.shopId && !shop.canManage && !isManager && roleError) {
    return (
      <p role="alert" style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, fontSize: 13, color: 'var(--noxa-status-error)', background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>
        {roleError} 権限を確認できないため、給与の確定操作を表示していません。画面を再読み込みしてください。
      </p>
    );
  }
  if (shop.loading || !shop.shopId || (!shop.canManage && !isManager)) return null; // owner/manager 以外は非表示

  const [y, m] = ym.split('-').map(Number);
  const adjustmentsPayload = () => {
    const out: Record<string, { back: number; bonus: number; penalty: number }> = {};
    for (const [uid, a] of Object.entries(adj)) {
      const back = Number(a.back) || 0, bonus = Number(a.bonus) || 0, penalty = Number(a.penalty) || 0;
      if (back || bonus || penalty) out[uid] = { back, bonus, penalty };
    }
    return out;
  };
  const wageOverridesPayload = () => {
    const out: Record<string, number> = {};
    for (const [uid, w] of Object.entries(wageOv)) { const n = Number(w) || 0; if (n > 0) out[uid] = n; }
    return out;
  };

  const preview = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await finalizePost({ shopId: shop.shopId, year: y, month: m, dryRun: true, adjustments: adjustmentsPayload(), wageOverrides: wageOverridesPayload() }); setRows(r.rows); }
    catch (e) { setErr(e instanceof Error ? e.message : '計算に失敗しました'); }
    finally { setBusy(false); }
  };
  const finalize = async () => {
    if (!rows || busy) return;
    // 打刻漏れ（未計上時間）があるまま確定すると過少額で確定される——件数を明示して判断させる
    const stale = rows.reduce((s, r) => s + (r.staleOpens ?? 0), 0);
    const staleWarn = stale > 0 ? `\n\n⚠ 退勤打刻の無い勤務が ${stale} 件あり、給与時間に入っていません。このまま確定すると少ない額で確定されます（勤怠を締めてから再計算を推奨）。` : '';
    if (!window.confirm(`${ym} の給与を${rows.length}名分 確定します。よろしいですか？（再確定で上書き）${staleWarn}`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await finalizePost({ shopId: shop.shopId, year: y, month: m, adjustments: adjustmentsPayload(), wageOverrides: wageOverridesPayload() }); setMsg(`✓ ${r.period} を ${r.rows.length}名分 確定しました`); setRows(r.rows); }
    catch (e) { setErr(e instanceof Error ? e.message : '確定に失敗しました'); }
    finally { setBusy(false); }
  };

  const setA = (uid: string, k: keyof Adj, v: string) => setAdj((p) => {
    const cur: Adj = p[uid] ?? { back: '', bonus: '', penalty: '' };
    return { ...p, [uid]: { ...cur, [k]: v } };
  });
  const cell: React.CSSProperties = { fontFamily: mono, fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--noxa-divider)' };
  const adjInput: React.CSSProperties = { width: 72, padding: '4px 6px', borderRadius: 6, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 12, fontFamily: mono };

  return (
    <section style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-accent-primary)', borderRadius: 16, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16, fontWeight: 500, margin: 0 }}>給与の確定（オーナー / 店長）</h2>
        <input type="month" value={ym} onChange={(e) => { setYm(e.target.value); setRows(null); setMsg(null); }} style={{ ...adjInput, width: 150 }} />
        <button type="button" onClick={preview} disabled={busy} className="noxa-btn noxa-btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }}>{busy ? '計算中…' : '勤務から計算'}</button>
        {rows && rows.length > 0 && <button type="button" onClick={finalize} disabled={busy} className="noxa-btn noxa-btn-primary" style={{ fontSize: 12, padding: '6px 14px' }}>確定する</button>}
      </div>
      {err && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 8px' }}>{err}</p>}
      {msg && <p style={{ color: 'var(--noxa-status-success)', fontSize: 13, margin: '0 0 8px' }}>{msg}</p>}
      {rows && (rows.length === 0 ? (
        <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>この月に勤務記録のあるキャストがいません。</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 10 }}>
              {['キャスト', '時間', '時給', '基本給', 'バック', 'ボーナス', '控除', '合計'].map((h) => <th key={h} style={{ padding: '6px 8px', fontWeight: 500 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const a = adj[r.castUid] ?? { back: '', bonus: '', penalty: '' };
                const ovWage = Number(wageOv[r.castUid]) || 0;
                const effWage = ovWage > 0 ? ovWage : r.wage;
                const effBase = ovWage > 0 ? Math.round(r.hours * ovWage) : r.base;
                const total = effBase + (Number(a.back) || 0) + (Number(a.bonus) || 0) - Math.abs(Number(a.penalty) || 0);
                return (
                  <tr key={r.castUid}>
                    <td style={{ ...cell, fontFamily: 'var(--noxa-font-sans-jp)' }}>{r.name}
                      {r.wage === 0 && <span title="席回し名簿と未紐付け（時給0）。時給を直接入力するか、席回しのキャスト編集で紐付けてください" style={{ color: 'var(--noxa-status-error)', marginLeft: 4 }}>⚠</span>}
                      {(r.staleOpens ?? 0) > 0 && <span title={`退勤打刻の無い勤務が ${r.staleOpens} 件あり、給与時間に入っていません。本人の勤怠画面で締めてから再計算してください`} style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-status-warning)', marginLeft: 4 }}>打刻漏れ{r.staleOpens}</span>}
                    </td>
                    <td style={cell}>{r.hours}h</td>
                    <td style={cell}>
                      {r.wage === 0
                        ? <input value={wageOv[r.castUid] ?? ''} onChange={(e) => setWageOv((p) => ({ ...p, [r.castUid]: e.target.value }))} placeholder="時給" style={adjInput} inputMode="numeric" />
                        : <span>¥{effWage.toLocaleString('ja-JP')}</span>}
                    </td>
                    <td style={cell}>{yen(effBase)}</td>
                    <td style={cell}><input value={a.back} onChange={(e) => setA(r.castUid, 'back', e.target.value)} placeholder="0" style={adjInput} inputMode="numeric" /></td>
                    <td style={cell}><input value={a.bonus} onChange={(e) => setA(r.castUid, 'bonus', e.target.value)} placeholder="0" style={adjInput} inputMode="numeric" /></td>
                    <td style={cell}><input value={a.penalty} onChange={(e) => setA(r.castUid, 'penalty', e.target.value)} placeholder="0" style={adjInput} inputMode="numeric" /></td>
                    <td style={{ ...cell, color: 'var(--noxa-accent-primary-ink)', fontWeight: 700 }}>{yen(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>※ 基本給＝当月の勤務(shifts)×時給。調整を入れたら「確定する」で各キャストの明細に保存されます（再確定で上書き）。</p>
          {rows.some((r) => (r.staleOpens ?? 0) > 0) && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--noxa-status-warning)', margin: '6px 0 0' }}>
              ⚠ 「打刻漏れ」のあるキャストは退勤打刻の無い勤務が時間に入っていません。本人の勤怠画面（退勤忘れカード）で締めてから再計算すると正確になります。
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

export default PayrollClient;
