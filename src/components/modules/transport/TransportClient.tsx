'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';

/**
 * ⑦ 送迎 — 配車ボード + 送迎リクエスト一覧 + 地図プレースホルダ（実データ）
 *
 * shop_shops/{shopId}/transport          … 送迎リクエスト
 * shop_shops/{shopId}/transport_vehicles … 車両
 * 地図は静的プレースホルダのまま（実地図 API 連携なし）。
 */

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

type VehicleStatus = 'standby' | 'on_trip' | 'returning';

type Vehicle = {
  id: string;
  name: string;
  driver?: string;
  status: VehicleStatus;
  note?: string;
};

type RequestType = 'companion_pickup' | 'after_work';
type RequestStatus = 'waiting' | 'assigned' | 'in_progress' | 'done';

type TransportRequest = {
  id: string;
  time: string;
  type: RequestType;
  target: string;
  area: string;
  status: RequestStatus;
  vehicleId?: string;
  driver?: string;
  memo?: string;
  createdMs: number;
};

// ─────────────────────────────────────────────
// ヘルパー・定数
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

const VEHICLE_STATUS_META: Record<VehicleStatus, { label: string; color: string }> = {
  standby:    { label: '待機中',   color: 'var(--noxa-status-success)' },
  on_trip:    { label: '送迎中',   color: 'var(--noxa-status-info)' },
  returning:  { label: '戻り中',   color: 'var(--noxa-status-warning)' },
};
const VEHICLE_STATUS_ORDER: VehicleStatus[] = ['standby', 'on_trip', 'returning'];

const REQUEST_TYPE_META: Record<RequestType, { label: string; color: string }> = {
  companion_pickup: { label: '同伴PU', color: 'var(--noxa-accent-primary-ink)' },
  after_work:       { label: '退勤',   color: 'var(--noxa-status-info)' },
};

const REQUEST_STATUS_META: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  waiting:     { label: '待機',     color: 'var(--noxa-text-muted)',          bg: 'rgba(255,255,255,0.05)' },
  assigned:    { label: '配車済',   color: 'var(--noxa-accent-primary-ink)', bg: 'rgba(139, 92, 246, 0.15)' },
  in_progress: { label: '送迎中',   color: 'var(--noxa-status-info)',        bg: 'rgba(103, 232, 249, 0.12)' },
  done:        { label: '完了',     color: 'var(--noxa-status-success)',     bg: 'rgba(123, 232, 161, 0.10)' },
};

// status 遷移の次状態
const NEXT_STATUS: Record<RequestStatus, RequestStatus | null> = {
  waiting: 'assigned',
  assigned: 'in_progress',
  in_progress: 'done',
  done: null,
};
const NEXT_STATUS_LABEL: Record<RequestStatus, string> = {
  waiting: '配車する',
  assigned: '送迎開始',
  in_progress: '完了にする',
  done: '完了',
};

// ダミーピン位置（地図プレースホルダ内の絶対座標 %）
const MOCK_PINS = [
  { id: 'p1', top: '38%', left: '42%', color: 'var(--noxa-accent-primary-ink)' },
  { id: 'p2', top: '55%', left: '61%', color: 'var(--noxa-status-info)' },
  { id: 'p3', top: '28%', left: '58%', color: 'var(--noxa-status-warning)' },
];

function toMs(v: unknown): number {
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  if (typeof v === 'number') return v;
  return 0;
}
function isReqType(v: unknown): v is RequestType { return v === 'companion_pickup' || v === 'after_work'; }
function isReqStatus(v: unknown): v is RequestStatus { return v === 'waiting' || v === 'assigned' || v === 'in_progress' || v === 'done'; }
function isVehStatus(v: unknown): v is VehicleStatus { return v === 'standby' || v === 'on_trip' || v === 'returning'; }

// undefined を書かないためのペイロード組立て
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────
// サブコンポーネント
// ─────────────────────────────────────────────

function PaneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12, display: 'block' }}>
      {children}
    </h2>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--noxa-text-muted)', fontFamily: mono, letterSpacing: '0.06em' };
const field: React.CSSProperties = { minHeight: 38, padding: '6px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 13, width: '100%' };
function chip(active: boolean): React.CSSProperties {
  return {
    appearance: 'none', cursor: 'pointer', minHeight: 34, padding: '0 12px', borderRadius: 9999,
    border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
    background: active ? 'var(--noxa-accent-primary)' : 'transparent',
    color: active ? '#fff' : 'var(--noxa-text-muted)',
    fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
  };
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

export function TransportClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [requests, setRequests] = useState<TransportRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reqPath = shop.shopId ? `shop_shops/${shop.shopId}/transport` : null;
  const vehPath = shop.shopId ? `shop_shops/${shop.shopId}/transport_vehicles` : null;

  // リクエスト購読
  useEffect(() => {
    if (!reqPath) { setRequests([]); return; }
    const unsub = onSnapshot(collection(db, reqPath), (snap) => {
      const list: TransportRequest[] = [];
      snap.forEach((d) => {
        const v = d.data() as DocumentData;
        list.push({
          id: d.id,
          time: (v.time as string) ?? '',
          type: isReqType(v.type) ? v.type : 'companion_pickup',
          target: (v.target as string) ?? '',
          area: (v.area as string) ?? '',
          status: isReqStatus(v.status) ? v.status : 'waiting',
          vehicleId: (v.vehicleId as string) ?? undefined,
          driver: (v.driver as string) ?? undefined,
          memo: (v.memo as string) ?? undefined,
          createdMs: toMs(v.createdAt),
        });
      });
      list.sort((a, b) => a.time.localeCompare(b.time) || a.createdMs - b.createdMs);
      setRequests(list);
    }, (e) => console.warn('[noxa:transport] リクエスト購読エラー', e?.message ?? e));
    return () => unsub();
  }, [reqPath]);

  // 車両購読
  useEffect(() => {
    if (!vehPath) { setVehicles([]); return; }
    const unsub = onSnapshot(collection(db, vehPath), (snap) => {
      const list: Vehicle[] = [];
      snap.forEach((d) => {
        const v = d.data() as DocumentData;
        list.push({
          id: d.id,
          name: (v.name as string) ?? '',
          driver: (v.driver as string) ?? undefined,
          status: isVehStatus(v.status) ? v.status : 'standby',
          note: (v.note as string) ?? undefined,
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setVehicles(list);
    }, (e) => console.warn('[noxa:transport] 車両購読エラー', e?.message ?? e));
    return () => unsub();
  }, [vehPath]);

  const vehicleName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const v of vehicles) m[v.id] = v.name;
    return m;
  }, [vehicles]);

  // ── リクエスト操作 ──
  const addRequest = async (input: { time: string; type: RequestType; target: string; area: string; memo: string }) => {
    if (!reqPath || busy) return;
    setBusy(true);
    try {
      await addDoc(collection(db, reqPath), compact({
        time: input.time,
        type: input.type,
        target: input.target.trim(),
        area: input.area.trim(),
        memo: input.memo.trim(),
        status: 'waiting',
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      }));
    } finally { setBusy(false); }
  };
  const advanceStatus = async (req: TransportRequest) => {
    if (!reqPath || busy) return;
    const next = NEXT_STATUS[req.status];
    if (!next) return;
    setBusy(true);
    try { await updateDoc(doc(db, `${reqPath}/${req.id}`), { status: next }); }
    finally { setBusy(false); }
  };
  const setRequestStatus = async (req: TransportRequest, status: RequestStatus) => {
    if (!reqPath || busy) return;
    setBusy(true);
    try { await updateDoc(doc(db, `${reqPath}/${req.id}`), { status }); }
    finally { setBusy(false); }
  };
  const assignVehicle = async (req: TransportRequest, vehicleId: string) => {
    if (!reqPath || busy) return;
    setBusy(true);
    try {
      const veh = vehicles.find((v) => v.id === vehicleId);
      const patch: Record<string, unknown> = vehicleId
        ? compact({ vehicleId, driver: veh?.driver, status: req.status === 'waiting' ? 'assigned' : req.status })
        : { vehicleId: '', driver: '' };
      await updateDoc(doc(db, `${reqPath}/${req.id}`), patch);
    } finally { setBusy(false); }
  };
  const removeRequest = async (id: string) => {
    if (!reqPath) return;
    await deleteDoc(doc(db, `${reqPath}/${id}`));
    if (selectedRequestId === id) setSelectedRequestId(null);
  };

  // ── 車両操作 ──
  const addVehicle = async (input: { name: string; driver: string }) => {
    if (!vehPath || busy) return;
    setBusy(true);
    try {
      await addDoc(collection(db, vehPath), compact({
        name: input.name.trim(),
        driver: input.driver.trim(),
        status: 'standby',
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      }));
    } finally { setBusy(false); }
  };
  const cycleVehicleStatus = async (veh: Vehicle) => {
    if (!vehPath || busy) return;
    const idx = VEHICLE_STATUS_ORDER.indexOf(veh.status);
    const next = VEHICLE_STATUS_ORDER[(idx + 1) % VEHICLE_STATUS_ORDER.length];
    setBusy(true);
    try { await updateDoc(doc(db, `${vehPath}/${veh.id}`), { status: next }); }
    finally { setBusy(false); }
  };
  const removeVehicle = async (id: string) => {
    if (!vehPath) return;
    await deleteDoc(doc(db, `${vehPath}/${id}`));
  };

  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? null;

  return (
    <div
      style={{
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
      }}
    >
      {/* ambient glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-8%',
          width: 680,
          height: 400,
          background: 'radial-gradient(ellipse, rgba(103, 232, 249, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-25%',
          left: '-5%',
          width: 500,
          height: 360,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.08) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>

        {/* ─ ヘッダー ─ */}
        <header style={{ marginBottom: 20 }}>
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
                <Link href="/" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                  Noxa OS
                </Link>
              </li>
              <li aria-hidden>·</li>
              <li>transport</li>
            </ol>
          </nav>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
                Noxa OS · Module 07 · Transport
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
                  № 07
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  送迎
                </span>
              </h1>
            </div>

            {/* 実データバッジ */}
            <div
              role="note"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(103, 232, 249, 0.08)',
                border: '1px solid var(--noxa-divider)',
                borderRadius: 9999,
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--noxa-text-muted)',
                textTransform: 'uppercase',
              }}
            >
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-info)' }}
              />
              {shop.isDevice ? '店舗端末 · 実データ' : '実データ'}
            </div>
          </div>
        </header>

        {shop.loading ? (
          <p className="noxa-eyebrow" style={{ fontSize: 11 }}>読み込み中…</p>
        ) : !shop.shopId ? (
          <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: '28px 20px', textAlign: 'center', color: 'var(--noxa-text-muted)', fontSize: 14 }}>
            所属店舗が見つかりません。
          </div>
        ) : (
        <>
        {/* ─ 配車ボード ─ */}
        <section aria-label="配車ボード" style={{ marginBottom: 'clamp(16px, 2vw, 24px)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <PaneTitle>配車ボード</PaneTitle>
          </div>

          {/* 車両追加フォーム */}
          <VehicleForm onAdd={addVehicle} busy={busy} />

          {vehicles.length === 0 ? (
            <div style={{ background: 'var(--noxa-surface-card)', border: '1px dashed var(--noxa-border)', borderRadius: 14, padding: '18px 16px', color: 'var(--noxa-text-muted)', fontSize: 13 }}>
              車両がまだありません。上から追加してください。
            </div>
          ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-3"
            style={{ gap: 'clamp(10px, 1.4vw, 14px)' }}
          >
            {vehicles.map((v) => {
              const meta = VEHICLE_STATUS_META[v.status];
              return (
                <div
                  key={v.id}
                  role="article"
                  aria-label={`${v.name} — ${meta.label}`}
                  style={{
                    background: 'var(--noxa-surface-card)',
                    border: `1px solid ${
                      v.status === 'on_trip'
                        ? 'rgba(103, 232, 249, 0.30)'
                        : v.status === 'returning'
                          ? 'rgba(245, 212, 114, 0.30)'
                          : 'var(--noxa-border)'
                    }`,
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: v.status === 'on_trip' ? '0 0 16px rgba(103, 232, 249, 0.08)' : 'none',
                  }}
                >
                  {/* 車両名 + ステータス（クリックで切替） */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span
                      style={{
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--noxa-text-primary)',
                      }}
                    >
                      {v.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => cycleVehicleStatus(v)}
                      disabled={busy}
                      title="クリックでステータス切替"
                      style={{
                        appearance: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 9px',
                        borderRadius: 9999,
                        background: 'rgba(255,255,255,0.05)',
                        border: `1px solid ${meta.color}33`,
                        fontFamily: mono,
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        color: meta.color,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          background: meta.color,
                          boxShadow: `0 0 6px ${meta.color}`,
                          flex: 'none',
                        }}
                      />
                      {meta.label}
                    </button>
                  </div>

                  {/* ドライバー名 */}
                  {v.driver && (
                    <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)', fontFamily: mono }}>
                      {v.driver}
                    </span>
                  )}

                  {/* メモ / 削除 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      borderTop: '1px solid var(--noxa-divider)',
                      paddingTop: 8,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)', lineHeight: 1.5, flex: 1, minWidth: 0 }}>
                      {v.note ?? ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeVehicle(v.id)}
                      title="車両を削除"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 14, flex: 'none' }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </section>

        {/* ─ メイン 2ペイン（リクエスト一覧 + 地図） ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_340px]"
          style={{ gap: 'clamp(12px, 1.6vw, 18px)', alignItems: 'start' }}
        >
          {/* 送迎リクエスト一覧 */}
          <section aria-label="送迎リクエスト一覧">
            <PaneTitle>送迎リクエスト</PaneTitle>

            {/* リクエスト追加フォーム */}
            <RequestForm onAdd={addRequest} busy={busy} />

            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              {/* テーブルヘッダー */}
              <div
                role="rowheader"
                aria-hidden
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 80px 1fr 120px 80px auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--noxa-divider)',
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.10em',
                  color: 'var(--noxa-text-faint)',
                  textTransform: 'uppercase',
                }}
              >
                <span>時刻</span>
                <span>種別</span>
                <span>行き先</span>
                <span>担当</span>
                <span>状態</span>
                <span></span>
              </div>

              {/* リクエスト行 */}
              {requests.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--noxa-text-muted)', fontSize: 13 }}>
                  送迎リクエストはまだありません。上から追加してください。
                </div>
              ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} role="list" aria-label="送迎リクエスト">
                {requests.map((req, idx) => {
                  const typeMeta = REQUEST_TYPE_META[req.type];
                  const statusMeta = REQUEST_STATUS_META[req.status];
                  const isSelected = req.id === selectedRequestId;
                  const next = NEXT_STATUS[req.status];

                  return (
                    <li
                      key={req.id}
                      role="row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '60px 80px 1fr 120px 80px auto',
                        alignItems: 'center',
                        gap: 12,
                        padding: '14px 16px',
                        borderBottom: idx < requests.length - 1 ? '1px solid var(--noxa-divider)' : 'none',
                        background: isSelected ? 'rgba(139, 92, 246, 0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      }}
                      onClick={() => setSelectedRequestId(isSelected ? null : req.id)}
                      aria-selected={isSelected}
                    >
                      {/* 時刻 */}
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 14,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--noxa-text-primary)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {req.time || '—'}
                      </span>

                      {/* 種別バッジ */}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 8px',
                          borderRadius: 9999,
                          background: `${typeMeta.color}1A`,
                          border: `1px solid ${typeMeta.color}33`,
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          color: typeMeta.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {typeMeta.label}
                      </span>

                      {/* 行き先 */}
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--noxa-text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {req.area || '—'}
                      </span>

                      {/* 客名 / キャスト名 */}
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--noxa-text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {req.target || '—'}
                      </span>

                      {/* ステータスバッジ */}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 8px',
                          borderRadius: 9999,
                          background: statusMeta.bg,
                          border: `1px solid ${statusMeta.color}33`,
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          color: statusMeta.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {statusMeta.label}
                      </span>

                      {/* status 遷移ボタン */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          advanceStatus(req);
                        }}
                        aria-label={`${req.target} のリクエストを${NEXT_STATUS_LABEL[req.status]}`}
                        disabled={busy || next === null}
                        style={{
                          appearance: 'none',
                          cursor: next === null ? 'not-allowed' : 'pointer',
                          minHeight: 32,
                          minWidth: 70,
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: '1px solid var(--noxa-accent-primary)',
                          background: next === null ? 'transparent' : 'var(--noxa-accent-primary)',
                          color: next === null ? 'var(--noxa-text-faint)' : '#fff',
                          fontFamily: 'var(--noxa-font-sans-jp)',
                          fontSize: 12,
                          fontWeight: 600,
                          opacity: next === null ? 0.35 : 1,
                          transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                          whiteSpace: 'nowrap',
                          boxShadow: next === null ? 'none' : 'var(--noxa-glow-soft)',
                        }}
                      >
                        {NEXT_STATUS_LABEL[req.status]}
                      </button>
                    </li>
                  );
                })}
              </ul>
              )}
            </div>
          </section>

          {/* 地図プレースホルダ */}
          <section aria-label="地図パネル">
            <PaneTitle>地図プレビュー</PaneTitle>

            <div
              aria-label="地図プレビュー（プレースホルダ）"
              role="img"
              style={{
                position: 'relative',
                width: '100%',
                height: 'clamp(260px, 40vw, 420px)',
                borderRadius: 16,
                border: '1px solid var(--noxa-border)',
                overflow: 'hidden',
                background: 'radial-gradient(ellipse at 40% 45%, #12103A 0%, #0A081E 40%, #07050D 100%)',
              }}
            >
              {/* グリッドライン装飾 */}
              <svg
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0.12,
                }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* 縦線 */}
                {[0.2, 0.4, 0.6, 0.8].map((x) => (
                  <line
                    key={`v${x}`}
                    x1={`${x * 100}%`}
                    y1="0"
                    x2={`${x * 100}%`}
                    y2="100%"
                    stroke="var(--noxa-border-strong)"
                    strokeWidth="1"
                  />
                ))}
                {/* 横線 */}
                {[0.25, 0.5, 0.75].map((y) => (
                  <line
                    key={`h${y}`}
                    x1="0"
                    y1={`${y * 100}%`}
                    x2="100%"
                    y2={`${y * 100}%`}
                    stroke="var(--noxa-border-strong)"
                    strokeWidth="1"
                  />
                ))}
              </svg>

              {/* 道路風ライン装飾 */}
              <svg
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0.18,
                }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <polyline
                  points="0,55 25,48 50,52 75,44 100,50"
                  fill="none"
                  stroke="var(--noxa-border-strong)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points="20,0 30,35 55,55 65,100"
                  fill="none"
                  stroke="var(--noxa-border-strong)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {/* MAP PREVIEW テキスト */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 'clamp(11px, 1.4vw, 14px)',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-faint)',
                    fontWeight: 400,
                  }}
                >
                  MAP PREVIEW
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: 'var(--noxa-text-faint)',
                    opacity: 0.6,
                  }}
                >
                  実地図 API 未接続
                </span>
              </div>

              {/* ダミーピン */}
              {MOCK_PINS.map((pin) => (
                <div
                  key={pin.id}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: pin.top,
                    left: pin.left,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {/* 外側グロー */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      background: pin.color,
                      opacity: 0.18,
                    }}
                  />
                  {/* ピン本体 */}
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: pin.color,
                      border: '2px solid rgba(255,255,255,0.6)',
                      boxShadow: `0 0 8px ${pin.color}`,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  />
                </div>
              ))}

              {/* 凡例 */}
              <div
                aria-label="地図凡例"
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  padding: '8px 10px',
                  background: 'rgba(7, 5, 13, 0.72)',
                  border: '1px solid var(--noxa-border)',
                  borderRadius: 10,
                  backdropFilter: 'blur(6px)',
                }}
              >
                {Object.entries(VEHICLE_STATUS_META).map(([key, meta]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        background: meta.color,
                        flex: 'none',
                      }}
                    />
                    <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--noxa-text-faint)', letterSpacing: '0.08em' }}>
                      {meta.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 選択リクエストの詳細カード */}
            {selectedRequest && (() => {
              const req = selectedRequest;
              const typeMeta = REQUEST_TYPE_META[req.type];
              const statusMeta = REQUEST_STATUS_META[req.status];
              return (
                <div
                  aria-label={`${req.target} のリクエスト詳細`}
                  style={{
                    marginTop: 12,
                    background: 'var(--noxa-surface-card)',
                    border: '1px solid var(--noxa-border-strong)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 15, fontWeight: 600, color: 'var(--noxa-text-primary)' }}>
                      {req.target || '（無題）'}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '3px 9px',
                        borderRadius: 9999,
                        background: statusMeta.bg,
                        border: `1px solid ${statusMeta.color}33`,
                        fontFamily: mono,
                        fontSize: 10,
                        color: statusMeta.color,
                      }}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <DetailRow label="時刻" value={req.time || '—'} mono />
                    <DetailRow label="種別" value={typeMeta.label} color={typeMeta.color} />
                    <DetailRow label="方面" value={req.area || '—'} />
                    {req.driver && <DetailRow label="ドライバー" value={req.driver} />}
                    {req.vehicleId && <DetailRow label="車両" value={vehicleName[req.vehicleId] ?? req.vehicleId} />}
                    {req.memo && <DetailRow label="メモ" value={req.memo} />}
                  </div>

                  {/* 車両割当て */}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={lbl}>車両割当て</span>
                    <select
                      value={req.vehicleId ?? ''}
                      onChange={(e) => assignVehicle(req, e.target.value)}
                      disabled={busy}
                      style={{ ...field }}
                    >
                      <option value="">未割当</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </label>

                  {/* ステータス手動切替 */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(Object.keys(REQUEST_STATUS_META) as RequestStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setRequestStatus(req, st)}
                        disabled={busy}
                        style={chip(req.status === st)}
                      >
                        {REQUEST_STATUS_META[st].label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeRequest(req.id)}
                    aria-label="リクエストを削除"
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      width: '100%',
                      minHeight: 40,
                      borderRadius: 10,
                      border: '1px solid var(--noxa-border-strong)',
                      background: 'var(--noxa-surface-muted)',
                      color: 'var(--noxa-status-error)',
                      fontFamily: 'var(--noxa-font-sans-jp)',
                      fontSize: 12,
                      fontWeight: 500,
                      transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                    }}
                  >
                    このリクエストを削除
                  </button>
                </div>
              );
            })()}
          </section>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 車両追加フォーム
// ─────────────────────────────────────────────
function VehicleForm({ onAdd, busy }: { onAdd: (v: { name: string; driver: string }) => void; busy: boolean }) {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('');
  const submit = () => {
    if (!name.trim() || busy) return;
    onAdd({ name, driver });
    setName(''); setDriver('');
  };
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 140px' }}>
        <span style={lbl}>車両名</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="アルファード #1" style={field} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
        <span style={lbl}>ドライバー</span>
        <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="田中ドライバー" style={field} />
      </label>
      <button type="button" onClick={submit} disabled={busy || !name.trim()} style={{ ...chip(true), minHeight: 40, padding: '0 18px', opacity: busy || !name.trim() ? 0.6 : 1 }}>車両追加</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// リクエスト追加フォーム
// ─────────────────────────────────────────────
function RequestForm({ onAdd, busy }: { onAdd: (v: { time: string; type: RequestType; target: string; area: string; memo: string }) => void; busy: boolean }) {
  const [time, setTime] = useState('');
  const [type, setType] = useState<RequestType>('companion_pickup');
  const [target, setTarget] = useState('');
  const [area, setArea] = useState('');
  const [memo, setMemo] = useState('');
  const submit = () => {
    if (!target.trim() || busy) return;
    onAdd({ time, type, target, area, memo });
    setTime(''); setTarget(''); setArea(''); setMemo(''); setType('companion_pickup');
  };
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 90px' }}>
        <span style={lbl}>時刻</span>
        <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="23:30" style={{ ...field, fontFamily: mono }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 auto' }}>
        <span style={lbl}>種別</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(Object.keys(REQUEST_TYPE_META) as RequestType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} style={chip(type === t)}>{REQUEST_TYPE_META[t].label}</button>
          ))}
        </div>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 140px' }}>
        <span style={lbl}>対象（顧客/キャスト）</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="玲奈 / 顧客名" style={field} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
        <span style={lbl}>方面</span>
        <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="難波/梅田…" style={field} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
        <span style={lbl}>メモ</span>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意" style={field} />
      </label>
      <button type="button" onClick={submit} disabled={busy || !target.trim()} style={{ ...chip(true), minHeight: 40, padding: '0 18px', opacity: busy || !target.trim() ? 0.6 : 1 }}>リクエスト追加</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// 詳細カード内の行
// ─────────────────────────────────────────────
function DetailRow({
  label,
  value,
  mono: isMono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  const monoFont = 'var(--noxa-font-mono)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)', fontFamily: monoFont, letterSpacing: '0.08em', flex: 'none' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: color ?? 'var(--noxa-text-primary)',
          fontFamily: isMono ? monoFont : 'var(--noxa-font-sans-jp)',
          fontVariantNumeric: isMono ? 'tabular-nums' : undefined,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default TransportClient;
