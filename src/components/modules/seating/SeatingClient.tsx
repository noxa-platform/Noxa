'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useSeatingStore } from '@/lib/seating/store';
import { useShopConfig } from '@/lib/shopConfig';
import { PosClient } from '@/components/modules/pos/PosClient';
import { generateSmartProposals, getSourcingCandidates, sanitizeAiPlan, ASSIST_MODE_LABEL, type AiPlanItem, type AssistMode } from '@/lib/seating/ai';
import { computeSetTimer, orderedRotationQueue, moveInOrder, firstVisitPickupSet } from '@/lib/seating/logic';
import { calculateResult, type CalculatorState } from '@/lib/pos/engine';
import { AI_CONSENT_TEXT } from '@/lib/ai-privacy';
import { createDefaultStoreConfig } from '@/lib/pos/defaultConfig';
import type { StoreConfig } from '@/lib/pos/types';
import type { Cast, FloorTable, TableType, Customer, CastStatus, Rank } from '@/lib/seating/types';

/**
 * ③ 席回し — フロア管理 / キャストローテーション（実データ）
 *
 * night_manager（zustand 版）を NOXA へ移植。ドラッグ&ドロップではなくタップ操作で
 * キャストを卓へ配置（タブレット運用向け）。卓・キャスト・待機列を Firestore に
 * リアルタイム保存し、共有端末間で同期。AI が初回卓のペアリング/席内ローテを提案。
 */

const mono = 'var(--noxa-font-mono)';
const TABLE_TYPES: TableType[] = ['初回', '初回指名', 'R', '正規'];
const RANKS: Rank[] = ['BOSS', '役職', '非役職', '新人'];

const RANK_TINT: Record<Rank, string> = {
  BOSS: '#F5D472', 役職: '#B89CFB', 非役職: '#67E8F9', 新人: '#7BE8A1',
};
const STATUS_LABEL: Record<CastStatus, string> = { Free: '待機', Work: '在卓', Break: '休憩', Absent: '欠勤' };

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

function elapsedMin(start: number | null): number {
  if (!start) return 0;
  return Math.floor((Date.now() - start) / 60000);
}

/** POS 料金設定の購読（席回し画面で伝票金額を出すため。読取専用・無ければ既定値） */
function usePosConfigLite(shopId: string | null): StoreConfig {
  const [config, setConfig] = useState<StoreConfig>(() => createDefaultStoreConfig('active'));
  useEffect(() => {
    if (!shopId) return;
    const unsub = onSnapshot(doc(db, `shop_shops/${shopId}/pos_config/active`), (snap) => {
      if (snap.exists()) setConfig({ ...createDefaultStoreConfig('active'), ...(snap.data() as Partial<StoreConfig>) } as StoreConfig);
    }, () => { /* 権限なし等は既定のまま（金額は概算表示） */ });
    return () => unsub();
  }, [shopId]);
  return config;
}

/** 新規案内（first-visit タブレット）の着信購読。指名確定が席回しへ流れてきたことを知らせる */
type IncomingOrder = { id: string; seat: string; tableId: string | null; customerName: string; castNames: string[]; atMs: number };
function useIncomingFirstVisit(shopId: string | null): IncomingOrder[] {
  const [items, setItems] = useState<IncomingOrder[]>([]);
  useEffect(() => {
    if (!shopId) return;
    // 購読開始時点から直近15分以降のオーダーのみ（全件購読は read 数と表示の両方で無駄）
    const since = Timestamp.fromMillis(Date.now() - 15 * 60 * 1000);
    const q = query(collection(db, `shop_shops/${shopId}/menu_orders`), where('createdAt', '>=', since));
    const unsub = onSnapshot(q, (snap) => {
      const list: IncomingOrder[] = [];
      snap.forEach((d) => {
        const v = d.data() as Record<string, unknown>;
        const casts = Array.isArray(v.casts) ? (v.casts as { name?: string }[]).map((c) => c?.name ?? '?') : [];
        const at = (v.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
        list.push({ id: d.id, seat: (v.seat as string) ?? '', tableId: (v.tableId as string) ?? null, customerName: (v.customerName as string) ?? '', castNames: casts, atMs: at });
      });
      list.sort((a, b) => b.atMs - a.atMs);
      setItems(list);
    }, () => { /* menu_orders を読めないロールでは非表示 */ });
    return () => unsub();
  }, [shopId]);
  return items;
}

/** 卓の伝票サマリ（現在金額・伝票数・注文点数・担当/客名）。伝票が無ければ null */
type SlipSummary = { count: number; total: number; itemCount: number; castNames: string[]; customerNames: string[] };
function summarizeSlips(t: FloorTable, config: StoreConfig): SlipSummary | null {
  const slips = t.slips ?? [];
  if (slips.length === 0) return null;
  const d = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let total = 0; let itemCount = 0;
  const castNames = new Set<string>(); const customerNames = new Set<string>();
  for (const s of slips) {
    const live: CalculatorState = s.state.isDebugMode ? s.state : { ...s.state, currentTime: hhmm };
    try { total += calculateResult(live, config).currentTotal; } catch { /* 壊れた伝票は金額のみスキップ */ }
    for (const o of s.state.orders ?? []) if ((o?.count ?? 0) > 0) itemCount += o.count;
    if (s.castName) castNames.add(s.castName);
    if (s.customerName) customerNames.add(s.customerName);
  }
  return { count: slips.length, total, itemCount, castNames: [...castNames], customerNames: [...customerNames] };
}
function fmtElapsed(start: number | null): string {
  const m = elapsedMin(start);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// セット残り時間：現在のセット終わりまでの残分・何セット目か・残10分以下の警告。
// 計算本体は logic.ts の computeSetTimer（延長 extraMinutes 対応・単体テスト済み）。
function setTimer(t: FloorTable) {
  return computeSetTimer(t, Date.now());
}

// 卓内ローテ通知：自動ローテON卓で次のローテまでの残分（残3分以下で督促）
function rotationTimer(t: FloorTable): { remainingMin: number; due: boolean } | null {
  if (t.status !== 'ACTIVE' || !t.innerRotationEnabled || !t.rotationTimeLength || (t.currentHostIds?.length ?? 0) < 2 || !t.startTime) return null;
  const len = t.rotationTimeLength;
  const elapsed = elapsedMin(t.startTime);
  const remaining = Math.max(0, (Math.floor(elapsed / len) + 1) * len - elapsed);
  return { remainingMin: remaining, due: remaining <= 3 };
}

export function SeatingClient({ user }: { user: User }) {
  const store = useSeatingStore(user);
  const cfg = useShopConfig(user);
  const wageFor = (rank: string): number | undefined => cfg.config.roles.find((r) => r.name === rank)?.wage;
  const { casts, tables, queue } = store;
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [side, setSide] = useState<'casts' | 'queue'>('casts');
  // 伝票・会計モーダル（卓カードからも直行できるよう親で管理）
  const [posFor, setPosFor] = useState<string | null>(null);
  const posConfig = usePosConfigLite(store.shopId);
  // 新規案内（客用タブレット）の着信
  const incoming = useIncomingFirstVisit(store.shopId);
  const [seenOrders, setSeenOrders] = useState<Set<string>>(() => new Set());
  // AI 席回し（要望ベース・/api/ai/seating-suggest）
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPlan, setAiPlan] = useState<AiPlanItem[] | null>(null);
  const [aiNote, setAiNote] = useState('');
  // 退店アンドゥ（誤操作を60秒以内なら巻き戻せる）
  const [undo, setUndo] = useState<{ tableId: string; name: string; snapshot: Partial<FloorTable>; until: number } | null>(null);
  // 15秒ティック（残り時間等の再描画）。render 中の Date.now() 直呼びを避けるため now を state で持つ
  const [now, setTick] = useState(() => Date.now());

  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 15000); return () => clearInterval(t); }, []);

  const castById = useMemo(() => new Map(casts.map((c) => [c.id, c])), [casts]);
  // 計算ベースの采配エンジン（決定的・無料）。回す順番と采配モードを重みに反映
  const proposals = useMemo(
    () => generateSmartProposals(tables, casts, { rotationOrder: store.rotationOrder, mode: store.assistMode }),
    [tables, casts, store.rotationOrder, store.assistMode],
  );
  // 回す順番（初回ローテの采配順）と初回ピックアップ
  const rotationQueue = useMemo(() => orderedRotationQueue(store.rotationOrder, casts), [store.rotationOrder, casts]);
  const pickups = useMemo(() => firstVisitPickupSet(tables), [tables]);
  const selected = tables.find((t) => t.id === selectedTableId) ?? null;

  if (store.loading) return <Shell><div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div></Shell>;
  if (!store.shopId) {
    return (
      <Shell>
        <Empty>
          席回しは店舗運営機能です。<Link href="/store/new" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗を登録</Link> すると解放されます。
        </Empty>
      </Shell>
    );
  }
  if (tables.length === 0) {
    return (
      <Shell device={store.isDevice}>
        <Empty>
          <p style={{ margin: '0 0 12px' }}>フロアの卓が未設定です。</p>
          {store.canManage ? (
            <button type="button" className="noxa-btn noxa-btn-primary" style={primaryBtn} onClick={() => store.seedTables()}>卓を初期作成する</button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>オーナーが卓を作成すると表示されます。</span>
          )}
        </Empty>
      </Shell>
    );
  }

  const applyProposal = async (p: typeof proposals[number]) => {
    if (!p.targetTableId) return;
    if (p.type === 'ROTATION') { await store.rotateHosts(p.targetTableId); return; }
    if (p.type === 'ASSIGN') { for (const cid of p.castIds ?? []) await store.assignCast(p.targetTableId, cid); }
  };

  // AI 席回し: 盤面＋要望をサーバへ送り、返ってきた提案を純ロジックで検証して表示
  const askAi = async () => {
    if (!store.shopId || aiBusy) return;
    // 初回利用時の同意（Day13・docs/ai-privacy-policy.md の文言。端末単位で記録）
    try {
      const CONSENT_KEY = 'noxa-ai-consent-v1';
      if (!window.localStorage.getItem(CONSENT_KEY)) {
        if (!window.confirm(`${AI_CONSENT_TEXT}\n\n続行しますか？`)) return;
        window.localStorage.setItem(CONSENT_KEY, new Date().toISOString());
      }
    } catch { /* localStorage 不可（プライベートモード等）でも続行は妨げない */ }
    setAiBusy(true); setAiError(null); setAiPlan(null); setAiNote('');
    try {
      const nowMs = Date.now();
      const payload = {
        workspaceId: store.shopId,
        requestText: aiText.trim() || undefined,
        settings: { setTimeLength: cfg.config.setTimeLength, rotationTimeLength: cfg.config.rotationTimeLength },
        tables: tables.map((t) => ({
          id: t.id, name: t.name, type: t.type, status: t.status,
          guests: t.customers.length,
          elapsedMin: t.startTime ? Math.floor((nowMs - t.startTime) / 60000) : 0,
          currentHosts: t.currentHostIds.map((cid) => {
            const c = castById.get(cid);
            return { id: cid, name: c?.name ?? '?', rank: c?.rank ?? '?', main: t.mainHostIds.includes(cid), sinceMin: t.castStartTimes?.[cid] ? Math.floor((nowMs - t.castStartTimes[cid]) / 60000) : 0 };
          }),
          requested: (t.requestedHostIds ?? []).map((id) => castById.get(id)?.name ?? id),
          excluded: (t.excludedHostIds ?? []).map((id) => castById.get(id)?.name ?? id),
        })),
        casts: casts.map((c) => ({
          id: c.id, name: c.name, rank: c.rank, status: c.status, isLocked: c.isLocked,
          ...(c.ngCastIds?.length ? { ngWith: c.ngCastIds.map((id) => castById.get(id)?.name ?? id) } : {}),
        })),
      };
      const token = await user.getIdToken();
      const res = await fetch('/api/ai/seating-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setAiError(typeof data.error === 'string' ? data.error : `AI提案に失敗しました（${res.status}）`);
        return;
      }
      const plan = sanitizeAiPlan(data.proposals, casts, tables);
      setAiPlan(plan);
      setAiNote(typeof data.note === 'string' ? data.note : '');
      if (plan.length === 0) setAiError('適用できる提案がありませんでした（制約違反の提案は自動で除外しています）。要望を変えてもう一度どうぞ。');
    } catch (e) {
      setAiError(String((e as Error)?.message ?? e));
    } finally { setAiBusy(false); }
  };

  // 退店（アンドゥ付き）: リセット前スナップショットを60秒保持
  const resetWithUndo = async (t: FloorTable) => {
    try {
      const snapshot = await store.resetTable(t.id);
      if (snapshot) setUndo({ tableId: t.id, name: t.name, snapshot, until: Date.now() + 60_000 });
    } catch (e) {
      window.alert(String((e as Error)?.message ?? e));
    }
  };
  const undoReset = async () => {
    if (!undo) return;
    try {
      await store.restoreTable(undo.tableId, undo.snapshot);
      setUndo(null);
    } catch (e) {
      window.alert(String((e as Error)?.message ?? e));
    }
  };

  const applyAiPlanItem = async (p: AiPlanItem) => {
    try {
      if (p.action === 'rotate') await store.rotateHosts(p.tableId);
      else for (const cid of p.castIds) await store.assignCast(p.tableId, cid);
      setAiPlan((prev) => (prev ? prev.filter((x) => x !== p) : prev));
    } catch (e) {
      window.alert(String((e as Error)?.message ?? e));
    }
  };

  return (
    <Shell device={store.isDevice}>
      {/* 購読エラーの可視化（権限/接続エラーで空表示のまま成功と区別がつかない問題） */}
      {store.dataError && (
        <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{store.dataError}</p>
      )}
      {/* 新規案内の着信（客用タブレットのパネル指名 → リアルタイム反映） */}
      {(() => {
        const fresh = incoming.filter((o) => !seenOrders.has(o.id) && o.atMs > now - 15 * 60 * 1000).slice(0, 3);
        if (fresh.length === 0) return null;
        return (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fresh.map((o) => (
              <div key={o.id} role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(123,232,161,0.08)', border: '1px solid rgba(123,232,161,0.35)' }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--noxa-status-success)', boxShadow: '0 0 8px var(--noxa-status-success)', flex: 'none' }} />
                <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                  <b>新規案内</b>：{o.seat || '席未選択'} — 指名 {o.castNames.length > 0 ? o.castNames.join('・') : 'なし'}
                  {o.customerName ? `（${o.customerName}様）` : ''}
                  <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginLeft: 8 }}>{o.atMs ? `${Math.max(0, Math.floor((now - o.atMs) / 60000))}分前` : ''}</span>
                </span>
                {o.tableId && <button type="button" onClick={() => setSelectedTableId(o.tableId)} style={{ ...chipStyle(false), minHeight: 30 }}>卓を見る</button>}
                <button type="button" title="確認済みにする" onClick={() => setSeenOrders((prev) => new Set(prev).add(o.id))} style={{ ...chipStyle(false), minHeight: 30 }}>✓</button>
              </div>
            ))}
          </div>
        );
      })()}
      {/* 采配モード（計算エンジンの重み付け・店舗共有） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={miniLabel}>采配モード</span>
        {(['balanced', 'nomination', 'rookie'] as AssistMode[]).map((m) => (
          <button key={m} type="button" onClick={() => store.setAssistMode(m)} style={{ ...chipStyle(store.assistMode === m), minHeight: 28, padding: '4px 12px', fontSize: 12 }}>{ASSIST_MODE_LABEL[m]}</button>
        ))}
        <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-faint)' }}>
          {store.assistMode === 'balanced' ? '回す順番を重視して公平に回す' : store.assistMode === 'nomination' ? '指名/PUを最優先で付ける' : '役職×新人の育成ペアを優先'}
        </span>
      </div>

      {/* 自動提案（設定ベース・純ロジック・無料） */}
      {proposals.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {proposals.slice(0, 4).map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(139,92,246,0.08)', border: '1px solid var(--noxa-border-strong)' }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--noxa-text-primary)', minWidth: 0 }}>
                {p.message}
                {p.reason && <span style={{ display: 'block', fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-faint)', marginTop: 2 }}>{p.reason}</span>}
              </span>
              <button type="button" onClick={() => applyProposal(p)} style={{ ...chipStyle(true), minHeight: 30 }}>適用</button>
            </div>
          ))}
        </div>
      )}

      {/* AI 席回し（要望ベース・理由つきカード→ワンタップ適用） */}
      <section aria-label="AI席回し" style={{ marginBottom: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" onClick={() => setAiOpen((v) => !v)}
          style={{ appearance: 'none', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--noxa-text-primary)', display: 'flex', alignItems: 'center', gap: 8, padding: 0, textAlign: 'left' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>✨ AI 席回し</span>
          <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-faint)', flex: 1 }}>要望を伝えると盤面を見て配置を提案（クレジット消費）</span>
          <span aria-hidden style={{ color: 'var(--noxa-text-faint)' }}>{aiOpen ? '▲' : '▼'}</span>
        </button>
        {aiOpen && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={2}
                placeholder="例：3番卓は盛り上げ役を厚めに / 新人を指名客の隣で経験させたい（空欄なら盤面全体の最適化）"
                style={{ ...fieldStyle, flex: '1 1 260px', resize: 'vertical', fontSize: 13 }} />
              <button type="button" onClick={askAi} disabled={aiBusy} className="noxa-btn noxa-btn-primary"
                style={{ ...primaryBtn, width: 'auto', padding: '0 18px', alignSelf: 'flex-end', opacity: aiBusy ? 0.6 : 1 }}>
                {aiBusy ? '考え中…' : 'AIに提案してもらう'}
              </button>
            </div>
            {aiError && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--noxa-status-error)' }}>{aiError}</p>}
            {aiNote && <p style={{ margin: 0, fontSize: 12, color: 'var(--noxa-text-muted)' }}>{aiNote}</p>}
            {(aiPlan?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {aiPlan!.map((p, i) => {
                  const t = tables.find((x) => x.id === p.tableId);
                  const names = p.castIds.map((id) => castById.get(id)?.name ?? '?').join('・');
                  return (
                    <div key={`${p.tableId}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(139,92,246,0.06)', border: '1px solid var(--noxa-border-strong)' }}>
                      <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                        <b>{t?.name ?? p.tableId}</b>：{p.action === 'rotate' ? '席内ローテ' : `${names} を配置`}
                        {p.reason && <span style={{ display: 'block', fontSize: 11, color: 'var(--noxa-text-muted)', marginTop: 2 }}>{p.reason}</span>}
                      </span>
                      <button type="button" onClick={() => applyAiPlanItem(p)} style={{ ...chipStyle(true), minHeight: 30 }}>適用</button>
                      <button type="button" title="見送る" onClick={() => setAiPlan((prev) => prev ? prev.filter((x) => x !== p) : prev)} style={{ ...chipStyle(false), minHeight: 30 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {/* 要対応アラート（会計 / セット残り10分以下 / ローテ督促） */}
      {(() => {
        const alerts = tables.filter((t) => t.status === 'CHECK' || setTimer(t)?.warning || rotationTimer(t)?.due);
        if (alerts.length === 0) return null;
        return (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {alerts.map((t) => {
              const tm = setTimer(t);
              const rot = rotationTimer(t);
              const check = t.status === 'CHECK';
              const danger = check || tm?.warning;
              const label = check ? '会計' : tm?.warning ? `残${tm.remainingMin}分` : `🔄ローテ`;
              return (
                <button key={t.id} type="button" onClick={() => { setSelectedTableId(t.id); if (check) setPosFor(t.id); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 9999, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: danger ? (check ? 'rgba(196,56,74,0.12)' : 'rgba(245,212,114,0.12)') : 'rgba(139,92,246,0.12)',
                    border: `1px solid ${danger ? (check ? 'var(--noxa-status-error)' : 'var(--noxa-status-warning)') : 'var(--noxa-accent-primary)'}`,
                    color: danger ? (check ? 'var(--noxa-status-error)' : 'var(--noxa-status-warning)') : 'var(--noxa-accent-primary-ink)' }}>
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />
                  {t.name}：{label}{rot && !danger ? `（残${rot.remainingMin}分）` : ''}
                </button>
              );
            })}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]" style={{ gap: 'clamp(12px,1.6vw,18px)', alignItems: 'start' }}>
        {/* 左：フロア + 卓詳細 */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-label="フロア">
            <PaneTitle>フロア</PaneTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>
              {tables.map((t) => (
                <TableCard key={t.id} table={t} castById={castById} posConfig={posConfig} active={t.id === selectedTableId}
                  onSelect={() => setSelectedTableId(t.id)}
                  onOpenPos={() => { setSelectedTableId(t.id); setPosFor(t.id); }} />
              ))}
            </div>
          </section>

          {selected && (
            <TableDetail
              table={selected}
              casts={casts}
              tables={tables}
              castById={castById}
              store={store}
              onOpenPos={() => setPosFor(selected.id)}
              onReset={() => resetWithUndo(selected)}
            />
          )}
        </div>

        {/* 右：回す順番（常設）＋ キャスト / 待機列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RotationQueuePanel
            queue={rotationQueue}
            pickups={pickups}
            onMove={(id, dir) => store.setRotationOrder(moveInOrder(rotationQueue.map((c) => c.id), id, dir))}
          />
          <div role="tablist" style={{ display: 'flex', gap: 6 }}>
            <button type="button" role="tab" aria-selected={side === 'casts'} onClick={() => setSide('casts')} style={chipStyle(side === 'casts')}>在籍キャスト</button>
            <button type="button" role="tab" aria-selected={side === 'queue'} onClick={() => setSide('queue')} style={chipStyle(side === 'queue')}>待ち組 {queue.length > 0 ? `(${queue.length})` : ''}</button>
          </div>
          {side === 'casts'
            ? <CastRoster casts={casts} store={store} wageFor={wageFor} castLabel={cfg.t('cast')} pickups={pickups} />
            : <QueuePanel queue={queue} tables={tables} store={store} />}
        </div>
      </div>

      {/* 伝票・会計（POSをこの卓に絞って埋め込み＝フロアから会計まで1画面で完結） */}
      {posFor && (() => {
        const t = tables.find((x) => x.id === posFor);
        if (!t) return null;
        return (
          <div role="dialog" aria-label="伝票・会計" onClick={() => setPosFor(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1100px, 96vw)', marginTop: 8, marginBottom: 24, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 18, fontWeight: 700 }}>{t.name} の伝票・会計</span>
                <button type="button" onClick={() => setPosFor(null)} style={chipStyle(false)}>閉じる ✕</button>
              </div>
              <PosClient user={user} focusTableId={t.id} embedded />
            </div>
          </div>
        );
      })()}

      {/* 退店アンドゥのトースト（60秒） */}
      {undo && now < undo.until && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 80,
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 12,
          background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border-strong)', boxShadow: 'var(--noxa-glow-soft)' }}>
          <span style={{ fontSize: 13 }}>{undo.name} を退店処理しました</span>
          <button type="button" onClick={undoReset} style={{ ...chipStyle(true), minHeight: 30 }}>↩ 元に戻す</button>
          <button type="button" onClick={() => setUndo(null)} style={{ appearance: 'none', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--noxa-text-faint)', fontSize: 15 }}>×</button>
        </div>
      )}
    </Shell>
  );
}

// ───────────────────────── 卓カード

function TableCard({ table, castById, posConfig, active, onSelect, onOpenPos }: {
  table: FloorTable; castById: Map<string, Cast>; posConfig: StoreConfig; active: boolean;
  onSelect: () => void; onOpenPos: () => void;
}) {
  const occupied = table.status !== 'EMPTY';
  const timer = setTimer(table);
  const isCheck = table.status === 'CHECK';
  const slipSum = occupied ? summarizeSlips(table, posConfig) : null;
  // 状態色: 会計=赤 / 残10分以下=黄 / 接客中=紫 / 空席=灰
  const statusColor = isCheck ? 'var(--noxa-status-error)'
    : timer?.warning ? 'var(--noxa-status-warning)'
    : occupied ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)';
  const barColor = timer?.warning ? 'var(--noxa-status-warning)' : 'var(--noxa-accent-primary)';
  const guestName = table.customers.find((c) => c.name)?.name;
  return (
    // 会計ボタンを内包するため button のネストを避けて div+role にする
    <div role="button" tabIndex={0} onClick={onSelect} aria-pressed={active}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      style={{
        cursor: 'pointer', textAlign: 'left', minHeight: 116, padding: 12, borderRadius: 14,
        background: occupied ? 'var(--noxa-surface-card)' : 'transparent',
        border: active ? '1px solid var(--noxa-accent-primary)' : `1px solid ${isCheck ? 'var(--noxa-status-error)' : occupied ? 'var(--noxa-border-strong)' : 'var(--noxa-border)'}`,
        boxShadow: active ? 'var(--noxa-glow-ring)' : (timer?.warning || isCheck ? `0 0 0 1px ${statusColor}` : 'none'),
        color: 'var(--noxa-text-primary)', display: 'flex', flexDirection: 'column', gap: 7,
        transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16, fontWeight: 600 }}>{table.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {table.type && occupied && <span style={{ fontSize: 10, fontFamily: mono, color: table.type.startsWith('初回') ? 'var(--noxa-status-success)' : 'var(--noxa-text-muted)' }}>{table.type}</span>}
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, boxShadow: occupied ? `0 0 8px ${statusColor}` : 'none' }} />
        </span>
      </div>
      {occupied ? (
        <>
          {/* 残り時間 / 会計 */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            {isCheck ? (
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--noxa-status-error)', fontFamily: 'var(--noxa-font-display-jp)' }}>会計</span>
            ) : timer ? (
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: timer.warning ? 'var(--noxa-status-warning)' : 'var(--noxa-text-primary)' }}>残{timer.remainingMin}</span>
                <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', fontFamily: mono }}>分 · {timer.setNumber}set</span>
              </span>
            ) : <span style={{ fontSize: 12, fontFamily: mono, color: 'var(--noxa-text-muted)' }}>{fmtElapsed(table.startTime)}</span>}
            <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-faint)' }}>{guestName ? `${guestName} · ` : ''}{table.customers.length}名 · 計{fmtElapsed(table.startTime)}</span>
          </div>
          {/* セット進捗バー */}
          {timer && (
            <div style={{ height: 4, borderRadius: 9999, background: 'var(--noxa-surface-muted)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(timer.progress * 100)}%`, height: '100%', borderRadius: 9999, background: barColor, transition: 'width .4s var(--noxa-ease-natural)' }} />
            </div>
          )}
          {/* 伝票サマリ（現在金額・点数）＋ 会計直行。伝票なしなら作成導線 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            {slipSum ? (
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: isCheck ? 'var(--noxa-status-error)' : 'var(--noxa-text-primary)' }}>{yen(slipSum.total)}</span>
                <span style={{ fontSize: 9, fontFamily: mono, color: 'var(--noxa-text-faint)', whiteSpace: 'nowrap' }}>{slipSum.count}伝票 · {slipSum.itemCount}点</span>
              </span>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', fontFamily: mono }}>伝票なし</span>
            )}
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPos(); }}
              style={{ appearance: 'none', cursor: 'pointer', flex: 'none', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 9999,
                background: isCheck ? 'rgba(196,56,74,0.12)' : 'var(--noxa-surface-muted)',
                border: `1px solid ${isCheck ? 'var(--noxa-status-error)' : 'var(--noxa-border-strong)'}`,
                color: isCheck ? 'var(--noxa-status-error)' : 'var(--noxa-accent-primary-ink)' }}>
              🧾 {isCheck ? '会計する' : '伝票'}
            </button>
          </div>
          {/* 担当（伝票の指名）: 卓キャストと別に伝票側の担当を明示 */}
          {slipSum && slipSum.castNames.length > 0 && (
            <span style={{ fontSize: 9, fontFamily: mono, color: 'var(--noxa-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>担当: {slipSum.castNames.join(' / ')}{slipSum.customerNames.length > 0 ? ` ｜ ${slipSum.customerNames.join(' / ')}` : ''}</span>
          )}
          {/* 卓内ローテ残り（自動ローテON時） */}
          {(() => { const r = rotationTimer(table); return r ? <span style={{ fontSize: 10, fontFamily: mono, color: r.due ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)' }}>🔄 ローテ残{r.remainingMin}分{r.due ? '・そろそろ' : ''}</span> : null; })()}
          {/* キャスト chip（★本指名 / 現着）＋ 指名待ち */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {table.currentHostIds.map((cid) => {
              const c = castById.get(cid);
              const isMain = table.mainHostIds.includes(cid);
              return <span key={cid} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 9999, background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-primary)', border: isMain ? '1px solid var(--noxa-accent-primary)' : '1px solid transparent' }}>{isMain ? '★' : ''}{c?.name ?? '?'}</span>;
            })}
            {(table.requestedHostIds ?? []).filter((id) => !table.currentHostIds.includes(id)).map((cid) => {
              const c = castById.get(cid);
              return <span key={`req-${cid}`} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 9999, background: 'transparent', color: 'var(--noxa-status-info)', border: '1px dashed var(--noxa-status-info)' }}>待{c?.name ?? '?'}</span>;
            })}
            {table.currentHostIds.length === 0 && <span style={{ fontSize: 10, color: 'var(--noxa-status-warning)', fontFamily: mono }}>キャスト未配置</span>}
          </div>
        </>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)', fontFamily: mono, marginTop: 'auto' }}>空席</span>
      )}
    </div>
  );
}

// ───────────────────────── 卓詳細

function TableDetail({ table, casts, tables, castById, store, onOpenPos, onReset }: {
  table: FloorTable; casts: Cast[]; tables: FloorTable[]; castById: Map<string, Cast>;
  store: ReturnType<typeof useSeatingStore>;
  onOpenPos: () => void;
  onReset: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [openGuests, setOpenGuests] = useState(2);
  const [openType, setOpenType] = useState<TableType>('正規');

  const candidates = useMemo(() => getSourcingCandidates(casts, tables, table)
    .filter((c) => !table.currentHostIds.includes(c.cast.id)), [casts, tables, table]);

  const startSet = async () => {
    const now = Date.now();
    const customers: Customer[] = Array.from({ length: Math.max(1, openGuests) }, (_, i) => ({ id: `cust_${now}_${i}`, type: openType, entryTime: now }));
    try {
      await store.startSet(table.id, customers);
    } catch (e) {
      // 使用中卓への二重開卓ガード等を可視化（握りつぶすと「押しても無反応」に見える）
      window.alert(String((e as Error)?.message ?? e));
    }
  };

  return (
    <section aria-label="卓詳細" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 20, fontWeight: 600 }}>{table.name}</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)' }}>
          {table.status === 'EMPTY' ? '空席' : `${table.type} · ${fmtElapsed(table.startTime)}経過 · ${table.customers.length}名`}
          {table.entryNumber ? ` · #${table.entryNumber}` : ''}
        </span>
      </div>

      {table.status === 'EMPTY' ? (
        // 開卓フォーム
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={miniLabel}>客層</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {TABLE_TYPES.map((t) => <button key={t} type="button" onClick={() => setOpenType(t)} style={chipStyle(openType === t)}>{t}</button>)}
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 90 }}>
            <span style={miniLabel}>人数</span>
            <input type="number" min={1} value={openGuests} onChange={(e) => setOpenGuests(Math.max(1, Number(e.target.value)))} style={fieldStyle} inputMode="numeric" />
          </label>
          <button type="button" className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, width: 'auto', padding: '0 20px' }} onClick={startSet}>開卓する</button>
        </div>
      ) : (
        <>
          {/* 配置キャスト */}
          <div>
            <div style={{ ...miniLabel, marginBottom: 8 }}>配置キャスト（★=本指名）</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {table.currentHostIds.map((cid) => {
                const c = castById.get(cid);
                const isMain = table.mainHostIds.includes(cid);
                return (
                  <span key={cid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 6px 4px 10px', borderRadius: 9999, background: 'var(--noxa-surface-muted)', border: isMain ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)' }}>
                    <button type="button" title="本指名" onClick={() => store.toggleMainHost(table.id, cid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isMain ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', fontSize: 13 }}>★</button>
                    <span style={{ fontSize: 12 }}>{c?.name ?? '?'}</span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--noxa-text-faint)' }}>{fmtElapsed(table.castStartTimes[cid] ?? null)}</span>
                    <button type="button" title="外す" onClick={() => store.removeCastFromTable(table.id, cid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 14, paddingLeft: 2 }}>×</button>
                  </span>
                );
              })}
              <button type="button" onClick={() => setShowPicker((v) => !v)} style={{ ...chipStyle(false), borderStyle: 'dashed', color: 'var(--noxa-accent-primary-ink)' }}>＋ 配置</button>
            </div>
          </div>

          {/* キャストピッカー */}
          {showPicker && (
            <div style={{ border: '1px solid var(--noxa-border)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {candidates.length === 0 && <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>配置可能なキャストがいません。</span>}
              {candidates.map(({ cast, priority }) => (
                <button key={cast.id} type="button" onClick={() => { store.assignCast(table.id, cast.id); }}
                  style={{ appearance: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', textAlign: 'left' }}>
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: RANK_TINT[cast.rank], flex: 'none' }} />
                  <span style={{ fontSize: 13, flex: 1 }}>{cast.name}</span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>{cast.rank}</span>
                  <span style={{ fontFamily: mono, fontSize: 9, padding: '1px 6px', borderRadius: 9999, background: priority === 'S' ? 'rgba(245,212,114,0.15)' : 'var(--noxa-surface-muted)', color: priority === 'S' ? '#F5D472' : 'var(--noxa-text-muted)' }}>{priority === 'S' ? '指名' : priority === 'A' ? '待機' : 'ヘルプ'}</span>
                </button>
              ))}
            </div>
          )}

          {/* 除外中（初回案内で非選択＝回さない。×で解除） */}
          {(table.excludedHostIds?.length ?? 0) > 0 && (
            <div>
              <div style={{ ...miniLabel, marginBottom: 6 }}>除外中（初回案内で選ばれず・ローテ/AI候補から除外）</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(table.excludedHostIds ?? []).map((cid) => {
                  const c = castById.get(cid);
                  return c ? (
                    <span key={cid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 4px 3px 10px', borderRadius: 9999, background: 'transparent', border: '1px dashed var(--noxa-border-strong)', color: 'var(--noxa-text-faint)', fontSize: 11 }}>
                      {c.name}
                      <button type="button" title="除外を解除" onClick={() => store.setCastExcluded(table.id, cid, false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 13 }}>×</button>
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {/* 回し履歴（この来店で誰が何分付いたか） */}
          {(table.sessionLog?.length ?? 0) > 0 && (
            <div>
              <div style={{ ...miniLabel, marginBottom: 6 }}>回し履歴（この来店）</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {[...(table.sessionLog ?? [])].reverse().slice(0, 12).map((e, i) => {
                  const c = castById.get(e.castId);
                  const min = Math.max(1, Math.round((e.end - e.start) / 60000));
                  return (
                    <span key={`${e.castId}-${e.end}-${i}`} style={{ fontSize: 10, fontFamily: mono, padding: '2px 8px', borderRadius: 9999, background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)' }}>
                      {c?.name ?? '?'} · {min}分
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* アクション */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--noxa-divider)', paddingTop: 12 }}>
            <button type="button" onClick={onOpenPos} style={chipStyle(true)}>🧾 伝票・会計を開く</button>
            <button type="button" onClick={() => store.rotateHosts(table.id)} style={chipStyle(false)} disabled={table.currentHostIds.length < 2}>席内ローテ</button>
            <button type="button" onClick={() => store.toggleInnerRotation(table.id)} style={chipStyle(table.innerRotationEnabled)}>自動ローテ提案</button>
            <button type="button" onClick={() => store.extendTime(table.id, 30)} style={chipStyle(false)}>＋30分延長</button>
            <button type="button" onClick={() => store.checkTable(table.id)} style={chipStyle(table.status === 'CHECK')}>会計</button>
            <button type="button" onClick={() => { if (window.confirm(`${table.name} を退店処理（リセット）しますか？（60秒以内なら元に戻せます）`)) onReset(); }} style={{ ...chipStyle(false), color: 'var(--noxa-status-error)', borderColor: 'rgba(229,115,115,0.4)', marginLeft: 'auto' }}>退店</button>
          </div>

          {/* この卓のセット設定（オーナー） */}
          {store.canManage && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={miniLabel}>セット長(分)</span>
                <input key={`s-${table.id}`} type="number" defaultValue={table.setTimeLength} onBlur={(e) => store.updateTableSettings(table.id, { setTimeLength: Number(e.target.value) })} style={{ ...fieldStyle, width: 90 }} inputMode="numeric" /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={miniLabel}>ローテ間隔(分)</span>
                <input key={`r-${table.id}`} type="number" defaultValue={table.rotationTimeLength} onBlur={(e) => store.updateTableSettings(table.id, { rotationTimeLength: Number(e.target.value) })} style={{ ...fieldStyle, width: 90 }} inputMode="numeric" /></label>
              <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)' }}>この卓の設定（入力後フォーカスを外すと保存）</span>
            </div>
          )}
        </>
      )}

    </section>
  );
}

// ───────────────────────── 回す順番（初回ローテの采配キュー・常設）

function RotationQueuePanel({ queue, pickups, onMove }: { queue: Cast[]; pickups: Set<string>; onMove: (castId: string, dir: -1 | 1) => void }) {
  return (
    <section aria-label="回す順番" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="noxa-eyebrow" style={{ fontSize: 11 }}>回す順番（待機中）</span>
        {queue.length > 0 && <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>{queue.length}人</span>}
      </div>
      {queue.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>待機中のキャストがいません（卓に付くと自動で最後尾に回ります）。</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
          {queue.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 10,
              background: i === 0 ? 'rgba(139,92,246,0.10)' : 'var(--noxa-bg-base)',
              border: i === 0 ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)' }}>
              <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: 'center', color: i === 0 ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)' }}>{i + 1}</span>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: RANK_TINT[c.rank], flex: 'none' }} />
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
                {i === 0 && <span style={{ fontSize: 9, color: 'var(--noxa-accent-primary-ink)', marginLeft: 5, fontWeight: 600 }}>次</span>}
                {pickups.has(c.id) && <span title="初回ピックアップに選ばれています" style={{ fontSize: 9, fontWeight: 700, color: 'var(--noxa-status-success)', marginLeft: 5 }}>PU</span>}
              </span>
              <button type="button" title="上へ" disabled={i === 0} onClick={() => onMove(c.id, -1)} style={{ ...rotBtn, opacity: i === 0 ? 0.3 : 1 }}>↑</button>
              <button type="button" title="下へ" disabled={i === queue.length - 1} onClick={() => onMove(c.id, 1)} style={{ ...rotBtn, opacity: i === queue.length - 1 ? 0.3 : 1 }}>↓</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const rotBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', width: 26, height: 26, borderRadius: 8, flex: 'none', background: 'var(--noxa-surface-muted)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

// ───────────────────────── キャスト名簿

function CastRoster({ casts, store, wageFor, castLabel = 'キャスト', pickups }: { casts: Cast[]; store: ReturnType<typeof useSeatingStore>; wageFor?: (rank: string) => number | undefined; castLabel?: string; pickups?: Set<string> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [rank, setRank] = useState<Rank>('非役職');
  const [wage, setWage] = useState(5000);
  const [editing, setEditing] = useState<Cast | null>(null);
  const selectRank = (r: Rank) => { setRank(r); const w = wageFor?.(r); if (typeof w === 'number') setWage(w); };

  const cycleStatus = (c: Cast) => {
    // 在卓中は卓から外すまで変更不可。Free<->Break<->Absent を循環
    if (c.status === 'Work') return;
    const next = c.status === 'Free' ? 'Break' : c.status === 'Break' ? 'Absent' : 'Free';
    store.setCastBaseStatus(c.id, next);
  };

  const sorted = [...casts].sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));

  return (
    <section aria-label={`在籍${castLabel}`} style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
        {sorted.length === 0 && <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>{castLabel}が未登録です。</span>}
        {sorted.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', opacity: c.status === 'Absent' ? 0.5 : 1 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: RANK_TINT[c.rank], flex: 'none' }} />
            <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}
              <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>{c.rank}</span>
              {pickups?.has(c.id) && <span title="初回ピックアップに選ばれています" style={{ fontSize: 9, fontWeight: 700, color: 'var(--noxa-status-success)', marginLeft: 4 }}>PU</span>}
              {!c.uid && <span title="アカウント未連携（給与計算に乗りません）" style={{ fontSize: 9, color: 'var(--noxa-status-error)', marginLeft: 4 }}>未連携</span>}
            </span>
            <button type="button" onClick={() => setEditing(c)} title="編集（時給・アカウント連携）" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 12 }}>✎</button>
            <button type="button" onClick={() => cycleStatus(c)} title="状態切替" style={{ ...chipStyle(c.status === 'Work'), minHeight: 26, padding: '2px 8px', fontSize: 11, cursor: c.status === 'Work' ? 'default' : 'pointer' }}>{STATUS_LABEL[c.status]}</button>
            <button type="button" onClick={() => store.toggleLock(c.id)} title="ロック（AI除外）" style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.isLocked ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', fontSize: 13 }}>{c.isLocked ? '🔒' : '🔓'}</button>
          </div>
        ))}
      </div>

      {editing && <CastEditor cast={editing} allCasts={casts} store={store} onClose={() => setEditing(null)} />}

      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" style={fieldStyle} />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {RANKS.map((r) => <button key={r} type="button" onClick={() => selectRank(r)} style={chipStyle(rank === r)}>{r}</button>)}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={miniLabel}>時給</span>
            <input type="number" value={wage} onChange={(e) => setWage(Number(e.target.value))} style={fieldStyle} inputMode="numeric" />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, flex: 1 }} disabled={!name.trim()}
              onClick={async () => { await store.addCast({ name: name.trim(), rank, hourlyWage: wage }); setName(''); setAdding(false); }}>追加</button>
            <button type="button" onClick={() => setAdding(false)} style={{ ...ghostBtn, width: 72 }}>戻る</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setAdding(true)} style={{ ...chipStyle(false), borderStyle: 'dashed' }}>＋ キャスト追加</button>
          {store.canManage && (
            <button type="button"
              onClick={() => { if (window.confirm('テスト用のキャスト15名＋顧客24名（キャスト別売上付き）を投入しますか？')) store.seedTestData(); }}
              style={{ ...chipStyle(false), borderStyle: 'dashed', color: 'var(--noxa-text-faint)' }}>テストデータ投入</button>
          )}
          {store.canManage && (
            <button type="button"
              onClick={() => { if (window.confirm('シード（テスト）キャストを削除し、全卓を空席に戻します。よろしいですか？')) store.clearSeedData(); }}
              style={{ ...chipStyle(false), borderStyle: 'dashed', color: 'var(--noxa-status-error)' }}>テストデータ削除</button>
          )}
        </div>
      )}
    </section>
  );
}

// ───────────────────────── 待機列

function QueuePanel({ queue, tables, store }: { queue: import('@/lib/seating/types').QueueItem[]; tables: FloorTable[]; store: ReturnType<typeof useSeatingStore> }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(2);
  const [type, setType] = useState<TableType>('正規');
  const [seatFor, setSeatFor] = useState<string | null>(null);
  const emptyTables = tables.filter((t) => t.status === 'EMPTY');

  return (
    <section aria-label="待ち組" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
        {queue.length === 0 && <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>待ち組はいません。</span>}
        {queue.map((q) => (
          <div key={q.id} style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, flex: 1 }}>{q.name}<span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>{q.type} · {q.groupSize}名</span></span>
              <button type="button" onClick={() => store.removeFromQueue(q.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 14 }}>×</button>
            </div>
            {seatFor === q.id ? (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {emptyTables.length === 0 && <span style={{ fontSize: 11, color: 'var(--noxa-status-warning)' }}>空卓なし</span>}
                {emptyTables.map((t) => (
                  <button key={t.id} type="button" onClick={() => { store.seatQueueGroup(t.id, q).catch((e) => window.alert(String((e as Error)?.message ?? e))); setSeatFor(null); }} style={chipStyle(false)}>{t.name}</button>
                ))}
              </div>
            ) : (
              <button type="button" onClick={() => setSeatFor(q.id)} style={{ ...chipStyle(true), minHeight: 28, alignSelf: 'flex-start' }}>卓へ案内</button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前 / 組名" style={fieldStyle} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
            {TABLE_TYPES.map((t) => <button key={t} type="button" onClick={() => setType(t)} style={chipStyle(type === t)}>{t}</button>)}
          </div>
          <input type="number" min={1} value={size} onChange={(e) => setSize(Math.max(1, Number(e.target.value)))} style={{ ...fieldStyle, width: 64 }} inputMode="numeric" />
        </div>
        <button type="button" className="noxa-btn noxa-btn-primary" style={primaryBtn} disabled={!name.trim()}
          onClick={async () => { await store.addToQueue({ name: name.trim(), groupSize: size, type }); setName(''); }}>待ち組に追加</button>
      </div>
    </section>
  );
}

// ───────────────────────── 共通

function Shell({ children, device }: { children: React.ReactNode; device?: boolean }) {
  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.12) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li>
            <li aria-hidden>·</li>
            <li>seating</li>
          </ol>
        </nav>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>ノクサ · 席回し</div>
            <h1 className="noxa-display" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontStyle: 'italic', color: 'var(--noxa-accent-primary-ink)', fontWeight: 400 }}>№ 03</span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>席回し</span>
            </h1>
          </div>
          <div role="note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)', boxShadow: '0 0 8px var(--noxa-status-success)' }} />
            {device ? '店舗端末 · 実データ' : '実データ · AI配置'}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function PaneTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12, display: 'block' }}>{children}</h2>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 24, color: 'var(--noxa-text-muted)', fontSize: 13 }}>{children}</div>;
}

const miniLabel: React.CSSProperties = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' };

function chipStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', minHeight: 34, padding: '6px 14px', borderRadius: 9999,
    fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)',
    color: active ? '#fff' : 'var(--noxa-text-muted)',
    border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
    boxShadow: active ? 'var(--noxa-glow-soft)' : 'none',
    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
  };
}
const fieldStyle: React.CSSProperties = {
  width: '100%', minHeight: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)',
  border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16,
};
const primaryBtn: React.CSSProperties = {
  appearance: 'none', cursor: 'pointer', width: '100%', minHeight: 44, borderRadius: 12,
  border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff',
  fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 14, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)',
};
const ghostBtn: React.CSSProperties = {
  appearance: 'none', cursor: 'pointer', minHeight: 40, borderRadius: 12,
  border: '1px solid var(--noxa-border-strong)', background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)',
  fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: 500,
};

// ───────────────────────── キャスト編集（時給・rank・アカウント連携）

function CastEditor({ cast, allCasts, store, onClose }: { cast: Cast; allCasts: Cast[]; store: ReturnType<typeof useSeatingStore>; onClose: () => void }) {
  const [name, setName] = useState(cast.name);
  const [rank, setRank] = useState<Rank>(cast.rank);
  const [wage, setWage] = useState(cast.hourlyWage);
  const [uid, setUid] = useState<string>(cast.uid ?? '');
  const [ngIds, setNgIds] = useState<string[]>(() => cast.ngCastIds ?? []);
  const [members, setMembers] = useState<{ uid: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const others = allCasts.filter((c) => c.id !== cast.id);

  // 店舗メンバー（人間のみ）を連携候補として購読
  useEffect(() => {
    if (!store.shopId) return;
    const unsub = onSnapshot(collection(db, `shop_shops/${store.shopId}/members`), (snap) => {
      const list: { uid: string; label: string }[] = [];
      snap.forEach((d) => {
        const m = d.data() as { role?: string; castDisplayName?: string; kind?: string };
        if (m.kind === 'device') return;
        list.push({ uid: d.id, label: `${m.castDisplayName || d.id.slice(0, 8)}（${m.role ?? '?'}）` });
      });
      setMembers(list);
    }, () => { /* 権限なしは連携候補なし表示 */ });
    return () => unsub();
  }, [store.shopId]);

  const save = async () => {
    setBusy(true);
    try {
      await store.updateCast(cast.id, { name: name.trim() || cast.name, rank, hourlyWage: Math.max(0, wage), uid: uid || null, ngCastIds: ngIds });
      onClose();
    } catch (e) {
      window.alert(String((e as Error)?.message ?? e));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`${cast.name} を名簿から削除しますか？`)) return;
    setBusy(true);
    try { await store.removeCast(cast.id); onClose(); } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16 }}>キャスト編集</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" style={fieldStyle} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {RANKS.map((r) => <button key={r} type="button" onClick={() => setRank(r)} style={chipStyle(rank === r)}>{r}</button>)}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={miniLabel}>時給</span>
          <input type="number" value={wage} onChange={(e) => setWage(Number(e.target.value))} style={fieldStyle} inputMode="numeric" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={miniLabel}>アカウント連携（給与・個人売上の帰属先）</span>
          <select value={uid} onChange={(e) => setUid(e.target.value)} style={{ ...fieldStyle, width: '100%' }}>
            <option value="">未連携</option>
            {members.map((m) => <option key={m.uid} value={m.uid}>{m.label}</option>)}
          </select>
          <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', lineHeight: 1.5 }}>店舗設定の「メンバーと招待」で招待→参加すると候補に出ます。連携すると勤怠×時給が給与計算に乗ります。</span>
        </label>
        {others.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={miniLabel}>NG 組合せ（同卓に付けない相手）</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 110, overflowY: 'auto' }}>
              {others.map((c) => {
                const on = ngIds.includes(c.id);
                return (
                  <button key={c.id} type="button"
                    onClick={() => setNgIds((prev) => on ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                    style={{ ...chipStyle(on), minHeight: 28, padding: '3px 10px', fontSize: 12,
                      ...(on ? { background: 'rgba(196,56,74,0.15)', borderColor: 'var(--noxa-status-error)', color: 'var(--noxa-status-error)', boxShadow: 'none' } : {}) }}>
                    {on ? '🚫 ' : ''}{c.name}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)' }}>自動提案・AI提案はこの組合せを絶対に出しません（どちらか一方に設定すれば双方向に効きます）。</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, flex: 1 }} disabled={busy} onClick={save}>保存</button>
          <button type="button" onClick={remove} disabled={busy} style={{ ...ghostBtn, width: 64, color: 'var(--noxa-status-error)' }}>削除</button>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, width: 64 }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

export default SeatingClient;
