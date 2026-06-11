'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import { useShopConfig } from '@/lib/shopConfig';

/**
 * 予約モジュール（実データ）
 *
 * 本日の予約タイムライン + VIP/常連 客リストを表示する。
 * 予約は shop_shops/{shopId}/reservations を読み書き（追加/編集/削除/ステータス遷移）。
 * VIP 客リストは既存の shop_shops/{shopId}/customers を読み取り（参照のみ）。
 */

const mono = 'var(--noxa-font-mono)';

// ステータス定義
type ReservationStatus = '未来店' | '来店済' | 'キャンセル';
const STATUSES: ReservationStatus[] = ['未来店', '来店済', 'キャンセル'];

type Reservation = {
  id: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  customerName: string;
  cast: string;       // 指名キャスト
  guests: number;
  seat: string;       // 卓番号
  status: ReservationStatus;
  memo?: string;
};

type VipGuest = {
  id: string;
  name: string;
  totalSales: number;
  visitCount: number;
  rank: string | null;
  vip: boolean;
  tags: string[];
};

// ---- ヘルパー ----
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_COLOR: Record<ReservationStatus, { text: string; bg: string; border: string }> = {
  '来店済':     { text: 'var(--noxa-status-success)',  bg: 'rgba(123,232,161,0.10)', border: 'rgba(123,232,161,0.30)' },
  '未来店':     { text: 'var(--noxa-text-muted)',       bg: 'rgba(255,255,255,0.05)', border: 'var(--noxa-border)' },
  'キャンセル': { text: 'var(--noxa-status-warning)',   bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.30)' },
};

function rankStyle(rank: string | null): { label: string; color: string } {
  const r = (rank ?? '').toUpperCase();
  if (r.includes('PLAT')) return { label: rank!, color: '#E8D9B4' };
  if (r.includes('GOLD')) return { label: rank!, color: '#D4B27A' };
  if (r.includes('SILVER')) return { label: rank!, color: '#A8B8C8' };
  return { label: rank ?? 'VIP', color: '#D4B27A' };
}

function mapReservation(id: string, d: DocumentData): Reservation {
  const status = (d.status as string) ?? '未来店';
  return {
    id,
    date: (d.date as string) ?? '',
    time: (d.time as string) ?? '',
    customerName: (d.customerName as string) ?? '（無名）',
    cast: (d.cast as string) ?? '',
    guests: typeof d.guests === 'number' ? d.guests : 0,
    seat: (d.seat as string) ?? '',
    status: (STATUSES as string[]).includes(status) ? (status as ReservationStatus) : '未来店',
    memo: (d.memo as string) ?? undefined,
  };
}

function mapVip(id: string, d: DocumentData): VipGuest {
  return {
    id,
    name: (d.name as string) ?? '（無名）',
    totalSales: typeof d.totalSales === 'number' ? d.totalSales : 0,
    visitCount: typeof d.visitCount === 'number' ? d.visitCount : 0,
    rank: (d.rank as string) ?? null,
    vip: d.vip === true,
    tags: Array.isArray(d.tags) ? (d.tags as string[]).slice(0, 4) : [],
  };
}

type FormState = { date: string; time: string; customerName: string; cast: string; guests: string; seat: string; memo: string };
const emptyForm = (): FormState => ({ date: todayStr(), time: '', customerName: '', cast: '', guests: '', seat: '', memo: '' });

export function ReservationClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const { t } = useShopConfig(user);
  const [activeTab, setActiveTab] = useState<'timeline' | 'vip'>('timeline');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [vips, setVips] = useState<VipGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>(todayStr());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState(false);

  const resPath = shop.shopId ? `shop_shops/${shop.shopId}/reservations` : null;
  const custPath = shop.shopId ? `shop_shops/${shop.shopId}/customers` : null;

  // 予約のリアルタイム購読
  useEffect(() => {
    if (shop.loading) return;
    if (!resPath) { setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(collection(db, resPath), (snap) => {
      const out: Reservation[] = [];
      snap.forEach((d) => out.push(mapReservation(d.id, d.data())));
      setReservations(out);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [shop.loading, resPath]);

  // 顧客（VIP/常連）のリアルタイム購読
  useEffect(() => {
    if (shop.loading || !custPath) return;
    const unsub = onSnapshot(collection(db, custPath), (snap) => {
      const out: VipGuest[] = [];
      snap.forEach((d) => out.push(mapVip(d.id, d.data())));
      setVips(out);
    }, () => { /* skip */ });
    return () => unsub();
  }, [shop.loading, custPath]);

  // 日付一覧（フィルタ用）
  const dates = useMemo(() => {
    const s = new Set<string>();
    reservations.forEach((r) => { if (r.date) s.add(r.date); });
    s.add(todayStr());
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [reservations]);

  // 表示用の予約（日付フィルタ＋時刻順）
  const dayReservations = useMemo(() => {
    return reservations
      .filter((r) => r.date === dateFilter)
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [reservations, dateFilter]);

  const todayCounts = {
    total:     dayReservations.length,
    arrived:   dayReservations.filter((r) => r.status === '来店済').length,
    upcoming:  dayReservations.filter((r) => r.status === '未来店').length,
    cancelled: dayReservations.filter((r) => r.status === 'キャンセル').length,
  };

  // VIP/常連：vip フラグ or rank があるものを優先。無ければ全件を来店回数順で表示。
  const vipList = useMemo(() => {
    const flagged = vips.filter((v) => v.vip || v.rank);
    const base = flagged.length > 0 ? flagged : vips;
    return [...base].sort((a, b) => (b.totalSales - a.totalSales) || (b.visitCount - a.visitCount));
  }, [vips]);

  const setF = (k: keyof FormState, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const openAdd = () => { setEditId(null); setForm({ ...emptyForm(), date: dateFilter }); setShowForm(true); };
  const openEdit = (r: Reservation) => {
    setEditId(r.id);
    setForm({ date: r.date || todayStr(), time: r.time, customerName: r.customerName, cast: r.cast, guests: r.guests ? String(r.guests) : '', seat: r.seat, memo: r.memo ?? '' });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditId(null); setForm(emptyForm()); };

  const save = async () => {
    if (!resPath || busy) return;
    const name = form.customerName.trim();
    if (!name) return;
    setBusy(true);
    try {
      // undefined を書かないよう、空欄は省略
      const payload: Record<string, unknown> = {
        customerName: name,
        date: form.date || todayStr(),
        status: editId ? undefined : '未来店',
      };
      if (form.time) payload.time = form.time;
      if (form.cast.trim()) payload.cast = form.cast.trim();
      if (form.guests) payload.guests = Number(form.guests);
      if (form.seat.trim()) payload.seat = form.seat.trim();
      if (form.memo.trim()) payload.memo = form.memo.trim();
      // undefined を除去
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

      if (editId) {
        await updateDoc(doc(db, `${resPath}/${editId}`), payload);
      } else {
        await addDoc(collection(db, resPath), { ...payload, createdAt: serverTimestamp(), createdBy: user.uid });
      }
      closeForm();
    } finally { setBusy(false); }
  };

  const changeStatus = async (id: string, status: ReservationStatus) => {
    if (!resPath) return;
    await updateDoc(doc(db, `${resPath}/${id}`), { status });
  };
  const remove = async (id: string) => {
    if (!resPath) return;
    await deleteDoc(doc(db, `${resPath}/${id}`));
  };

  return (
    <div
      style={{
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景グロー */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-30%',
          right: '-10%',
          width: 700,
          height: 420,
          background: 'radial-gradient(ellipse, rgba(212,178,122,0.08) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* breadcrumb */}
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol
            style={{
              display: 'flex',
              gap: 8,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-text-faint)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <li>
              <Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                Noxa OS
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li>reservation</li>
          </ol>
        </nav>

        {/* ヘッダー */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
              ノクサ · 予約
            </div>
            <h1
              className="noxa-display"
              style={{
                fontSize: 'clamp(26px, 4vw, 38px)',
                margin: 0,
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-en)',
                  fontStyle: 'italic',
                  color: 'var(--noxa-accent-primary-ink)',
                  fontWeight: 400,
                }}
              >
                №&nbsp;08
              </span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                予約
              </span>
            </h1>
          </div>
          {/* 実データバッジ */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'rgba(123,232,161,0.10)',
              border: '1px solid rgba(123,232,161,0.30)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--noxa-status-success)',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-status-success)',
                boxShadow: '0 0 8px var(--noxa-status-success)',
              }}
            />
            {shop.isDevice ? '店舗端末 · 実データ' : '実データ'}
          </div>
        </div>

        {shop.loading ? (
          <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
        ) : !shop.shopId ? (
          <div style={{ padding: 24, border: '1px solid var(--noxa-border)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
            <p style={{ margin: 0, fontSize: 15 }}>所属店舗が見つかりません。</p>
          </div>
        ) : (
          <>
            {/* KPI サマリ */}
            <div
              role="list"
              aria-label="本日の予約サマリ"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 12, marginBottom: 20 }}
            >
              <KpiCard label="この日の予約" value={String(todayCounts.total)} unit="件" />
              <KpiCard label="来店済"     value={String(todayCounts.arrived)}   unit="件" accent />
              <KpiCard label="未来店"     value={String(todayCounts.upcoming)}  unit="件" />
              <KpiCard label="キャンセル" value={String(todayCounts.cancelled)} unit="件" warn />
            </div>

            {/* タブ切り替え */}
            <div
              role="tablist"
              aria-label="表示切り替え"
              style={{
                display: 'flex',
                gap: 4,
                marginBottom: 16,
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 10,
                padding: 4,
              }}
            >
              {(['timeline', 'vip'] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: 7,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: mono,
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    transition: 'background 0.15s, color 0.15s',
                    background: activeTab === tab ? 'var(--noxa-surface-muted)' : 'transparent',
                    color: activeTab === tab ? 'var(--noxa-text-primary)' : 'var(--noxa-text-faint)',
                  }}
                >
                  {tab === 'timeline' ? '予約タイムライン' : 'VIP 客リスト'}
                </button>
              ))}
            </div>

            {/* タブパネル：タイムライン */}
            {activeTab === 'timeline' && (
              <section aria-label="予約タイムライン">
                {/* 日付フィルタ＋追加 */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>日付</span>
                  {dates.map((d) => {
                    const active = dateFilter === d;
                    const isToday = d === todayStr();
                    return (
                      <button key={d} type="button" onClick={() => setDateFilter(d)}
                        style={{ appearance: 'none', cursor: 'pointer', minHeight: 32, padding: '4px 12px', borderRadius: 9999, fontFamily: mono, fontSize: 12, fontWeight: active ? 600 : 400, background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: active ? '#fff' : 'var(--noxa-text-muted)', border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` }}>
                        {isToday ? '本日' : d.replace(/^\d{4}-/, '')}
                      </button>
                    );
                  })}
                  <button type="button" onClick={openAdd}
                    style={{ marginLeft: 'auto', appearance: 'none', cursor: 'pointer', minHeight: 36, padding: '0 16px', borderRadius: 9999, fontFamily: mono, fontSize: 12, fontWeight: 600, background: 'rgba(212,178,122,0.12)', color: '#D4B27A', border: '1px solid rgba(212,178,122,0.40)' }}>
                    ＋ 予約を追加
                  </button>
                </div>

                {/* 追加/編集フォーム */}
                {showForm && (
                  <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <FormInput label="顧客名" flex={2} value={form.customerName} onChange={(v) => setF('customerName', v)} placeholder="例：佐藤様（VIP）" />
                      <FormInput label="日付" value={form.date} onChange={(v) => setF('date', v)} type="date" />
                      <FormInput label="時刻" value={form.time} onChange={(v) => setF('time', v)} type="time" />
                      <FormInput label="人数" value={form.guests} onChange={(v) => setF('guests', v)} type="number" />
                      <FormInput label="担当" value={form.cast} onChange={(v) => setF('cast', v)} placeholder={`${t('nomination')}${t('cast')}`} />
                      <FormInput label="席" value={form.seat} onChange={(v) => setF('seat', v)} placeholder="卓番号" />
                    </div>
                    <FormInput label="メモ" value={form.memo} onChange={(v) => setF('memo', v)} placeholder="誕生日サプライズ など" />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={closeForm}
                        style={{ appearance: 'none', cursor: 'pointer', minHeight: 38, padding: '0 16px', borderRadius: 8, fontFamily: mono, fontSize: 12, background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)' }}>
                        キャンセル
                      </button>
                      <button type="button" onClick={save} disabled={busy || !form.customerName.trim()}
                        style={{ appearance: 'none', cursor: 'pointer', minHeight: 38, padding: '0 18px', borderRadius: 8, fontFamily: mono, fontSize: 12, fontWeight: 600, background: 'var(--noxa-accent-primary)', color: '#fff', border: '1px solid var(--noxa-accent-primary)', opacity: busy || !form.customerName.trim() ? 0.6 : 1 }}>
                        {editId ? '更新' : '追加'}
                      </button>
                    </div>
                  </div>
                )}

                {loading ? (
                  <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
                ) : dayReservations.length === 0 ? (
                  <div style={{ padding: 24, border: '1px solid var(--noxa-border)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--noxa-text-muted)' }}>この日の予約はありません。「予約を追加」から登録できます。</p>
                  </div>
                ) : (
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {dayReservations.map((r) => {
                      const s = STATUS_COLOR[r.status];
                      return (
                        <li
                          key={r.id}
                          style={{
                            background: 'var(--noxa-surface-card)',
                            border: '1px solid var(--noxa-border)',
                            borderRadius: 14,
                            padding: '14px 16px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 14,
                              flexWrap: 'wrap',
                            }}
                          >
                            {/* 時刻 */}
                            <time
                              dateTime={r.time}
                              style={{
                                fontFamily: mono,
                                fontSize: 20,
                                fontVariantNumeric: 'tabular-nums',
                                fontWeight: 700,
                                color: 'var(--noxa-accent-primary-ink)',
                                lineHeight: 1,
                                minWidth: 52,
                              }}
                            >
                              {r.time || '—'}
                            </time>

                            {/* 詳細 */}
                            <div style={{ flex: 1, minWidth: 160 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                  marginBottom: 6,
                                }}
                              >
                                <span style={{ fontSize: 15, fontWeight: 500 }}>{r.customerName}</span>
                                {/* ステータスバッジ */}
                                <span
                                  aria-label={`ステータス: ${r.status}`}
                                  style={{
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: 9999,
                                    fontFamily: mono,
                                    fontSize: 10,
                                    letterSpacing: '0.08em',
                                    color: s.text,
                                    background: s.bg,
                                    border: `1px solid ${s.border}`,
                                  }}
                                >
                                  {r.status}
                                </span>
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 16,
                                  flexWrap: 'wrap',
                                  fontFamily: mono,
                                  fontSize: 11,
                                  color: 'var(--noxa-text-muted)',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {r.cast && <span>{t('nomination')}: {r.cast}</span>}
                                {r.guests > 0 && <span>{r.guests}名</span>}
                                {r.seat && <span>卓: {r.seat}</span>}
                              </div>
                              {r.memo && (
                                <p
                                  style={{
                                    margin: '6px 0 0',
                                    fontSize: 11,
                                    color: 'var(--noxa-text-faint)',
                                    fontStyle: 'italic',
                                  }}
                                >
                                  ※ {r.memo}
                                </p>
                              )}
                            </div>

                            {/* アクション：ステータス遷移 + 編集/削除 */}
                            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                              {STATUSES.filter((st) => st !== r.status).map((st) => (
                                <ActionButton key={st} label={`→ ${st}`} onClick={() => changeStatus(r.id, st)} secondary={st !== '来店済'} />
                              ))}
                              <ActionButton label="編集" onClick={() => openEdit(r)} secondary />
                              <button type="button" onClick={() => remove(r.id)} title="削除" aria-label="削除"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 16, lineHeight: 1, padding: '4px 6px' }}>
                                ×
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* タブパネル：VIP 客リスト */}
            {activeTab === 'vip' && (
              <section aria-label="VIP 客リスト">
                {vipList.length === 0 ? (
                  <div style={{ padding: 24, border: '1px solid var(--noxa-border)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--noxa-text-muted)' }}>顧客がまだ登録されていません。顧客台帳に登録すると、ここに VIP・常連として表示されます。</p>
                  </div>
                ) : (
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {vipList.map((v) => {
                      const rank = rankStyle(v.rank);
                      const isPlat = (v.rank ?? '').toUpperCase().includes('PLAT');
                      return (
                        <li
                          key={v.id}
                          style={{
                            background: 'var(--noxa-surface-card)',
                            border: `1px solid ${isPlat ? 'rgba(232,217,180,0.35)' : 'var(--noxa-border)'}`,
                            borderRadius: 16,
                            padding: '16px 18px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                            {/* 名前 + バッジ */}
                            <div style={{ flex: 1, minWidth: 160 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  marginBottom: 8,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span style={{ fontSize: 15, fontWeight: 600 }}>{v.name}</span>
                                {/* VIP ランクバッジ */}
                                {(v.rank || v.vip) && (
                                  <span
                                    aria-label={`ランク: ${rank.label}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      padding: '2px 8px',
                                      borderRadius: 9999,
                                      fontFamily: mono,
                                      fontSize: 9,
                                      letterSpacing: '0.14em',
                                      color: rank.color,
                                      background: `${rank.color}18`,
                                      border: `1px solid ${rank.color}50`,
                                    }}
                                  >
                                    ★ {rank.label}
                                  </span>
                                )}
                              </div>

                              {/* 統計 */}
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 18,
                                  flexWrap: 'wrap',
                                  fontFamily: mono,
                                  fontSize: 11,
                                  color: 'var(--noxa-text-muted)',
                                  marginBottom: v.tags.length > 0 ? 10 : 0,
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                <span>
                                  累計:{' '}
                                  <strong style={{ color: '#D4B27A', fontWeight: 700 }}>
                                    {yen(v.totalSales)}
                                  </strong>
                                </span>
                                <span>来店: {v.visitCount} 回</span>
                              </div>

                              {/* 好み タグ */}
                              {v.tags.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {v.tags.map((p) => (
                                    <span
                                      key={p}
                                      style={{
                                        padding: '2px 8px',
                                        background: 'var(--noxa-surface-muted)',
                                        border: '1px solid var(--noxa-border)',
                                        borderRadius: 6,
                                        fontFamily: mono,
                                        fontSize: 10,
                                        color: 'var(--noxa-text-faint)',
                                      }}
                                    >
                                      {p}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* フッター注記 */}
            <p
              style={{
                margin: '20px 0 0',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--noxa-text-faint)',
                fontFamily: mono,
              }}
            >
              ※ 予約は実データ（noxa-platform）でリアルタイム更新。VIP 客リストは顧客台帳の参照のみ（編集はネイティブアプリ「YoruLog」で）。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ---- サブコンポーネント ----

function FormInput({
  label, value, onChange, type, placeholder, flex,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'date' | 'time';
  placeholder?: string;
  flex?: number;
}) {
  const isMono = type === 'date' || type === 'time' || type === 'number';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: `${flex ?? 1} 1 120px` }}>
      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>{label}</span>
      <input
        type={type ?? 'text'}
        inputMode={type === 'number' ? 'numeric' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          minHeight: 40,
          padding: '8px 12px',
          borderRadius: 10,
          background: 'var(--noxa-bg-base)',
          border: '1px solid var(--noxa-border)',
          color: 'var(--noxa-text-primary)',
          fontSize: 16,
          fontFamily: isMono ? mono : undefined,
        }}
      />
    </label>
  );
}

function KpiCard({
  label,
  value,
  unit,
  accent,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const valueColor = accent
    ? 'var(--noxa-status-success)'
    : warn
    ? 'var(--noxa-status-warning)'
    : 'var(--noxa-text-primary)';

  return (
    <div
      role="listitem"
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--noxa-text-faint)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--noxa-font-display-en)',
          fontSize: 26,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
          lineHeight: 1,
        }}
      >
        {value}
        <span
          style={{
            fontSize: 12,
            fontFamily: mono,
            fontWeight: 400,
            color: 'var(--noxa-text-faint)',
            marginLeft: 4,
          }}
        >
          {unit}
        </span>
      </span>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  secondary,
}: {
  label: string;
  onClick: () => void;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        border: secondary
          ? '1px solid var(--noxa-border)'
          : '1px solid rgba(212,178,122,0.40)',
        background: secondary
          ? 'transparent'
          : 'rgba(212,178,122,0.12)',
        color: secondary
          ? 'var(--noxa-text-muted)'
          : '#D4B27A',
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: '0.06em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  );
}

export default ReservationClient;
