'use client';

import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import { Shell, Section, Empty, Eyebrow, lbl, field, chip } from '@/components/modules/schedule/ScheduleClient';

/**
 * 店舗サブコレクションの汎用 CRUD モジュール。
 * shop_shops/{shopId}/{collection} を読み書きし、フィールド定義に応じた追加フォーム＋一覧を出す。
 * sensitive=true（売掛/リスク等）はオーナー（canManage）のみ。
 */
const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

export type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'date' | 'select';
  options?: string[];
  placeholder?: string;
  primary?: boolean; // 一覧の見出し
  flex?: number;     // 追加フォームの伸び
};

export type ShopCollectionConfig = {
  title: string;
  eyebrow: string;
  crumb: string;
  collection: string;
  fields: FieldDef[];
  sensitive?: boolean;
  emptyHint?: string;
  addLabel?: string;
};

function defaultValue(f: FieldDef): string {
  if (f.type === 'date') return new Date().toISOString().slice(0, 10);
  if (f.type === 'select') return f.options?.[0] ?? '';
  if (f.type === 'number' || f.type === 'money') return '';
  return '';
}

export function ShopCollectionClient({ user, config }: { user: User; config: ShopCollectionConfig }) {
  const shop = useShopId(user);
  const [rows, setRows] = useState<{ id: string; data: DocumentData }[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(config.fields.map((f) => [f.key, defaultValue(f)])));
  const [busy, setBusy] = useState(false);

  const path = shop.shopId ? `shop_shops/${shop.shopId}/${config.collection}` : null;
  const reload = async () => {
    if (!path) return;
    try { const snap = await getDocs(collection(db, path)); const out: { id: string; data: DocumentData }[] = []; snap.forEach((d) => out.push({ id: d.id, data: d.data() })); out.sort((a, b) => (b.data.createdAt?.seconds ?? 0) - (a.data.createdAt?.seconds ?? 0)); setRows(out); } catch { /* skip */ }
  };
  useEffect(() => {
    if (shop.loading) return;
    let alive = true;
    (async () => { if (path) await reload(); if (alive) setLoading(false); })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.loading, shop.shopId]);

  const locked = config.sensitive && !shop.canManage && !shop.isDevice;
  const primary = config.fields.find((f) => f.primary) ?? config.fields[0];

  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const add = async () => {
    if (!path || busy) return;
    const pv = form[primary.key]?.trim?.() ?? form[primary.key];
    if (!pv) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { createdAt: serverTimestamp(), createdBy: user.uid };
      for (const f of config.fields) {
        const raw = form[f.key];
        if (raw === undefined || raw === '') continue;
        payload[f.key] = (f.type === 'number' || f.type === 'money') ? Number(raw) : raw;
      }
      await addDoc(collection(db, path), payload);
      setForm(Object.fromEntries(config.fields.map((f) => [f.key, defaultValue(f)])));
      await reload();
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => { if (!path) return; await deleteDoc(doc(db, `${path}/${id}`)); setRows((p) => p.filter((r) => r.id !== id)); };

  const render = (f: FieldDef, v: unknown): string => {
    if (v === undefined || v === null || v === '') return '—';
    if (f.type === 'money') return yen(Number(v));
    return String(v);
  };

  return (
    <Shell title={config.title} eyebrow={config.eyebrow} crumb={config.crumb} badge={shop.isDevice ? '店舗端末 · 実データ' : '実データ'}>
      {shop.loading || loading ? <Eyebrow>読み込み中…</Eyebrow> : !shop.shopId ? (
        <Section label={config.title}><Empty>所属店舗が見つかりません。オーナーは店舗登録、キャストは所属が必要です。</Empty></Section>
      ) : locked ? (
        <Section label={config.title}><Empty>このモジュールはオーナー専用です（店舗端末・一般メンバーには表示されません）。</Empty></Section>
      ) : (
        <>
          {/* 追加フォーム */}
          <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
            {config.fields.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: `${f.flex ?? 1} 1 120px` }}>
                <span style={lbl}>{f.label}</span>
                {f.type === 'select' ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(f.options ?? []).map((o) => <button key={o} type="button" onClick={() => setF(f.key, o)} style={chip(form[f.key] === o)}>{o}</button>)}</div>
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : (f.type === 'number' || f.type === 'money') ? 'number' : 'text'}
                    inputMode={(f.type === 'number' || f.type === 'money') ? 'numeric' : undefined}
                    value={form[f.key] ?? ''} onChange={(e) => setF(f.key, e.target.value)} placeholder={f.placeholder}
                    style={{ ...field, fontFamily: f.type === 'date' ? mono : undefined }} />
                )}
              </label>
            ))}
            <button type="button" onClick={add} disabled={busy || !(form[primary.key] ?? '')} style={{ ...chip(true), minHeight: 40, padding: '0 18px', opacity: busy ? 0.6 : 1 }}>{config.addLabel ?? '追加'}</button>
          </div>

          <Section label={`一覧（${rows.length}）`}>
            {rows.length === 0 ? <Empty>{config.emptyHint ?? 'まだありません。上から追加してください。'}</Empty> : rows.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{render(primary, r.data[primary.key])}</span>
                {config.fields.filter((f) => !f.primary && f !== primary).slice(0, 3).map((f) => (
                  <span key={f.key} style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)' }}>{render(f, r.data[f.key])}</span>
                ))}
                <button type="button" onClick={() => remove(r.id)} title="削除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 14 }}>×</button>
              </div>
            ))}
          </Section>
        </>
      )}
    </Shell>
  );
}

export default ShopCollectionClient;
