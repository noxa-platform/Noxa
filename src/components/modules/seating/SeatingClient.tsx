'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { useSeatingStore } from '@/lib/seating/store';
import { useShopConfig } from '@/lib/shopConfig';
import { generateAIProposals, getSourcingCandidates } from '@/lib/seating/ai';
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

function elapsedMin(start: number | null): number {
  if (!start) return 0;
  return Math.floor((Date.now() - start) / 60000);
}
function fmtElapsed(start: number | null): string {
  const m = elapsedMin(start);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// セット残り時間：現在のセット終わりまでの残分・何セット目か・残10分以下の警告
type SetTimer = { remainingMin: number; setNumber: number; setLen: number; warning: boolean; progress: number };
function setTimer(t: FloorTable): SetTimer | null {
  if (t.status !== 'ACTIVE' || !t.startTime || !t.setTimeLength) return null;
  const len = t.setTimeLength;
  const elapsed = elapsedMin(t.startTime);
  const setNumber = Math.floor(elapsed / len) + 1;
  const remainingMin = Math.max(0, setNumber * len - elapsed);
  const progress = Math.min(1, (len - remainingMin) / len);
  return { remainingMin, setNumber, setLen: len, warning: remainingMin <= 10, progress };
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
  const [, setTick] = useState(0);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 15000); return () => clearInterval(t); }, []);

  const castById = useMemo(() => new Map(casts.map((c) => [c.id, c])), [casts]);
  const proposals = useMemo(() => generateAIProposals(tables, casts), [tables, casts]);
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

  return (
    <Shell device={store.isDevice}>
      {/* AI 提案 */}
      {proposals.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {proposals.slice(0, 4).map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(139,92,246,0.08)', border: '1px solid var(--noxa-border-strong)' }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--noxa-text-primary)' }}>{p.message}</span>
              <button type="button" onClick={() => applyProposal(p)} style={{ ...chipStyle(true), minHeight: 30 }}>適用</button>
            </div>
          ))}
        </div>
      )}

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
                <button key={t.id} type="button" onClick={() => setSelectedTableId(t.id)}
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
                <TableCard key={t.id} table={t} castById={castById} active={t.id === selectedTableId} onSelect={() => setSelectedTableId(t.id)} />
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
            />
          )}
        </div>

        {/* 右：キャスト / 待機列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div role="tablist" style={{ display: 'flex', gap: 6 }}>
            <button type="button" role="tab" aria-selected={side === 'casts'} onClick={() => setSide('casts')} style={chipStyle(side === 'casts')}>在籍キャスト</button>
            <button type="button" role="tab" aria-selected={side === 'queue'} onClick={() => setSide('queue')} style={chipStyle(side === 'queue')}>待ち組 {queue.length > 0 ? `(${queue.length})` : ''}</button>
          </div>
          {side === 'casts'
            ? <CastRoster casts={casts} store={store} wageFor={wageFor} castLabel={cfg.t('cast')} />
            : <QueuePanel queue={queue} tables={tables} store={store} />}
        </div>
      </div>
    </Shell>
  );
}

// ───────────────────────── 卓カード

function TableCard({ table, castById, active, onSelect }: { table: FloorTable; castById: Map<string, Cast>; active: boolean; onSelect: () => void }) {
  const occupied = table.status !== 'EMPTY';
  const timer = setTimer(table);
  const isCheck = table.status === 'CHECK';
  // 状態色: 会計=赤 / 残10分以下=黄 / 接客中=紫 / 空席=灰
  const statusColor = isCheck ? 'var(--noxa-status-error)'
    : timer?.warning ? 'var(--noxa-status-warning)'
    : occupied ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)';
  const barColor = timer?.warning ? 'var(--noxa-status-warning)' : 'var(--noxa-accent-primary)';
  return (
    <button type="button" onClick={onSelect} aria-pressed={active}
      style={{
        appearance: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 116, padding: 12, borderRadius: 14,
        background: occupied ? 'var(--noxa-surface-card)' : 'transparent',
        border: active ? '1px solid var(--noxa-accent-primary)' : `1px solid ${isCheck ? 'var(--noxa-status-error)' : occupied ? 'var(--noxa-border-strong)' : 'var(--noxa-border)'}`,
        boxShadow: active ? 'var(--noxa-glow-ring)' : (timer?.warning || isCheck ? `0 0 0 1px ${statusColor}` : 'none'),
        color: 'var(--noxa-text-primary)', display: 'flex', flexDirection: 'column', gap: 7,
        transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16, fontWeight: 600 }}>{table.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {table.type && occupied && <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-muted)' }}>{table.type}</span>}
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
            <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-faint)' }}>{table.customers.length}名 · 計{fmtElapsed(table.startTime)}</span>
          </div>
          {/* セット進捗バー */}
          {timer && (
            <div style={{ height: 4, borderRadius: 9999, background: 'var(--noxa-surface-muted)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(timer.progress * 100)}%`, height: '100%', borderRadius: 9999, background: barColor, transition: 'width .4s var(--noxa-ease-natural)' }} />
            </div>
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
    </button>
  );
}

// ───────────────────────── 卓詳細

function TableDetail({ table, casts, tables, castById, store }: {
  table: FloorTable; casts: Cast[]; tables: FloorTable[]; castById: Map<string, Cast>;
  store: ReturnType<typeof useSeatingStore>;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [openGuests, setOpenGuests] = useState(2);
  const [openType, setOpenType] = useState<TableType>('正規');

  const candidates = useMemo(() => getSourcingCandidates(casts, tables, table)
    .filter((c) => !table.currentHostIds.includes(c.cast.id)), [casts, tables, table]);

  const startSet = async () => {
    const now = Date.now();
    const customers: Customer[] = Array.from({ length: Math.max(1, openGuests) }, (_, i) => ({ id: `cust_${now}_${i}`, type: openType, entryTime: now }));
    await store.startSet(table.id, customers);
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

          {/* アクション */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--noxa-divider)', paddingTop: 12 }}>
            <button type="button" onClick={() => store.rotateHosts(table.id)} style={chipStyle(false)} disabled={table.currentHostIds.length < 2}>席内ローテ</button>
            <button type="button" onClick={() => store.toggleInnerRotation(table.id)} style={chipStyle(table.innerRotationEnabled)}>自動ローテ提案</button>
            <button type="button" onClick={() => store.extendTime(table.id, 30)} style={chipStyle(false)}>＋30分延長</button>
            <button type="button" onClick={() => store.checkTable(table.id)} style={chipStyle(table.status === 'CHECK')}>会計</button>
            <button type="button" onClick={() => { if (window.confirm(`${table.name} を退店処理（リセット）しますか？`)) store.resetTable(table.id); }} style={{ ...chipStyle(false), color: 'var(--noxa-status-error)', borderColor: 'rgba(229,115,115,0.4)', marginLeft: 'auto' }}>退店</button>
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

// ───────────────────────── キャスト名簿

function CastRoster({ casts, store, wageFor, castLabel = 'キャスト' }: { casts: Cast[]; store: ReturnType<typeof useSeatingStore>; wageFor?: (rank: string) => number | undefined; castLabel?: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [rank, setRank] = useState<Rank>('非役職');
  const [wage, setWage] = useState(5000);
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
            <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}<span style={{ fontFamily: mono, fontSize: 9, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>{c.rank}</span></span>
            <button type="button" onClick={() => cycleStatus(c)} title="状態切替" style={{ ...chipStyle(c.status === 'Work'), minHeight: 26, padding: '2px 8px', fontSize: 11, cursor: c.status === 'Work' ? 'default' : 'pointer' }}>{STATUS_LABEL[c.status]}</button>
            <button type="button" onClick={() => store.toggleLock(c.id)} title="ロック（AI除外）" style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.isLocked ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', fontSize: 13 }}>{c.isLocked ? '🔒' : '🔓'}</button>
          </div>
        ))}
      </div>

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
                  <button key={t.id} type="button" onClick={() => { store.seatQueueGroup(t.id, q); setSeatFor(null); }} style={chipStyle(false)}>{t.name}</button>
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
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Module 03 · Floor</div>
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

export default SeatingClient;
