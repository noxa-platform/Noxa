'use client';

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
 * リスク客共有 — Noxa OS モジュール（機微・オーナー専用）
 *
 * 出禁・要注意・売掛トラブル・迷惑行為客を店舗内で共有するモジュール。
 * 実名は伏せ、イニシャル＋特徴のみ表示。共有範囲は自店のみ。
 * shop_shops/{shopId}/risk_customers を読み書きする（onSnapshot でリアルタイム）。
 * オーナー（shop.canManage）のみ閲覧・編集可能。
 */

const mono = 'var(--noxa-font-mono)';

type RiskCategory = 'banned' | 'caution' | 'credit' | 'nuisance';

type RiskEntry = {
  id: string;
  label: string; // イニシャル・特徴（例「H様・40代」）
  category: RiskCategory;
  detail: string; // 内容
  by: string; // 共有者
  date: string; // YYYY-MM-DD（登録日）
};

const CATEGORY_META: Record<RiskCategory, { label: string; colorVar: string; borderVar: string; bgVar: string }> = {
  banned: {
    label: '出禁',
    colorVar: 'var(--noxa-status-error, #f87171)',
    borderVar: 'rgba(248,113,113,0.35)',
    bgVar: 'rgba(248,113,113,0.08)',
  },
  caution: {
    label: '要注意',
    colorVar: 'var(--noxa-status-warning, #facc15)',
    borderVar: 'rgba(250,204,21,0.35)',
    bgVar: 'rgba(250,204,21,0.08)',
  },
  credit: {
    label: '売掛トラブル',
    colorVar: 'var(--noxa-accent-destructive, #c084fc)',
    borderVar: 'rgba(192,132,252,0.35)',
    bgVar: 'rgba(192,132,252,0.08)',
  },
  nuisance: {
    label: '迷惑行為',
    colorVar: 'var(--noxa-status-warning, #facc15)',
    borderVar: 'rgba(250,204,21,0.35)',
    bgVar: 'rgba(250,204,21,0.08)',
  },
};

type FilterKey = 'all' | RiskCategory;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'banned', label: '出禁' },
  { key: 'caution', label: '要注意' },
  { key: 'credit', label: '売掛トラブル' },
  { key: 'nuisance', label: '迷惑行為' },
];

const CATEGORY_KEYS: RiskCategory[] = ['banned', 'caution', 'credit', 'nuisance'];

function isCategory(v: unknown): v is RiskCategory {
  return typeof v === 'string' && (CATEGORY_KEYS as string[]).includes(v);
}

function toEntry(id: string, data: DocumentData): RiskEntry {
  const category = isCategory(data.category) ? data.category : 'caution';
  return {
    id,
    label: typeof data.label === 'string' ? data.label : '',
    category,
    detail: typeof data.detail === 'string' ? data.detail : '',
    by: typeof data.by === 'string' ? data.by : '',
    date: typeof data.date === 'string' ? data.date : '',
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export function RiskClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [entries, setEntries] = useState<RiskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 追加フォーム
  const [showForm, setShowForm] = useState(false);
  const [fLabel, setFLabel] = useState('');
  const [fCategory, setFCategory] = useState<RiskCategory>('banned');
  const [fDetail, setFDetail] = useState('');
  const [fDate, setFDate] = useState(today());

  // 編集中の id
  const [editId, setEditId] = useState<string | null>(null);
  const [eLabel, setELabel] = useState('');
  const [eCategory, setECategory] = useState<RiskCategory>('banned');
  const [eDetail, setEDetail] = useState('');
  const [eDate, setEDate] = useState('');

  const canView = shop.canManage; // 機微：オーナーのみ
  const path = shop.shopId && canView ? `shop_shops/${shop.shopId}/risk_customers` : null;

  useEffect(() => {
    if (shop.loading) return;
    if (!path) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, path),
      (snap) => {
        const out: RiskEntry[] = [];
        snap.forEach((d) => out.push(toEntry(d.id, d.data())));
        out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setEntries(out);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.loading, path]);

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((r) => r.category === filter)),
    [entries, filter],
  );

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: entries.length, banned: 0, caution: 0, credit: 0, nuisance: 0 };
    for (const e of entries) c[e.category] += 1;
    return c;
  }, [entries]);

  const resetForm = () => {
    setFLabel('');
    setFCategory('banned');
    setFDetail('');
    setFDate(today());
  };

  const add = async () => {
    if (!path || busy) return;
    const label = fLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      // undefined を書かない（空欄はそのまま空文字で保持）
      const payload: Record<string, unknown> = {
        label,
        category: fCategory,
        detail: fDetail.trim(),
        by: user.displayName || user.email || user.uid,
        date: fDate || today(),
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, path), payload);
      resetForm();
      setShowForm(false);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (e: RiskEntry) => {
    setEditId(e.id);
    setELabel(e.label);
    setECategory(e.category);
    setEDetail(e.detail);
    setEDate(e.date || today());
  };

  const saveEdit = async () => {
    if (!path || !editId || busy) return;
    const label = eLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, `${path}/${editId}`), {
        label,
        category: eCategory,
        detail: eDetail.trim(),
        date: eDate || today(),
      });
      setEditId(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!path || busy) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, `${path}/${id}`));
    } finally {
      setBusy(false);
    }
  };

  // 区分選択チップ（フォーム共用）
  const categoryPicker = (value: RiskCategory, onChange: (v: RiskCategory) => void) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {CATEGORY_KEYS.map((k) => {
        const meta = CATEGORY_META[k];
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            style={{
              padding: '4px 11px',
              borderRadius: 9999,
              border: `1px solid ${active ? meta.borderVar : 'var(--noxa-border)'}`,
              background: active ? meta.bgVar : 'transparent',
              color: active ? meta.colorVar : 'var(--noxa-text-muted)',
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              cursor: 'pointer',
            }}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 9,
    border: '1px solid var(--noxa-border)',
    background: 'var(--noxa-bg-base)',
    color: 'var(--noxa-text-primary)',
    fontFamily: 'var(--noxa-font-sans-jp)',
    fontSize: 13,
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: '0.06em',
    color: 'var(--noxa-text-faint)',
    textTransform: 'uppercase',
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
          width: 600,
          height: 380,
          background: 'radial-gradient(ellipse, rgba(248,113,113,0.07) 0%, transparent 65%)',
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
              <a href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                Noxa OS
              </a>
            </li>
            <li aria-hidden>·</li>
            <li>risk</li>
          </ol>
        </nav>

        {/* eyebrow + 見出し */}
        <div style={{ marginBottom: 20 }}>
          <div
            className="noxa-eyebrow"
            style={{ marginBottom: 6, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}
          >
            ノクサ · リスク客共有
          </div>
          <h1
            style={{
              fontSize: 'clamp(24px, 4vw, 36px)',
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
                color: 'var(--noxa-status-error, #f87171)',
                fontWeight: 400,
              }}
            >
              Risk
            </span>
            <span
              style={{
                fontFamily: 'var(--noxa-font-display-jp)',
                fontWeight: 500,
              }}
            >
              リスク客共有
            </span>
          </h1>
        </div>

        {/* 重要注記バナー */}
        <div
          role="note"
          aria-label="取り扱い注意事項"
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            background: 'rgba(248,113,113,0.07)',
            border: '1px solid rgba(248,113,113,0.30)',
            borderRadius: 12,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              marginTop: 1,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'rgba(248,113,113,0.25)',
              border: '1px solid rgba(248,113,113,0.50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              color: 'var(--noxa-status-error, #f87171)',
              fontWeight: 700,
            }}
          >
            !
          </span>
          <div>
            <p
              style={{
                margin: '0 0 3px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--noxa-status-error, #f87171)',
                fontFamily: mono,
                letterSpacing: '0.04em',
              }}
            >
              取り扱い注意 — 店舗内限定情報
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--noxa-text-muted)', lineHeight: 1.6 }}>
              この情報は自店スタッフのみが閲覧できます。個人情報保護の観点から実名は記録せず、外部への共有・スクリーンショット配布は禁止です。
            </p>
          </div>
        </div>

        {/* 状態別表示 */}
        {shop.loading || (canView && loading) ? (
          <p style={{ margin: 0, fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>読み込み中…</p>
        ) : !shop.shopId ? (
          <p style={{ margin: 0, fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>所属店舗が見つかりません。</p>
        ) : !canView ? (
          <p style={{ margin: 0, fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>このモジュールはオーナー専用です。</p>
        ) : (
          <>
            {/* フィルタ */}
            <div
              role="tablist"
              aria-label="リスク区分フィルタ"
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: 20,
              }}
            >
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(f.key)}
                    style={{
                      padding: '5px 13px',
                      borderRadius: 9999,
                      border: active ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)',
                      background: active ? 'rgba(103,232,249,0.10)' : 'transparent',
                      color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)',
                      fontFamily: mono,
                      fontSize: 11,
                      letterSpacing: '0.06em',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                    }}
                  >
                    {f.label}
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)',
                      }}
                    >
                      {counts[f.key]}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* リスト */}
            {filtered.length === 0 ? (
              <p style={{ margin: '0 0 4px', fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>
                {filter === 'all' ? '登録がありません。右下の「登録」から共有してください。' : '該当する区分の登録がありません。'}
              </p>
            ) : (
              <ul
                aria-label="リスク客一覧"
                style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                {filtered.map((entry) => {
                  const meta = CATEGORY_META[entry.category];
                  const editing = editId === entry.id;
                  return (
                    <li
                      key={entry.id}
                      style={{
                        background: 'var(--noxa-surface-card)',
                        border: `1px solid var(--noxa-border)`,
                        borderLeft: `3px solid ${meta.colorVar}`,
                        borderRadius: 12,
                        padding: '14px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {editing ? (
                        /* 編集フォーム */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={labelStyle}>イニシャル・特徴</span>
                            <input style={inputStyle} value={eLabel} onChange={(e) => setELabel(e.target.value)} placeholder="例：H様・40代・スーツ" />
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={labelStyle}>区分</span>
                            {categoryPicker(eCategory, setECategory)}
                          </div>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={labelStyle}>内容</span>
                            <input style={inputStyle} value={eDetail} onChange={(e) => setEDetail(e.target.value)} placeholder="状況・理由" />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200 }}>
                            <span style={labelStyle}>登録日</span>
                            <input type="date" style={{ ...inputStyle, fontFamily: mono }} value={eDate} onChange={(e) => setEDate(e.target.value)} />
                          </label>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => setEditId(null)}
                              style={{
                                padding: '7px 16px',
                                borderRadius: 9999,
                                border: '1px solid var(--noxa-border)',
                                background: 'transparent',
                                color: 'var(--noxa-text-muted)',
                                fontFamily: mono,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              キャンセル
                            </button>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={busy || !eLabel.trim()}
                              style={{
                                padding: '7px 18px',
                                borderRadius: 9999,
                                border: '1px solid var(--noxa-accent-primary)',
                                background: 'rgba(103,232,249,0.10)',
                                color: 'var(--noxa-accent-primary-ink)',
                                fontFamily: mono,
                                fontSize: 11,
                                cursor: busy || !eLabel.trim() ? 'not-allowed' : 'pointer',
                                opacity: busy || !eLabel.trim() ? 0.6 : 1,
                              }}
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* カード上段：ラベル + バッジ */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: 8,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: 'var(--noxa-text-primary)',
                                lineHeight: 1.4,
                              }}
                            >
                              {entry.label}
                            </span>
                            <span
                              aria-label={`区分: ${meta.label}`}
                              style={{
                                flexShrink: 0,
                                padding: '3px 10px',
                                borderRadius: 9999,
                                border: `1px solid ${meta.borderVar}`,
                                background: meta.bgVar,
                                fontFamily: mono,
                                fontSize: 10,
                                letterSpacing: '0.08em',
                                color: meta.colorVar,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {meta.label}
                            </span>
                          </div>

                          {/* 内容 */}
                          {entry.detail ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: 13,
                                color: 'var(--noxa-text-muted)',
                                lineHeight: 1.6,
                              }}
                            >
                              {entry.detail}
                            </p>
                          ) : null}

                          {/* 下段：登録日 + 共有者 + 操作 */}
                          <div
                            style={{
                              display: 'flex',
                              gap: 14,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            {entry.date ? (
                              <span
                                style={{
                                  fontFamily: mono,
                                  fontSize: 10,
                                  color: 'var(--noxa-text-faint)',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                登録日：{entry.date}
                              </span>
                            ) : null}
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontFamily: mono,
                                fontSize: 10,
                                color: 'var(--noxa-text-faint)',
                                letterSpacing: '0.04em',
                              }}
                            >
                              <span
                                aria-hidden
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  background: 'var(--noxa-text-faint)',
                                  opacity: 0.5,
                                }}
                              />
                              {entry.by ? `共有：${entry.by}` : '自店のみ'}
                            </span>
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                              <button
                                type="button"
                                onClick={() => startEdit(entry)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--noxa-text-muted)',
                                  fontFamily: mono,
                                  fontSize: 11,
                                  padding: 0,
                                }}
                              >
                                編集
                              </button>
                              <button
                                type="button"
                                onClick={() => remove(entry.id)}
                                disabled={busy}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: busy ? 'not-allowed' : 'pointer',
                                  color: 'var(--noxa-status-error, #f87171)',
                                  fontFamily: mono,
                                  fontSize: 11,
                                  padding: 0,
                                  opacity: busy ? 0.6 : 1,
                                }}
                              >
                                削除
                              </button>
                            </span>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 追加フォーム */}
            {showForm ? (
              <div
                style={{
                  marginTop: 16,
                  background: 'var(--noxa-surface-card)',
                  border: '1px solid var(--noxa-border)',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>イニシャル・特徴</span>
                  <input style={inputStyle} value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="例：H様・40代・スーツ" />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>区分</span>
                  {categoryPicker(fCategory, setFCategory)}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>内容</span>
                  <input style={inputStyle} value={fDetail} onChange={(e) => setFDetail(e.target.value)} placeholder="状況・理由（実名は記録しない）" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 200 }}>
                  <span style={labelStyle}>登録日</span>
                  <input type="date" style={{ ...inputStyle, fontFamily: mono }} value={fDate} onChange={(e) => setFDate(e.target.value)} />
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 9999,
                      border: '1px solid var(--noxa-border)',
                      background: 'transparent',
                      color: 'var(--noxa-text-muted)',
                      fontFamily: mono,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={add}
                    disabled={busy || !fLabel.trim()}
                    style={{
                      padding: '8px 22px',
                      borderRadius: 9999,
                      border: '1px solid var(--noxa-accent-primary)',
                      background: 'rgba(103,232,249,0.10)',
                      color: 'var(--noxa-accent-primary-ink)',
                      fontFamily: mono,
                      fontSize: 12,
                      letterSpacing: '0.06em',
                      cursor: busy || !fLabel.trim() ? 'not-allowed' : 'pointer',
                      opacity: busy || !fLabel.trim() ? 0.6 : 1,
                    }}
                  >
                    登録する
                  </button>
                </div>
              </div>
            ) : (
              /* 「登録」ボタン */
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  aria-label="リスク客を新規登録"
                  onClick={() => setShowForm(true)}
                  style={{
                    padding: '9px 22px',
                    borderRadius: 9999,
                    border: '1px solid var(--noxa-accent-primary)',
                    background: 'rgba(103,232,249,0.10)',
                    color: 'var(--noxa-accent-primary-ink)',
                    fontFamily: mono,
                    fontSize: 12,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                  }}
                >
                  + 登録
                </button>
              </div>
            )}

            {/* フッター注記 */}
            <p
              style={{
                margin: '16px 0 0',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--noxa-text-faint)',
                fontFamily: mono,
              }}
            >
              ※ 個人情報保護のため実名は記録しないでください。イニシャル＋特徴のみで共有します。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default RiskClient;
