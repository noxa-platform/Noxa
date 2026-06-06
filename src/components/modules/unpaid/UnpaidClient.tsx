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
 * 売掛管理モジュール（機微・オーナー専用・実データ）
 *
 * shop_shops/{shopId}/unpaid を読み書きする。canManage（オーナー）のみ表示・編集可能。
 * 店舗端末・一般メンバーには「オーナー専用」表示のみを出す。
 */

const mono = 'var(--noxa-font-mono)';

type UnpaidStatus = '未回収' | '一部回収' | '回収済';

type UnpaidRecord = {
  id: string;
  customerName: string;
  amount: number; // 売掛額
  paidAmount: number; // 回収済
  date: string; // YYYY-MM-DD 発生日
  due: string | null; // YYYY-MM-DD 期日
  status: UnpaidStatus;
  memo: string | null;
  elapsedDays: number; // date からの経過日数（算出）
};

const STATUS_OPTIONS: UnpaidStatus[] = ['未回収', '一部回収', '回収済'];

/** YYYY-MM-DD から今日までの経過日数を算出 */
function calcElapsedDays(date: string): number {
  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  const diff = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function mapRecord(id: string, d: DocumentData): UnpaidRecord {
  const date = typeof d.date === 'string' ? d.date : '';
  const status: UnpaidStatus = STATUS_OPTIONS.includes(d.status) ? d.status : '未回収';
  return {
    id,
    customerName: typeof d.customerName === 'string' ? d.customerName : '（無名）',
    amount: typeof d.amount === 'number' ? d.amount : 0,
    paidAmount: typeof d.paidAmount === 'number' ? d.paidAmount : 0,
    date,
    due: typeof d.due === 'string' && d.due !== '' ? d.due : null,
    status,
    memo: typeof d.memo === 'string' && d.memo !== '' ? d.memo : null,
    elapsedDays: date ? calcElapsedDays(date) : 0,
  };
}

/** 経過日数に応じたステータス色を返す */
function elapsedColor(days: number): string {
  if (days >= 60) return 'var(--noxa-status-error)';
  if (days >= 30) return 'var(--noxa-status-warning)';
  return 'var(--noxa-text-primary)';
}

/** 回収ステータスバッジのスタイル */
function statusStyle(status: UnpaidStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 9px',
    borderRadius: 9999,
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap',
  };
  switch (status) {
    case '未回収':
      return { ...base, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: 'var(--noxa-status-error)' };
    case '一部回収':
      return { ...base, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: 'var(--noxa-status-warning)' };
    case '回収済':
      return { ...base, background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', color: 'var(--noxa-status-success)' };
  }
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 残高（売掛額 − 回収済）。負にならないよう 0 でクランプ */
const balanceOf = (r: UnpaidRecord) => Math.max(0, r.amount - r.paidAmount);

/** 顧客別残高を集計（回収済は除外） */
function buildBalanceRanking(records: UnpaidRecord[]) {
  const map = new Map<string, number>();
  for (const r of records) {
    if (r.status === '回収済') continue;
    map.set(r.customerName, (map.get(r.customerName) ?? 0) + balanceOf(r));
  }
  return [...map.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

const today = () => new Date().toISOString().slice(0, 10);

const inputStyle: React.CSSProperties = {
  background: 'var(--noxa-bg-base)',
  border: '1px solid var(--noxa-border)',
  borderRadius: 8,
  color: 'var(--noxa-text-primary)',
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'var(--noxa-font-sans-jp)',
  minHeight: 38,
  width: '100%',
};

const fieldLabel: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--noxa-text-faint)',
};

export function UnpaidClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const [records, setRecords] = useState<UnpaidRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 機微モジュール：オーナー（canManage）のみアクセス可能
  const allowed = shop.canManage;
  const path = shop.shopId && allowed ? `shop_shops/${shop.shopId}/unpaid` : null;

  // 追加フォーム
  const [fName, setFName] = useState('');
  const [fAmount, setFAmount] = useState('');
  const [fDate, setFDate] = useState(today());
  const [fDue, setFDue] = useState('');
  const [fMemo, setFMemo] = useState('');

  // 一部回収入力（行ごと）
  const [collectId, setCollectId] = useState<string | null>(null);
  const [collectAmount, setCollectAmount] = useState('');

  useEffect(() => {
    if (shop.loading) return;
    if (!path) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, path),
      (snap) => {
        const out: UnpaidRecord[] = [];
        snap.forEach((d) => out.push(mapRecord(d.id, d.data())));
        out.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
        setRecords(out);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [shop.loading, path]);

  const active = useMemo(() => records.filter((r) => r.status !== '回収済'), [records]);
  const totalAmount = useMemo(() => active.reduce((s, r) => s + balanceOf(r), 0), [active]);
  const totalCount = active.length;
  const maxElapsed = active.length > 0 ? Math.max(...active.map((r) => r.elapsedDays)) : 0;

  const balanceRanking = useMemo(() => buildBalanceRanking(records), [records]);
  const maxBalance = balanceRanking.length > 0 ? balanceRanking[0][1] : 1;

  // ── CRUD ──
  const addRecord = async () => {
    if (!path || busy) return;
    const name = fName.trim();
    const amount = Number(fAmount);
    if (!name || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    try {
      // undefined は書かない（任意フィールドは値があるときのみ含める）
      const payload: Record<string, unknown> = {
        customerName: name,
        amount,
        paidAmount: 0,
        date: fDate || today(),
        status: '未回収',
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      };
      if (fDue) payload.due = fDue;
      const memo = fMemo.trim();
      if (memo) payload.memo = memo;
      await addDoc(collection(db, path), payload);
      setFName('');
      setFAmount('');
      setFDate(today());
      setFDue('');
      setFMemo('');
    } finally {
      setBusy(false);
    }
  };

  const removeRecord = async (id: string) => {
    if (!path) return;
    await deleteDoc(doc(db, `${path}/${id}`));
  };

  const changeStatus = async (r: UnpaidRecord, status: UnpaidStatus) => {
    if (!path) return;
    const patch: Record<string, unknown> = { status };
    // 回収済にしたら回収済額を売掛額に揃える
    if (status === '回収済') patch.paidAmount = r.amount;
    await updateDoc(doc(db, `${path}/${r.id}`), patch);
  };

  // 一部回収を確定（paidAmount を加算し、status を自動更新）
  const applyCollect = async (r: UnpaidRecord) => {
    if (!path || busy) return;
    const add = Number(collectAmount);
    if (!Number.isFinite(add) || add <= 0) return;
    setBusy(true);
    try {
      const nextPaid = Math.min(r.amount, r.paidAmount + add);
      const status: UnpaidStatus = nextPaid >= r.amount ? '回収済' : '一部回収';
      await updateDoc(doc(db, `${path}/${r.id}`), { paidAmount: nextPaid, status });
      setCollectId(null);
      setCollectAmount('');
    } finally {
      setBusy(false);
    }
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
      {/* 装飾グロー */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-30%',
          right: '-10%',
          width: 700,
          height: 420,
          background: 'radial-gradient(ellipse, rgba(251,191,36,0.07) 0%, transparent 65%)',
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
            <li>unpaid</li>
          </ol>
        </nav>

        {/* eyebrow + 見出し */}
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
              Noxa OS · Module · Unpaid
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
                  color: 'var(--noxa-status-warning)',
                  fontWeight: 400,
                }}
              >
                №
              </span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                売掛管理
              </span>
            </h1>
          </div>

          {/* オーナー専用バッジ */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--noxa-status-warning)',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-status-warning)',
                boxShadow: '0 0 6px var(--noxa-status-warning)',
              }}
            />
            オーナー専用
          </div>
        </div>

        {/* ── 状態分岐 ── */}
        {shop.loading || loading ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>読み込み中…</p>
        ) : !allowed ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>このモジュールはオーナー専用です。</p>
        ) : !shop.shopId ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>所属店舗が見つかりません。</p>
        ) : (
          <>
            {/* ── サマリカード ── */}
            <div
              className="grid grid-cols-1"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
            >
              <SummaryCard label="未収金合計" value={yen(totalAmount)} accent="primary" />
              <SummaryCard label="件数（未回収＋一部）" value={`${totalCount} 件`} />
              <SummaryCard label="最長滞留日数" value={`${maxElapsed} 日`} accent="warning" />
            </div>

            {/* ── 売掛追加フォーム ── */}
            <section
              aria-label="売掛追加"
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 18,
                marginBottom: 20,
              }}
            >
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, margin: '0 0 14px' }}>
                売掛を追加
              </h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 160px' }}>
                  <span style={fieldLabel}>客名</span>
                  <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="客名" style={inputStyle} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
                  <span style={fieldLabel}>売掛額</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value)}
                    placeholder="0"
                    style={{ ...inputStyle, fontFamily: mono }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 130px' }}>
                  <span style={fieldLabel}>発生日</span>
                  <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} style={{ ...inputStyle, fontFamily: mono }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 130px' }}>
                  <span style={fieldLabel}>期日（任意）</span>
                  <input type="date" value={fDue} onChange={(e) => setFDue(e.target.value)} style={{ ...inputStyle, fontFamily: mono }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 160px' }}>
                  <span style={fieldLabel}>メモ（任意）</span>
                  <input value={fMemo} onChange={(e) => setFMemo(e.target.value)} placeholder="メモ" style={inputStyle} />
                </label>
                <button
                  type="button"
                  onClick={addRecord}
                  disabled={busy || !fName.trim() || !(Number(fAmount) > 0)}
                  style={{
                    minHeight: 38,
                    padding: '0 18px',
                    borderRadius: 8,
                    border: '1px solid rgba(251,191,36,0.4)',
                    background: 'rgba(251,191,36,0.14)',
                    color: 'var(--noxa-status-warning)',
                    fontFamily: mono,
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy || !fName.trim() || !(Number(fAmount) > 0) ? 0.5 : 1,
                  }}
                >
                  追加
                </button>
              </div>
            </section>

            {/* ── 売掛一覧テーブル ── */}
            <section
              aria-label="売掛一覧"
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 18,
                marginBottom: 20,
              }}
            >
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 14, margin: '0 0 14px' }}>
                売掛一覧
              </h2>

              {records.length === 0 ? (
                <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)', margin: 0 }}>
                  まだ売掛がありません。上から追加してください。
                </p>
              ) : (
                /* 375px以下は横スクロール */
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table
                    style={{
                      width: '100%',
                      minWidth: 720,
                      borderCollapse: 'collapse',
                      fontFamily: mono,
                      fontSize: 12,
                    }}
                    aria-label="売掛記録テーブル"
                  >
                    <thead>
                      <tr>
                        {['客名', '売掛額', '回収済', '残高', '発生日', '経過日数', 'ステータス', ''].map((h) => (
                          <th
                            key={h}
                            scope="col"
                            style={{
                              textAlign: ['売掛額', '回収済', '残高', '経過日数'].includes(h) ? 'right' : 'left',
                              padding: '6px 10px',
                              borderBottom: '1px solid var(--noxa-border)',
                              fontSize: 10,
                              letterSpacing: '0.08em',
                              color: 'var(--noxa-text-faint)',
                              whiteSpace: 'nowrap',
                              fontWeight: 500,
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--noxa-divider)' }}>
                          {/* 客名 */}
                          <td
                            style={{
                              padding: '10px 10px',
                              fontSize: 13,
                              fontFamily: 'var(--noxa-font-sans-jp)',
                              whiteSpace: 'nowrap',
                              color: 'var(--noxa-text-primary)',
                            }}
                          >
                            {r.customerName}
                            {r.memo && (
                              <span style={{ display: 'block', fontSize: 10, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
                                {r.memo}
                              </span>
                            )}
                          </td>

                          {/* 売掛額 */}
                          <td
                            style={{
                              padding: '10px 10px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 13,
                              color: 'var(--noxa-text-primary)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {yen(r.amount)}
                          </td>

                          {/* 回収済 */}
                          <td
                            style={{
                              padding: '10px 10px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: 'var(--noxa-text-muted)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.paidAmount > 0 ? yen(r.paidAmount) : '—'}
                          </td>

                          {/* 残高 */}
                          <td
                            style={{
                              padding: '10px 10px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 13,
                              fontWeight: 600,
                              color: balanceOf(r) > 0 ? 'var(--noxa-text-primary)' : 'var(--noxa-status-success)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {yen(balanceOf(r))}
                          </td>

                          {/* 発生日 */}
                          <td
                            style={{
                              padding: '10px 10px',
                              fontVariantNumeric: 'tabular-nums',
                              color: 'var(--noxa-text-muted)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.date || '—'}
                            {r.due && (
                              <span style={{ display: 'block', fontSize: 10, color: 'var(--noxa-text-faint)' }}>
                                期日 {r.due}
                              </span>
                            )}
                          </td>

                          {/* 経過日数 */}
                          <td
                            style={{
                              padding: '10px 10px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: elapsedColor(r.elapsedDays),
                              fontWeight: r.elapsedDays >= 30 ? 600 : 400,
                              whiteSpace: 'nowrap',
                            }}
                            aria-label={`${r.elapsedDays}日経過${r.elapsedDays >= 60 ? '（要対応）' : r.elapsedDays >= 30 ? '（注意）' : ''}`}
                          >
                            {r.elapsedDays} 日
                          </td>

                          {/* ステータス（変更可） */}
                          <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                            <select
                              value={r.status}
                              onChange={(e) => changeStatus(r, e.target.value as UnpaidStatus)}
                              aria-label={`${r.customerName}のステータス`}
                              style={{
                                ...statusStyle(r.status),
                                cursor: 'pointer',
                                padding: '3px 8px',
                                appearance: 'none',
                                WebkitAppearance: 'none',
                              }}
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* 操作（回収記録・削除） */}
                          <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {r.status !== '回収済' &&
                                (collectId === r.id ? (
                                  <>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      autoFocus
                                      value={collectAmount}
                                      onChange={(e) => setCollectAmount(e.target.value)}
                                      placeholder="回収額"
                                      style={{ ...inputStyle, width: 90, minHeight: 30, padding: '4px 8px', fontFamily: mono, fontSize: 11 }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => applyCollect(r)}
                                      disabled={busy || !(Number(collectAmount) > 0)}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: 8,
                                        border: '1px solid rgba(123,232,161,0.4)',
                                        background: 'rgba(123,232,161,0.12)',
                                        color: 'var(--noxa-status-success)',
                                        fontFamily: mono,
                                        fontSize: 10,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      確定
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCollectId(null);
                                        setCollectAmount('');
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'var(--noxa-text-faint)',
                                        fontSize: 14,
                                      }}
                                    >
                                      ×
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCollectId(r.id);
                                      setCollectAmount('');
                                    }}
                                    aria-label={`${r.customerName}の回収記録`}
                                    style={{
                                      padding: '4px 12px',
                                      borderRadius: 8,
                                      border: '1px solid var(--noxa-border)',
                                      background: 'transparent',
                                      color: 'var(--noxa-text-muted)',
                                      fontFamily: mono,
                                      fontSize: 10,
                                      letterSpacing: '0.06em',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    回収記録
                                  </button>
                                ))}
                              <button
                                type="button"
                                onClick={() => removeRecord(r.id)}
                                title="削除"
                                aria-label={`${r.customerName}を削除`}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--noxa-text-faint)',
                                  fontSize: 14,
                                }}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── 顧客別残高 上位 ── */}
            <section
              aria-label="顧客別未収残高"
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 18,
                marginBottom: 20,
              }}
            >
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, margin: '0 0 14px' }}>
                顧客別残高（上位）
              </h2>
              {balanceRanking.length === 0 ? (
                <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)', margin: 0 }}>
                  未収残高はありません。
                </p>
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
                  {balanceRanking.map(([name, balance], i) => (
                    <li key={name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 13, fontFamily: 'var(--noxa-font-sans-jp)' }}>
                          <span style={{ fontFamily: mono, color: 'var(--noxa-text-faint)', marginRight: 8, fontSize: 11 }}>
                            {i + 1}
                          </span>
                          {name}
                        </span>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 13,
                            fontVariantNumeric: 'tabular-nums',
                            color:
                              balance >= 80000
                                ? 'var(--noxa-status-error)'
                                : balance >= 40000
                                ? 'var(--noxa-status-warning)'
                                : 'var(--noxa-text-primary)',
                          }}
                        >
                          {yen(balance)}
                        </span>
                      </div>
                      {/* バー */}
                      <div style={{ height: 4, background: 'var(--noxa-surface-muted)', borderRadius: 2, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${(balance / maxBalance) * 100}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, var(--noxa-status-warning), var(--noxa-status-error))',
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 凡例 */}
            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                marginBottom: 12,
                fontSize: 11,
                fontFamily: mono,
                color: 'var(--noxa-text-faint)',
              }}
              aria-label="経過日数の凡例"
            >
              <span>
                <span style={{ color: 'var(--noxa-text-primary)' }}>●</span> 30 日未満
              </span>
              <span>
                <span style={{ color: 'var(--noxa-status-warning)' }}>●</span> 30〜59 日
              </span>
              <span>
                <span style={{ color: 'var(--noxa-status-error)' }}>●</span> 60 日以上
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** サマリKPIカード */
function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'primary' | 'warning';
}) {
  const valueColor =
    accent === 'primary'
      ? 'var(--noxa-accent-primary-ink)'
      : accent === 'warning'
      ? 'var(--noxa-status-warning)'
      : 'var(--noxa-text-primary)';

  return (
    <div
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
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default UnpaidClient;
