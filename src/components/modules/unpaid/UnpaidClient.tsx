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
import { useShopRole, hasShopRole } from '@/lib/useShopRole';
import { UNPAID_STATUS_OPTIONS, balanceOf, collectPatch, isOverdue as isOverdueAt, statusChangePatch, type UnpaidStatus } from '@/lib/unpaid/logic';
import { describeFirestoreError } from '@/lib/firestore-error';
import { describeMissingShop } from '@/lib/shop-id-state';
import { SALES_EDIT_ROLES, SALES_EDIT_ROLE_LABEL, describeSalesEditDenied } from '@/lib/permission-guidance';

/**
 * 売掛管理モジュール（機微・実データ）
 *
 * shop_shops/{shopId}/unpaid を読み書きする。**owner / manager / accounting** が表示・編集可能
 * （rules の `isShopMemberWithSalesEdit` と一致）。店舗端末・その他のロールには理由と依頼先を出す。
 * 表示文言を「オーナー専用」と書くと、本来開ける店長・経理が諦めるので実態に合わせること（Day114）。
 */

const mono = 'var(--noxa-font-mono)';

type UnpaidRecord = {
  id: string;
  customerName: string;
  amount: number; // 売掛額
  paidAmount: number; // 回収済
  date: string; // YYYY-MM-DD 発生日
  due: string | null; // YYYY-MM-DD 期日
  status: UnpaidStatus;
  memo: string | null;
  source: string | null; // 'pos'=POS会計からの自動起票
  elapsedDays: number; // date からの経過日数（算出）
};

const STATUS_OPTIONS = UNPAID_STATUS_OPTIONS;

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
    source: typeof d.source === 'string' ? d.source : null,
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

/** 期日超過か（純ロジックは lib/unpaid/logic に分離・Day24） */
const isOverdue = (r: UnpaidRecord) => isOverdueAt(r, today());

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
  const shop = useShopRole(user);
  // 出所（path）つきスナップショットから records/loading を導出（set-state-in-effect 返済・Day18）
  const [recordsSnap, setRecordsSnap] = useState<{ path: string; list: UnpaidRecord[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // 追加・削除・ステータス変更・一部回収の失敗（旧実装は catch が無く完全に無音だった）。
  // 売掛は債権なので「記録できたのか分からない」は金銭事故に直結する
  const [opError, setOpError] = useState<string | null>(null);
  // 購読（読み取り）の失敗。0件表示と区別できないと「売掛は無い」と誤読される
  const [readError, setReadError] = useState<string | null>(null);

  // 機微: owner/manager/accounting（rules の isShopMemberWithSalesEdit と一致。店長が未収を見られない問題の解消）
  const allowed = hasShopRole(shop, SALES_EDIT_ROLES);
  const path = shop.shopId && allowed ? `shop_shops/${shop.shopId}/unpaid` : null;
  const records = useMemo(() => (path && recordsSnap?.path === path ? recordsSnap.list : []), [recordsSnap, path]);
  const loading = shop.loading || (!!path && recordsSnap?.path !== path);

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
    if (!path) return;
    const unsub = onSnapshot(
      collection(db, path),
      (snap) => {
        const out: UnpaidRecord[] = [];
        snap.forEach((d) => out.push(mapRecord(d.id, d.data())));
        out.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
        setRecordsSnap({ path, list: out });
      },
      (e) => {
        // 出所を確定して loading は解くが、「売掛なし」と誤読させない（回収漏れになる）
        setRecordsSnap({ path, list: [] });
        setReadError(describeFirestoreError(e, '売掛の読み込み'));
      },
    );
    return () => unsub();
  }, [path]);

  const active = useMemo(() => records.filter((r) => r.status !== '回収済'), [records]);
  const totalAmount = useMemo(() => active.reduce((s, r) => s + balanceOf(r), 0), [active]);
  const totalCount = active.length;
  const maxElapsed = active.length > 0 ? Math.max(...active.map((r) => r.elapsedDays)) : 0;
  const overdueCount = useMemo(() => active.filter(isOverdue).length, [active]);

  const balanceRanking = useMemo(() => buildBalanceRanking(records), [records]);
  const maxBalance = balanceRanking.length > 0 ? balanceRanking[0][1] : 1;

  // ── CRUD ──
  const addRecord = async () => {
    if (!path || busy) return;
    const name = fName.trim();
    const amount = Number(fAmount);
    if (!name || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true); setOpError(null);
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
    } catch (e) {
      // catch が無いと、記録できていないのに入力欄がそのまま残るだけ＝成功と区別がつかない
      setOpError(describeFirestoreError(e, '売掛の記録'));
    } finally {
      setBusy(false);
    }
  };

  const removeRecord = async (r: UnpaidRecord) => {
    if (!path) return;
    // 売掛＝債権の記録。誤タップ消失は金銭事故に直結するため対象名・残高入りで確認
    if (!window.confirm(`「${r.customerName}」の売掛記録（残 ${yen(balanceOf(r))}）を削除しますか？この操作は取り消せません。`)) return;
    setOpError(null);
    try { await deleteDoc(doc(db, `${path}/${r.id}`)); }
    catch (e) { setOpError(describeFirestoreError(e, '売掛記録の削除')); }
  };

  const changeStatus = async (r: UnpaidRecord, status: UnpaidStatus) => {
    if (!path) return;
    setOpError(null);
    // 「回収済」に変えたのに変わらない＝回収漏れを見落とす。失敗は必ず出す
    try { await updateDoc(doc(db, `${path}/${r.id}`), statusChangePatch(r, status)); }
    catch (e) { setOpError(describeFirestoreError(e, 'ステータスの変更')); }
  };

  // 一部回収を確定（paidAmount を加算し、status を自動更新）
  const applyCollect = async (r: UnpaidRecord) => {
    if (!path || busy) return;
    const patch = collectPatch(r, Number(collectAmount));
    if (!patch) return;
    setBusy(true); setOpError(null);
    try {
      await updateDoc(doc(db, `${path}/${r.id}`), patch);
      setCollectId(null);
      setCollectAmount('');
    } catch (e) {
      // 失敗時は入力欄を閉じない（金額を打ち直させない）
      setOpError(describeFirestoreError(e, '一部回収の記録'));
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
        {readError && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{readError}</p>}
        {/* 追加・削除・ステータス変更・一部回収の失敗（旧実装は無音で「押しても何も起きない」ように見えた） */}
        {opError && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{opError}</p>}
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
              ノクサ · 売掛管理
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

          {/* 権限バッジ（実際の許可は owner/manager/accounting） */}
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
            {SALES_EDIT_ROLE_LABEL}
          </div>
        </div>

        {/* ── 状態分岐 ── */}
        {shop.loading || loading ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>読み込み中…</p>
        ) : !allowed && shop.roleError ? (
          // 取得失敗を「権限なし」と言い切らない（店長/経理が権限を失ったように見えるのを防ぐ・Day108）
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--noxa-status-error)', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>
            {shop.roleError} 権限があるか判断できないため、この画面は開けません。画面を再読み込みしてください。
          </p>
        ) : !allowed ? (
          // 実際の許可は owner/manager/accounting（rules の isShopMemberWithSalesEdit と一致）。
          // 「オーナー専用」と言い切ると、**本来は開ける店長・経理が「自分には無理」と諦める**（Day114）
          <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>
            {describeSalesEditDenied('売掛管理')}
          </p>
        ) : !shop.shopId ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>{describeMissingShop(shop.shopError)}</p>
        ) : (
          <>
            {/* ── サマリカード ── */}
            <div
              className="grid grid-cols-1"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}
            >
              <SummaryCard label="未収金合計" value={yen(totalAmount)} accent="primary" />
              <SummaryCard label="件数（未回収＋一部）" value={`${totalCount} 件`} />
              <SummaryCard label="最長滞留日数" value={`${maxElapsed} 日`} accent="warning" />
              <SummaryCard label="期日超過" value={`${overdueCount} 件`} accent={overdueCount > 0 ? 'error' : undefined} />
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
                            {r.source === 'pos' && (
                              <span style={{ marginLeft: 6, padding: '1px 7px', borderRadius: 9999, fontSize: 9, fontFamily: mono, background: 'rgba(139,92,246,0.12)', border: '1px solid var(--noxa-border-strong)', color: 'var(--noxa-accent-primary-ink)' }}>POS</span>
                            )}
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
                              <span style={{ display: 'block', fontSize: 10, color: isOverdue(r) ? 'var(--noxa-status-error)' : 'var(--noxa-text-faint)', fontWeight: isOverdue(r) ? 700 : 400 }}>
                                {isOverdue(r) ? '⚠ 期日超過 ' : '期日 '}{r.due}
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
                                onClick={() => removeRecord(r)}
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
  accent?: 'primary' | 'warning' | 'error';
}) {
  const valueColor =
    accent === 'primary'
      ? 'var(--noxa-accent-primary-ink)'
      : accent === 'warning'
      ? 'var(--noxa-status-warning)'
      : accent === 'error'
      ? 'var(--noxa-status-error)'
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
