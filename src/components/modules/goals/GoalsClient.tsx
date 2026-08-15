'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, query, where, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { getActiveShop, pickShopId } from '@/lib/workspace';
import { activeMembershipIds } from '@/lib/membership';
import { computeGoalHistory } from '@/lib/goals/history';
import { businessMonthKey } from '@/lib/datetime';
import { currentBusinessYm, lastSixMonths } from '@/lib/goals/months';
import { describeFirestoreError } from '@/lib/firestore-error';

/**
 * 目標管理 — Noxa OS（実データ）
 * 目標は月別に personal_goals/{uid}/items/{YYYY-MM} に保存（Day13 履歴化）。
 * items/current は iOS/旧データ互換のため温存し、当月保存時に両方へ書く。
 * 過去月の達成率は「当時の目標」で計算（未記録の月のみ現在の目標で換算し注記）。
 * 実績は自分の売上（オーナー=店舗全体 / キャスト=自分の castUid）を月別集計。
 */

const mono = 'var(--noxa-font-mono)';
const display = 'var(--noxa-font-display-en)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

// 売上の月バケットは営業月基準（businessMonthKey）に統一。dayKey は既に businessDayKey。
function saleYm(d: DocumentData): string | null {
  if (typeof d.dayKey === 'string' && d.dayKey.length >= 7) return d.dayKey.slice(0, 7);
  const c = d.checkoutAt ?? d.createdAt;
  if (c && typeof c.toDate === 'function') return businessMonthKey(c.toDate());
  return null;
}

// 読み取りに失敗したかを一緒に返す（Day109）。旧実装は catch で握り潰しており、
// 権限エラー/通信断でも「今月の売上 0 円・達成率 0%」と**実績が無いのと同じ表示**になっていた。
type Perf = { byMonth: Record<string, number>; currentTypes: Record<string, number>; error?: string };

async function loadPerf(uid: string): Promise<Perf> {
  const byMonth: Record<string, number> = {};
  const currentTypes: Record<string, number> = {};
  const cur = currentBusinessYm();
  const add = (d: DocumentData) => {
    if (d.voided === true) return; // 取消は集計から除外
    const ym = saleYm(d);
    const amt = typeof d.amount === 'number' ? d.amount : 0;
    if (ym) byMonth[ym] = (byMonth[ym] ?? 0) + amt;
    if (ym === cur) {
      const t = (d.customerType as string) ?? 'regular';
      currentTypes[t] = (currentTypes[t] ?? 0) + amt;
    }
  };
  // アクティブ店舗にスコープ（WorkspaceSwitcher 尊重）。オーナー=全売上 / スタッフ=自分の売上
  try {
    const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid)));
    const ms = await getDocs(collection(db, `account_users/${uid}/memberships`));
    const { shopId, isOwner } = pickShopId(owned.docs.map((d) => d.id), activeMembershipIds(ms.docs), getActiveShop());
    if (shopId) {
      const col = collection(db, `shop_shops/${shopId}/sales`);
      // 期間クエリ化（Day13）: グラフに使うのは直近6ヶ月のみ。全件取得は read 数が
      // 蓄積で破綻する。オーナーは dayKey 範囲（単一フィールド index）、スタッフは
      // castUid 一致のみで取得しクライアント側で月フィルタ（複合 index を増やさない）
      const sixAgo = `${lastSixMonths()[0].ym}-01`;
      const ss = isOwner
        ? await getDocs(query(col, where('dayKey', '>=', sixAgo)))
        : await getDocs(query(col, where('castUid', '==', uid)));
      ss.forEach((x) => add(x.data()));
    }
  } catch (e) {
    return { byMonth, currentTypes, error: describeFirestoreError(e, '売上実績の読み込み') };
  }
  return { byMonth, currentTypes };
}

/** 月別目標の読み込み（items/{YYYY-MM}。current は当月のフォールバック互換） */
async function loadGoals(uid: string): Promise<{ byYm: Record<string, number>; currentGoal: number }> {
  const byYm: Record<string, number> = {};
  let currentGoal = 0;
  try {
    const snap = await getDocs(collection(db, `personal_goals/${uid}/items`));
    snap.forEach((d) => {
      const v = (d.data() as { goalSales?: number }).goalSales;
      if (typeof v !== 'number' || v <= 0) return;
      if (d.id === 'current') currentGoal = v;
      else if (/^\d{4}-\d{2}$/.test(d.id)) byYm[d.id] = v;
    });
  } catch { /* skip */ }
  // 当月の月別 doc があればそれが正（current は旧クライアント互換のミラー）
  const cur = currentBusinessYm();
  if (byYm[cur]) currentGoal = byYm[cur];
  return { byYm, currentGoal };
}

const TYPE_LABEL: Record<string, string> = { regular: '通常', initial: '初回', r_within: 'R内', r_after: 'R後' };
const TYPE_COLOR: Record<string, string> = { regular: 'var(--noxa-accent-primary)', initial: 'var(--noxa-accent-primary-ink)', r_within: '#67E8F9', r_after: '#7BE8A1' };

export function GoalsClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [goalSales, setGoalSales] = useState<number>(0);
  const [goalsByYm, setGoalsByYm] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number>(0);
  const [perf, setPerf] = useState<Perf>({ byMonth: {}, currentTypes: {} });
  const [saveError, setSaveError] = useState<string | null>(null);
  // 実績の読み取り失敗（0円表示と区別する・Day109）
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const g = await loadGoals(user.uid);
      if (alive) { setGoalsByYm(g.byYm); setGoalSales(g.currentGoal); setDraft(g.currentGoal); }
      const p = await loadPerf(user.uid).catch((e) => ({ byMonth: {}, currentTypes: {}, error: describeFirestoreError(e, '売上実績の読み込み') }));
      if (alive) { setPerf(p); setReadError(p.error ?? null); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [user.uid]);

  const months = useMemo(() => lastSixMonths(), []);
  const cur = currentBusinessYm();
  const actual = perf.byMonth[cur] ?? 0;
  const rate = goalSales > 0 ? Math.round((actual / goalSales) * 100) : 0;
  // 過去月は「当時の目標」で達成率を出す（未記録の月のみ現在の目標で換算・注記つき）
  const history = useMemo(
    () => computeGoalHistory(months, perf.byMonth, goalsByYm, goalSales, cur),
    [months, perf.byMonth, goalsByYm, goalSales, cur],
  );
  const hasEstimated = history.some((h) => h.estimated && h.rate > 0);
  const typeEntries = Object.entries(perf.currentTypes).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  const save = async () => {
    // 楽観更新は「失敗したら必ず元に戻す」までがセット。旧実装は巻き戻さずアラートだけ出していたため、
    // 保存できていないのに画面は新しい目標のまま残り、達成率まで保存されていない目標で計算されていた
    // （再読み込みすると元の目標に戻る＝どちらが本当か分からない）。
    const prevGoal = goalSales;
    const prevByYm = goalsByYm;
    setGoalSales(draft); setGoalsByYm((p) => ({ ...p, [cur]: draft })); setEditing(false); setSaveError(null);
    try {
      // 月別 doc が正本（履歴化・Day13）。current は iOS/旧クライアント互換のミラー
      await Promise.all([
        setDoc(doc(db, `personal_goals/${user.uid}/items/${cur}`), { goalSales: draft, ym: cur, updatedAt: serverTimestamp() }, { merge: true }),
        setDoc(doc(db, `personal_goals/${user.uid}/items/current`), { goalSales: draft, updatedAt: serverTimestamp() }, { merge: true }),
      ]);
    } catch (e) {
      setGoalSales(prevGoal); setGoalsByYm(prevByYm); setDraft(prevGoal);
      setSaveError(describeFirestoreError(e, '目標の保存'));
    }
  };

  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-25%', right: '-8%', width: 600, height: 400, background: 'radial-gradient(ellipse, rgba(167,139,250,0.10) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li><li aria-hidden>·</li><li>goals</li>
          </ol>
        </nav>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>ノクサ · 目標</div>
            <h1 className="noxa-display" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: display, fontStyle: 'italic', color: 'var(--noxa-accent-primary-ink)', fontWeight: 400 }}>№ 05</span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>目標</span>
            </h1>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)' }} />実データ
          </div>
        </div>

        {loading ? (
          <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
        ) : (
          <>
            {/* 実績が読めていないことの通知（0円・達成率0%と区別する） */}
            {readError && (
              <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{readError} 表示中の実績は正しくありません。</p>
            )}

            {/* 保存失敗の通知（握りつぶすと「保存できたつもり」になる） */}
            {saveError && (
              <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{saveError}</p>
            )}

            {/* 今月の目標 */}
            <section aria-label="今月の目標" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 className="noxa-eyebrow" style={{ fontSize: 11 }}>今月の目標</h2>
                {!editing ? (
                  <button type="button" onClick={() => { setDraft(goalSales); setEditing(true); }} style={chip}>目標を設定</button>
                ) : (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="number" value={draft} onChange={(e) => setDraft(Math.max(0, Number(e.target.value)))} inputMode="numeric"
                      style={{ width: 130, minHeight: 34, padding: '4px 10px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 14, fontFamily: mono }} />
                    <button type="button" onClick={save} style={{ ...chip, background: 'var(--noxa-accent-primary)', color: '#fff', borderColor: 'var(--noxa-accent-primary)' }}>保存</button>
                    <button type="button" onClick={() => setEditing(false)} style={chip}>取消</button>
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
                <Stat label="目標売上" value={goalSales > 0 ? yen(goalSales) : '未設定'} color="var(--noxa-text-muted)" />
                <Stat label="実績（今月）" value={yen(actual)} color="var(--noxa-accent-primary-ink)" big />
                <Stat label="達成率" value={goalSales > 0 ? `${rate}%` : '—'} color="var(--noxa-accent-primary-ink)" big />
              </div>

              <div role="progressbar" aria-valuenow={rate} aria-valuemin={0} aria-valuemax={100} style={{ height: 14, background: 'var(--noxa-surface-muted)', borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(rate, 100)}%`, height: '100%', background: 'linear-gradient(90deg, var(--noxa-accent-primary) 0%, var(--noxa-accent-primary-neon) 100%)', borderRadius: 7, boxShadow: '0 0 12px rgba(167,139,250,0.5)', transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginTop: 6 }}>
                <span>¥0</span><span>{goalSales > 0 ? yen(goalSales) : '目標未設定'}</span>
              </div>
            </section>

            {/* 今月の内訳（客層別・実データ） */}
            <section aria-label="今月の内訳" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)', marginBottom: 16 }}>
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 16 }}>今月の内訳（客層別）</h2>
              {typeEntries.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)' }}>今月の会計データはまだありません。</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {typeEntries.map(([t, v]) => {
                    const w = actual > 0 ? Math.round((v / actual) * 100) : 0;
                    return (
                      <li key={t} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13 }}>{TYPE_LABEL[t] ?? t}</span>
                          <span style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{yen(v)}<span style={{ color: 'var(--noxa-text-faint)', marginLeft: 8 }}>{w}%</span></span>
                        </div>
                        <div style={{ height: 6, background: 'var(--noxa-surface-muted)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${w}%`, height: '100%', background: TYPE_COLOR[t] ?? 'var(--noxa-accent-primary)', borderRadius: 3 }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 過去6ヶ月 */}
            <section aria-label="過去6ヶ月の達成率" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 'clamp(16px, 3vw, 24px)' }}>
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 20 }}>過去6ヶ月の達成率</h2>
              {goalSales > 0 || Object.keys(goalsByYm).length > 0
                ? (
                  <>
                    <HistoryChart data={history} />
                    {hasEstimated && (
                      <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
                        ※ 「~」付きの月は当時の目標が未記録のため、現在の目標額で換算した概算です（今後は毎月の目標が自動で記録されます）。
                      </p>
                    )}
                  </>
                )
                : <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)' }}>目標を設定すると達成率が表示されます。</p>}
            </section>

            <p style={{ margin: '16px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
              ※ 実績は会計（売上データ）から月別に自動集計。目標は本人のみ編集可（personal_goals）。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>{label}</span>
      <span style={{ fontFamily: display, fontSize: big ? 'clamp(28px, 5vw, 44px)' : 'clamp(22px, 4vw, 32px)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color, lineHeight: 1.0 }}>{value}</span>
    </div>
  );
}

const chip: React.CSSProperties = { appearance: 'none', cursor: 'pointer', minHeight: 32, padding: '5px 14px', borderRadius: 9999, fontSize: 12, background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)' };

// ── SVG バーチャート（実データ） ──
const CHART_W = 320, CHART_H = 100, BAR_W = 32;
const GAP = (CHART_W - BAR_W * 6) / 7;
function HistoryChart({ data }: { data: { label: string; rate: number; current: boolean; estimated?: boolean }[] }) {
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 24}`} width="100%" role="img" aria-label="過去6ヶ月の達成率" style={{ display: 'block', overflow: 'visible' }}>
      {[100, 50].map((v) => {
        const y = CHART_H - (v / 100) * CHART_H;
        return (
          <g key={v}>
            <line x1={0} y1={y} x2={CHART_W} y2={y} stroke="var(--noxa-border)" strokeWidth={0.8} strokeDasharray="3 3" />
            <text x={CHART_W + 4} y={y + 4} fontSize={9} fill="var(--noxa-text-faint)" fontFamily={mono}>{v}%</text>
          </g>
        );
      })}
      {data.map((m, i) => {
        const x = GAP + i * (BAR_W + GAP);
        const barH = (Math.min(m.rate, 100) / 100) * CHART_H;
        const y = CHART_H - barH;
        return (
          <g key={m.label}>
            <rect x={x} y={0} width={BAR_W} height={CHART_H} rx={4} fill="var(--noxa-surface-muted)" />
            <rect x={x} y={y} width={BAR_W} height={barH} rx={4} fill={m.current ? 'url(#goalGradCurrent)' : 'var(--noxa-surface-raised)'} opacity={m.current ? 1 : 0.75} />
            <text x={x + BAR_W / 2} y={y - 5} textAnchor="middle" fontSize={9} fontFamily={mono} fill={m.current ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)'} style={{ fontVariantNumeric: 'tabular-nums' }}>{m.estimated ? '~' : ''}{m.rate}%</text>
            <text x={x + BAR_W / 2} y={CHART_H + 16} textAnchor="middle" fontSize={10} fontFamily={mono} fill={m.current ? 'var(--noxa-text-primary)' : 'var(--noxa-text-faint)'}>{m.label}</text>
          </g>
        );
      })}
      <defs>
        <linearGradient id="goalGradCurrent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--noxa-accent-primary-ink)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--noxa-accent-primary)" stopOpacity="0.7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default GoalsClient;
