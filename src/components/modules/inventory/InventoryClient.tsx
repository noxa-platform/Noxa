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
 * ⑧ 在庫管理 — Noxa OS（実データ）
 *
 * shop_shops/{shopId}/inventory（在庫品目）と shop_shops/{shopId}/bottle_keeps（ボトルキープ）を
 * onSnapshot でリアルタイム購読し、CRUD と在庫増減を行う。
 * 見た目は元の UI モックを踏襲（発注アラート / 在庫一覧 / ボトルキープの 3 セクション）。
 */

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

type ItemCategory = 'bottle' | 'food' | 'supply';
type StockStatus = 'ok' | 'low' | 'out';

type StockItem = {
  id: string;
  name: string;
  category: ItemCategory;
  qty: number;     // 在庫数
  par: number;     // 適正在庫（閾値）
  unit: string;
};

type BottleKeep = {
  id: string;
  customerName: string;
  item: string;
  openedAt: string;            // YYYY-MM-DD
  expiresAt: string;           // YYYY-MM-DD（空可）
  remaining: string;           // 表示用（"65%" など、空可）
  nearExpiry: boolean;         // 期限まで 7 日以内
  remainingPct: number | null; // 数値化できれば 0-100、できなければ null
};

const CATEGORY_TABS: { id: ItemCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'bottle', label: 'ボトル' },
  { id: 'food', label: '食材' },
  { id: 'supply', label: '消耗品' },
];

const CATEGORY_LABEL: Record<ItemCategory, string> = {
  bottle: 'ボトル',
  food: '食材',
  supply: '消耗品',
};

const CATEGORY_OPTIONS: ItemCategory[] = ['bottle', 'food', 'supply'];

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

function getStockStatus(item: StockItem): StockStatus {
  if (item.qty <= 0) return 'out';
  if (item.qty < item.par) return 'low';
  return 'ok';
}

const STATUS_META: Record<StockStatus, { label: string; color: string; bgAlpha: string }> = {
  ok:  { label: '十分',   color: 'var(--noxa-status-success)', bgAlpha: 'rgba(123, 232, 161, 0.10)' },
  low: { label: '少ない', color: 'var(--noxa-status-warning)', bgAlpha: 'rgba(245, 212, 114, 0.10)' },
  out: { label: '切れ',   color: 'var(--noxa-status-error)',   bgAlpha: 'rgba(196,  56,  74, 0.10)' },
};

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
};

function toDateStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) {
    return new Date((v as { seconds: number }).seconds * 1000).toISOString().slice(0, 10);
  }
  return '';
}

function mapItem(id: string, d: DocumentData): StockItem {
  const category = (['bottle', 'food', 'supply'] as const).includes(d.category) ? (d.category as ItemCategory) : 'supply';
  return {
    id,
    name: (d.name as string) ?? '',
    category,
    qty: num(d.qty),
    par: num(d.par),
    unit: (d.unit as string) ?? '',
  };
}

function mapKeep(id: string, d: DocumentData): BottleKeep {
  const expiresAt = toDateStr(d.expiresAt);
  const remainingRaw = d.remaining;
  const remaining = remainingRaw === undefined || remainingRaw === null ? '' : String(remainingRaw);
  const pctMatch = remaining.match(/\d+(\.\d+)?/);
  const remainingPct = pctMatch ? Math.max(0, Math.min(100, Number(pctMatch[0]))) : null;
  let nearExpiry = false;
  if (expiresAt) {
    const diff = (new Date(expiresAt + 'T00:00:00').getTime() - Date.now()) / 86400000;
    nearExpiry = diff <= 7;
  }
  return {
    id,
    customerName: (d.customerName as string) ?? '',
    item: (d.item as string) ?? '',
    openedAt: toDateStr(d.openedAt),
    expiresAt,
    remaining,
    nearExpiry,
    remainingPct,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function InventoryClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const [activeCategory, setActiveCategory] = useState<ItemCategory | 'all'>('all');
  const [items, setItems] = useState<StockItem[]>([]);
  const [keeps, setKeeps] = useState<BottleKeep[]>([]);
  const [busy, setBusy] = useState(false);

  // 在庫品目フォーム（追加 / 編集）
  const [editor, setEditor] = useState<{ id: string | null; name: string; category: ItemCategory; qty: string; par: string; unit: string } | null>(null);
  // ボトルキープ追加フォーム
  const [keepForm, setKeepForm] = useState<{ customerName: string; item: string; openedAt: string; expiresAt: string; remaining: string } | null>(null);

  const invPath = shop.shopId ? `shop_shops/${shop.shopId}/inventory` : null;
  const keepPath = shop.shopId ? `shop_shops/${shop.shopId}/bottle_keeps` : null;

  // 在庫品目リアルタイム購読
  useEffect(() => {
    if (!invPath) return;
    const unsub = onSnapshot(collection(db, invPath), (snap) => {
      const list: StockItem[] = [];
      snap.forEach((d) => list.push(mapItem(d.id, d.data())));
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setItems(list);
    }, (e) => console.warn('[noxa:inventory] 在庫購読エラー', e?.message ?? e));
    return () => unsub();
  }, [invPath]);

  // ボトルキープリアルタイム購読
  useEffect(() => {
    if (!keepPath) return;
    const unsub = onSnapshot(collection(db, keepPath), (snap) => {
      const list: BottleKeep[] = [];
      snap.forEach((d) => list.push(mapKeep(d.id, d.data())));
      list.sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
      setKeeps(list);
    }, (e) => console.warn('[noxa:inventory] ボトルキープ購読エラー', e?.message ?? e));
    return () => unsub();
  }, [keepPath]);

  // 発注アラート対象（適正在庫割れ）
  const alertItems = useMemo(() => items.filter((i) => getStockStatus(i) !== 'ok'), [items]);

  // カテゴリフィルタ適用済みリスト
  const filteredStock = useMemo(
    () => (activeCategory === 'all' ? items : items.filter((i) => i.category === activeCategory)),
    [items, activeCategory],
  );

  // ─ 操作 ─

  const adjustQty = async (item: StockItem, delta: number) => {
    if (!invPath || busy) return;
    const next = Math.max(0, item.qty + delta);
    setBusy(true);
    try { await updateDoc(doc(db, `${invPath}/${item.id}`), { qty: next }); }
    finally { setBusy(false); }
  };

  const removeItem = async (id: string) => {
    if (!invPath || busy) return;
    setBusy(true);
    try { await deleteDoc(doc(db, `${invPath}/${id}`)); }
    finally { setBusy(false); }
  };

  const saveItem = async () => {
    if (!invPath || !editor || busy) return;
    const name = editor.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        category: editor.category,
        qty: num(editor.qty),
        par: num(editor.par),
      };
      const unit = editor.unit.trim();
      if (unit) payload.unit = unit; // undefined は書き込まない
      if (editor.id) {
        await updateDoc(doc(db, `${invPath}/${editor.id}`), payload);
      } else {
        await addDoc(collection(db, invPath), { ...payload, createdAt: serverTimestamp() });
      }
      setEditor(null);
    } finally { setBusy(false); }
  };

  const saveKeep = async () => {
    if (!keepPath || !keepForm || busy) return;
    const customerName = keepForm.customerName.trim();
    const item = keepForm.item.trim();
    if (!customerName || !item) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        customerName,
        item,
        openedAt: keepForm.openedAt || today(),
        createdAt: serverTimestamp(),
      };
      const expiresAt = keepForm.expiresAt.trim();
      const remaining = keepForm.remaining.trim();
      if (expiresAt) payload.expiresAt = expiresAt; // undefined は書き込まない
      if (remaining) payload.remaining = remaining;
      await addDoc(collection(db, keepPath), payload);
      setKeepForm(null);
    } finally { setBusy(false); }
  };

  const removeKeep = async (id: string) => {
    if (!keepPath || busy) return;
    setBusy(true);
    try { await deleteDoc(doc(db, `${keepPath}/${id}`)); }
    finally { setBusy(false); }
  };

  // ─ ローディング / 未所属 ─
  if (shop.loading) {
    return (
      <div style={shellStyle}>
        <p style={{ color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 13 }}>読み込み中…</p>
      </div>
    );
  }
  if (!shop.shopId) {
    return (
      <div style={shellStyle}>
        <p style={{ color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 13 }}>所属店舗が見つかりません。</p>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      {/* ambient glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-8%',
          width: 640,
          height: 380,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* ─ header ─ */}
        <header style={{ marginBottom: 24 }}>
          {/* パンくず */}
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
              <li>inventory</li>
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
                ノクサ · 在庫
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
                  № 08
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  在庫
                </span>
              </h1>
            </div>

            {/* 発注アラート件数バッジ */}
            {alertItems.length > 0 && (
              <div
                role="status"
                aria-live="polite"
                aria-label={`発注アラート ${alertItems.length} 件`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  background: 'rgba(196, 56, 74, 0.12)',
                  border: '1px solid rgba(196, 56, 74, 0.40)',
                  borderRadius: 9999,
                  fontFamily: mono,
                  fontSize: 11,
                  letterSpacing: '0.10em',
                  color: 'var(--noxa-status-error)',
                  textTransform: 'uppercase',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--noxa-status-error)',
                    boxShadow: '0 0 8px var(--noxa-status-error)',
                  }}
                />
                発注アラート · {alertItems.length} 件
              </div>
            )}
          </div>
        </header>

        {/* ─ セクション 1: 発注アラート ─ */}
        <section aria-label="発注アラート" style={{ marginBottom: 32 }}>
          <SectionTitle>発注アラート</SectionTitle>

          {alertItems.length === 0 ? (
            <p style={{ color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 13 }}>
              適正在庫割れの品なし
            </p>
          ) : (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              style={{ gap: 10 }}
            >
              {alertItems.map((item) => {
                const st = getStockStatus(item);
                const meta = STATUS_META[st];
                return (
                  <div
                    key={item.id}
                    role="alert"
                    style={{
                      background: meta.bgAlpha,
                      border: `1px solid ${meta.color}40`,
                      borderLeft: `3px solid ${meta.color}`,
                      borderRadius: 12,
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {/* 品名 + ステータスドット */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--noxa-text-primary)' }}>
                        {item.name}
                      </span>
                      <StatusBadge status={st} />
                    </div>

                    {/* 在庫数 / 適正在庫 */}
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <span style={{ color: 'var(--noxa-text-muted)' }}>
                        在庫{' '}
                        <span
                          style={{
                            fontFamily: mono,
                            fontVariantNumeric: 'tabular-nums',
                            color: meta.color,
                            fontWeight: 700,
                          }}
                        >
                          {item.qty}
                        </span>
                        {' '}{item.unit}
                      </span>
                      <span style={{ color: 'var(--noxa-text-faint)' }}>
                        適正{' '}
                        <span style={{ fontFamily: mono, fontVariantNumeric: 'tabular-nums' }}>
                          {item.par}
                        </span>
                        {' '}{item.unit}
                      </span>
                    </div>

                    {/* 在庫補充（+1） */}
                    <button
                      type="button"
                      onClick={() => adjustQty(item, 1)}
                      disabled={busy}
                      aria-label={`${item.name} を 1 補充する`}
                      style={{
                        appearance: 'none',
                        cursor: 'pointer',
                        alignSelf: 'flex-start',
                        minHeight: 32,
                        padding: '5px 14px',
                        borderRadius: 8,
                        border: `1px solid ${meta.color}80`,
                        background: `${meta.color}18`,
                        color: meta.color,
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        fontSize: 12,
                        fontWeight: 600,
                        transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      }}
                    >
                      補充 +1
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ─ セクション 2: 在庫リストテーブル ─ */}
        <section aria-label="在庫一覧" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionTitle>在庫一覧</SectionTitle>
            <button
              type="button"
              onClick={() => setEditor({ id: null, name: '', category: 'bottle', qty: '0', par: '0', unit: '' })}
              style={addBtnStyle}
            >
              ＋ 品目を追加
            </button>
          </div>

          {/* カテゴリフィルタタブ */}
          <div
            role="tablist"
            aria-label="在庫カテゴリ"
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 4,
              marginBottom: 16,
            }}
          >
            {CATEGORY_TABS.map((c) => {
              const active = c.id === activeCategory;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(c.id)}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    minHeight: 36,
                    padding: '7px 16px',
                    borderRadius: 9999,
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)',
                    color: active ? '#fff' : 'var(--noxa-text-muted)',
                    border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
                    boxShadow: active ? 'var(--noxa-glow-soft)' : 'none',
                    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {filteredStock.length === 0 ? (
            <p style={{ color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 13 }}>
              この区分の品目はまだありません。「＋ 品目を追加」から登録してください。
            </p>
          ) : (
            /* テーブル（375px で横スクロール） */
            <div
              style={{
                overflowX: 'auto',
                borderRadius: 14,
                border: '1px solid var(--noxa-border)',
                background: 'var(--noxa-surface-card)',
              }}
            >
              <table
                style={{
                  width: '100%',
                  minWidth: 560,
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--noxa-font-sans-jp)',
                  fontSize: 13,
                }}
                aria-label="在庫テーブル"
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--noxa-divider)',
                      textAlign: 'left',
                    }}
                  >
                    {['品名', 'カテゴリ', '在庫数', '適正', '状態', ''].map((h, i) => (
                      <th
                        key={h || `col${i}`}
                        scope="col"
                        style={{
                          padding: '11px 16px',
                          fontFamily: mono,
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--noxa-text-faint)',
                          whiteSpace: 'nowrap',
                          textAlign: i >= 2 && i <= 3 ? 'right' : 'left',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((item, idx) => {
                    const st = getStockStatus(item);
                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom:
                            idx < filteredStock.length - 1
                              ? '1px solid var(--noxa-divider)'
                              : 'none',
                          background:
                            st === 'out'
                              ? 'rgba(196, 56, 74, 0.04)'
                              : st === 'low'
                                ? 'rgba(245, 212, 114, 0.03)'
                                : 'transparent',
                          transition: 'background var(--noxa-duration-fast) var(--noxa-ease-natural)',
                        }}
                      >
                        <td style={{ padding: '12px 16px', color: 'var(--noxa-text-primary)', fontWeight: 500 }}>
                          {item.name}
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--noxa-text-muted)' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 10px',
                              borderRadius: 6,
                              background: 'var(--noxa-surface-muted)',
                              fontSize: 11,
                              fontFamily: mono,
                            }}
                          >
                            {CATEGORY_LABEL[item.category]}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: '12px 16px',
                            fontFamily: mono,
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: 14,
                            fontWeight: 700,
                            color:
                              st === 'out'
                                ? 'var(--noxa-status-error)'
                                : st === 'low'
                                  ? 'var(--noxa-status-warning)'
                                  : 'var(--noxa-text-primary)',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {/* 在庫増減 */}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => adjustQty(item, -1)} disabled={busy} aria-label="在庫を1減らす" style={stepBtnStyle}>−</button>
                            <span style={{ minWidth: 44, textAlign: 'right' }}>{item.qty} {item.unit}</span>
                            <button type="button" onClick={() => adjustQty(item, 1)} disabled={busy} aria-label="在庫を1増やす" style={stepBtnStyle}>＋</button>
                          </span>
                        </td>
                        <td
                          style={{
                            padding: '12px 16px',
                            fontFamily: mono,
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: 13,
                            color: 'var(--noxa-text-faint)',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.par} {item.unit}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <StatusBadge status={st} />
                        </td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => setEditor({ id: item.id, name: item.name, category: item.category, qty: String(item.qty), par: String(item.par), unit: item.unit })}
                            title="編集"
                            style={iconBtnStyle}
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            title="削除"
                            style={{ ...iconBtnStyle, color: 'var(--noxa-text-faint)' }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─ セクション 3: ボトルキープ一覧 ─ */}
        <section aria-label="ボトルキープ一覧">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionTitle>ボトルキープ一覧</SectionTitle>
            <button
              type="button"
              onClick={() => setKeepForm({ customerName: '', item: '', openedAt: today(), expiresAt: '', remaining: '' })}
              style={addBtnStyle}
            >
              ＋ キープを追加
            </button>
          </div>

          {keeps.length === 0 ? (
            <p style={{ color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 13 }}>
              ボトルキープはまだありません。
            </p>
          ) : (
            <div
              style={{
                overflowX: 'auto',
                borderRadius: 14,
                border: '1px solid var(--noxa-border)',
                background: 'var(--noxa-surface-card)',
              }}
            >
              <table
                style={{
                  width: '100%',
                  minWidth: 640,
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--noxa-font-sans-jp)',
                  fontSize: 13,
                }}
                aria-label="ボトルキープテーブル"
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--noxa-divider)', textAlign: 'left' }}>
                    {['客名', '銘柄', 'キープ日', '期限', '残量', ''].map((h, i) => (
                      <th
                        key={h || `kcol${i}`}
                        scope="col"
                        style={{
                          padding: '11px 16px',
                          fontFamily: mono,
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--noxa-text-faint)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keeps.map((k, idx) => (
                    <tr
                      key={k.id}
                      style={{
                        borderBottom:
                          idx < keeps.length - 1
                            ? '1px solid var(--noxa-divider)'
                            : 'none',
                        background: k.nearExpiry
                          ? 'rgba(245, 212, 114, 0.04)'
                          : 'transparent',
                      }}
                    >
                      {/* 客名 */}
                      <td
                        style={{
                          padding: '12px 16px',
                          color: 'var(--noxa-text-primary)',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {k.nearExpiry && (
                            <span
                              aria-hidden
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                background: 'var(--noxa-status-warning)',
                                boxShadow: '0 0 6px var(--noxa-status-warning)',
                                flex: 'none',
                              }}
                            />
                          )}
                          {k.customerName}
                        </div>
                      </td>
                      {/* 銘柄 */}
                      <td style={{ padding: '12px 16px', color: 'var(--noxa-text-muted)' }}>
                        {k.item}
                      </td>
                      {/* キープ日 */}
                      <td
                        style={{
                          padding: '12px 16px',
                          fontFamily: mono,
                          fontSize: 12,
                          color: 'var(--noxa-text-faint)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {k.openedAt || '—'}
                      </td>
                      {/* 期限 */}
                      <td
                        style={{
                          padding: '12px 16px',
                          fontFamily: mono,
                          fontSize: 12,
                          color: k.nearExpiry ? 'var(--noxa-status-warning)' : 'var(--noxa-text-muted)',
                          fontWeight: k.nearExpiry ? 600 : 400,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {k.expiresAt || '—'}
                        {k.nearExpiry && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 10,
                              letterSpacing: '0.06em',
                              color: 'var(--noxa-status-warning)',
                            }}
                          >
                            期限間近
                          </span>
                        )}
                      </td>
                      {/* 残量バー */}
                      <td style={{ padding: '12px 16px', minWidth: 120 }}>
                        {k.remainingPct !== null ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                            aria-label={`残量 ${k.remainingPct}%`}
                          >
                            {/* プログレスバー */}
                            <div
                              aria-hidden
                              style={{
                                flex: 1,
                                height: 6,
                                borderRadius: 3,
                                background: 'var(--noxa-surface-muted)',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  height: '100%',
                                  width: `${k.remainingPct}%`,
                                  borderRadius: 3,
                                  background:
                                    k.remainingPct <= 30
                                      ? 'var(--noxa-status-warning)'
                                      : 'var(--noxa-accent-primary-ink)',
                                  transition: 'width var(--noxa-duration-fast) var(--noxa-ease-natural)',
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontFamily: mono,
                                fontSize: 12,
                                fontVariantNumeric: 'tabular-nums',
                                color:
                                  k.remainingPct <= 30
                                    ? 'var(--noxa-status-warning)'
                                    : 'var(--noxa-text-muted)',
                                flex: 'none',
                                minWidth: 32,
                                textAlign: 'right',
                              }}
                            >
                              {k.remainingPct}%
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>
                            {k.remaining || '—'}
                          </span>
                        )}
                      </td>
                      {/* 削除 */}
                      <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => removeKeep(k.id)}
                          title="削除"
                          style={{ ...iconBtnStyle, color: 'var(--noxa-text-faint)' }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 期限間近の注意書き */}
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              fontFamily: mono,
              lineHeight: 1.6,
            }}
          >
            ※ 黄色のドット = 期限まで 7 日以内。
          </p>
        </section>
      </div>

      {/* 在庫品目エディタ（追加 / 編集） */}
      {editor && (
        <div onClick={() => setEditor(null)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <h3 style={modalTitle}>{editor.id ? '品目を編集' : '品目を追加'}</h3>

            <label style={fieldLabel}>品名
              <input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="例：鏡月（ボトル）" style={fieldInput} />
            </label>

            <label style={fieldLabel}>カテゴリ
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CATEGORY_OPTIONS.map((c) => {
                  const active = editor.category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditor({ ...editor, category: c })}
                      style={{
                        cursor: 'pointer',
                        minHeight: 34,
                        padding: '6px 14px',
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-bg-base)',
                        color: active ? '#fff' : 'var(--noxa-text-muted)',
                        border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
                      }}
                    >
                      {CATEGORY_LABEL[c]}
                    </button>
                  );
                })}
              </div>
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...fieldLabel, flex: 1 }}>在庫数
                <input type="number" inputMode="numeric" value={editor.qty} onChange={(e) => setEditor({ ...editor, qty: e.target.value })} style={fieldInput} />
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>適正在庫
                <input type="number" inputMode="numeric" value={editor.par} onChange={(e) => setEditor({ ...editor, par: e.target.value })} style={fieldInput} />
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>単位
                <input value={editor.unit} onChange={(e) => setEditor({ ...editor, unit: e.target.value })} placeholder="本 / kg 等" style={fieldInput} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={saveItem} disabled={busy || !editor.name.trim()} style={primaryBtn}>保存</button>
              <button type="button" onClick={() => setEditor(null)} style={ghostBtn}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* ボトルキープ追加 */}
      {keepForm && (
        <div onClick={() => setKeepForm(null)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <h3 style={modalTitle}>ボトルキープを追加</h3>

            <label style={fieldLabel}>客名
              <input value={keepForm.customerName} onChange={(e) => setKeepForm({ ...keepForm, customerName: e.target.value })} placeholder="例：田中 拓海" style={fieldInput} />
            </label>
            <label style={fieldLabel}>銘柄
              <input value={keepForm.item} onChange={(e) => setKeepForm({ ...keepForm, item: e.target.value })} placeholder="例：鏡月" style={fieldInput} />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ ...fieldLabel, flex: 1 }}>キープ日
                <input type="date" value={keepForm.openedAt} onChange={(e) => setKeepForm({ ...keepForm, openedAt: e.target.value })} style={{ ...fieldInput, fontFamily: mono }} />
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>期限
                <input type="date" value={keepForm.expiresAt} onChange={(e) => setKeepForm({ ...keepForm, expiresAt: e.target.value })} style={{ ...fieldInput, fontFamily: mono }} />
              </label>
            </div>
            <label style={fieldLabel}>残量
              <input value={keepForm.remaining} onChange={(e) => setKeepForm({ ...keepForm, remaining: e.target.value })} placeholder="例：65% / 半分" style={fieldInput} />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={saveKeep} disabled={busy || !keepForm.customerName.trim() || !keepForm.item.trim()} style={primaryBtn}>保存</button>
              <button type="button" onClick={() => setKeepForm(null)} style={ghostBtn}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// スタイル / 小コンポーネント
// ─────────────────────────────────────────────

const shellStyle: React.CSSProperties = {
  borderRadius: 16,
  border: '1px solid var(--noxa-border)',
  padding: 'clamp(16px, 3vw, 28px)',
  position: 'relative',
  overflow: 'hidden',
  color: 'var(--noxa-text-primary)',
  fontFamily: 'var(--noxa-font-sans-jp)',
};

const addBtnStyle: React.CSSProperties = {
  appearance: 'none',
  cursor: 'pointer',
  minHeight: 34,
  padding: '6px 14px',
  borderRadius: 9999,
  border: '1px solid var(--noxa-accent-primary)',
  background: 'rgba(139, 92, 246, 0.12)',
  color: 'var(--noxa-accent-primary-ink)',
  fontFamily: 'var(--noxa-font-sans-jp)',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 14,
};

const stepBtnStyle: React.CSSProperties = {
  appearance: 'none',
  cursor: 'pointer',
  width: 26,
  height: 26,
  borderRadius: 7,
  border: '1px solid var(--noxa-border)',
  background: 'var(--noxa-bg-base)',
  color: 'var(--noxa-text-primary)',
  fontSize: 14,
  fontFamily: mono,
  lineHeight: 1,
  flex: 'none',
};

const iconBtnStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--noxa-text-muted)',
  fontSize: 12,
  padding: '4px 6px',
  fontFamily: 'var(--noxa-font-sans-jp)',
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 210,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const modalCard: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--noxa-surface-card)',
  border: '1px solid var(--noxa-border)',
  borderRadius: 16,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  color: 'var(--noxa-text-primary)',
  fontFamily: 'var(--noxa-font-sans-jp)',
};

const modalTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--noxa-font-display-jp)',
  fontSize: 16,
};

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: 'var(--noxa-text-muted)',
};

const fieldInput: React.CSSProperties = {
  minHeight: 40,
  padding: '6px 10px',
  borderRadius: 10,
  background: 'var(--noxa-bg-base)',
  border: '1px solid var(--noxa-border)',
  color: 'var(--noxa-text-primary)',
  fontSize: 14,
  fontFamily: 'var(--noxa-font-sans-jp)',
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  minHeight: 44,
  borderRadius: 12,
  cursor: 'pointer',
  background: 'var(--noxa-accent-primary)',
  color: '#fff',
  border: 'none',
  fontSize: 14,
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 12,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--noxa-text-muted)',
  border: '1px solid var(--noxa-border)',
  fontSize: 14,
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="noxa-eyebrow"
      style={{ fontSize: 11, marginBottom: 14, display: 'block' }}
    >
      {children}
    </h2>
  );
}

/** ステータスドット + テキスト */
function StatusBadge({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 9999,
        background: meta.bgAlpha,
        border: `1px solid ${meta.color}40`,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: meta.color,
          boxShadow: status !== 'ok' ? `0 0 7px ${meta.color}` : 'none',
          flex: 'none',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--noxa-font-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.06em',
          color: meta.color,
        }}
      >
        {meta.label}
      </span>
    </span>
  );
}

export default InventoryClient;
