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
 * 体験入店 — Noxa OS モジュール（実データ）
 *
 * 採用パイプライン: 応募 → 体験予約 → 体験中 → 評価 → 本入店
 * shop_shops/{shopId}/trials を onSnapshot で購読し、追加/編集/削除/ステータス遷移を行う。
 */

const mono = 'var(--noxa-font-mono)';

type TrialStatus = 'applied' | 'scheduled' | 'ongoing' | 'review' | 'hired' | 'rejected';
type Source = 'SNS' | '紹介' | '求人';

type Candidate = {
  id: string;
  name: string; // 源氏名(仮)
  source: Source;
  scheduledAt: string; // YYYY-MM-DD（未定は空）
  wage: number | null; // 時給
  rating: number; // 1〜5（0 は未評価）
  contact: string;
  note: string;
  status: TrialStatus;
};

const SOURCES: Source[] = ['SNS', '紹介', '求人'];

const PIPELINE_STEPS: { key: TrialStatus; label: string }[] = [
  { key: 'applied', label: '応募' },
  { key: 'scheduled', label: '体験予約' },
  { key: 'ongoing', label: '体験中' },
  { key: 'review', label: '評価' },
  { key: 'hired', label: '本入店' },
];

const STATUS_META: Record<TrialStatus, { label: string; color: string; bg: string; border: string }> = {
  applied: {
    label: '応募',
    color: 'var(--noxa-status-info)',
    bg: 'rgba(99,179,237,0.10)',
    border: 'rgba(99,179,237,0.30)',
  },
  scheduled: {
    label: '体験予約',
    color: 'var(--noxa-status-warning)',
    bg: 'rgba(246,173,85,0.10)',
    border: 'rgba(246,173,85,0.30)',
  },
  ongoing: {
    label: '体験中',
    color: 'var(--noxa-accent-primary-ink)',
    bg: 'rgba(103,232,249,0.10)',
    border: 'rgba(103,232,249,0.30)',
  },
  review: {
    label: '評価',
    color: 'var(--noxa-text-muted)',
    bg: 'var(--noxa-surface-muted)',
    border: 'var(--noxa-border)',
  },
  hired: {
    label: '本入店',
    color: 'var(--noxa-status-success)',
    bg: 'rgba(123,232,161,0.10)',
    border: 'rgba(123,232,161,0.30)',
  },
  rejected: {
    label: '不採用',
    color: 'var(--noxa-status-error)',
    bg: 'rgba(252,129,129,0.08)',
    border: 'rgba(252,129,129,0.25)',
  },
};

/** rating を数値へ正規化（文字列◎○△× も許容） */
function normalizeRating(v: unknown): number {
  if (typeof v === 'number') return Math.max(0, Math.min(5, Math.round(v)));
  if (typeof v === 'string') {
    const symbol: Record<string, number> = { '◎': 5, '○': 4, '△': 2, '×': 1 };
    if (v in symbol) return symbol[v];
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(5, Math.round(n)));
  }
  return 0;
}

function toSource(v: unknown): Source {
  return v === '紹介' || v === '求人' ? v : 'SNS';
}

function toStatus(v: unknown): TrialStatus {
  const all: TrialStatus[] = ['applied', 'scheduled', 'ongoing', 'review', 'hired', 'rejected'];
  return all.includes(v as TrialStatus) ? (v as TrialStatus) : 'applied';
}

function mapCandidate(id: string, d: DocumentData): Candidate {
  return {
    id,
    name: (d.name as string) ?? '（無名）',
    source: toSource(d.source),
    scheduledAt: (d.scheduledAt as string) ?? '',
    wage: typeof d.wage === 'number' ? d.wage : null,
    rating: normalizeRating(d.rating),
    contact: (d.contact as string) ?? '',
    note: (d.note as string) ?? '',
    status: toStatus(d.status),
  };
}

const yen = (n: number | null) => (n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
const ym = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const ymd = () => new Date().toISOString().slice(0, 10);

/** 星評価レンダリング */
function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`評価 ${rating} 点`} style={{ fontFamily: mono, fontSize: 12, letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= rating ? 'var(--noxa-status-warning)' : 'var(--noxa-surface-muted)' }}>
          ★
        </span>
      ))}
    </span>
  );
}

/** ステータスバッジ */
function StatusBadge({ status }: { status: TrialStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 9999,
        fontFamily: mono,
        fontSize: 10,
        letterSpacing: '0.10em',
        color: m.color,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: m.color,
          flexShrink: 0,
        }}
      />
      {m.label}
    </span>
  );
}

/** KPI カード */
function KpiCard({ label, value }: { label: string; value: string | number }) {
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
          color: 'var(--noxa-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** 次のパイプライン段階を返す（rejected/末尾は null） */
function nextStatus(status: TrialStatus): TrialStatus | null {
  const idx = PIPELINE_STEPS.findIndex((s) => s.key === status);
  if (idx < 0 || idx >= PIPELINE_STEPS.length - 1) return null;
  return PIPELINE_STEPS[idx + 1].key;
}

/** 候補者カード（リスト行） */
function CandidateRow({
  candidate,
  onAdvance,
  onHire,
  onReject,
  onEdit,
  onDelete,
  busy,
}: {
  candidate: Candidate;
  onAdvance: (c: Candidate) => void;
  onHire: (c: Candidate) => void;
  onReject: (c: Candidate) => void;
  onEdit: (c: Candidate) => void;
  onDelete: (c: Candidate) => void;
  busy: boolean;
}) {
  const isFinalized = candidate.status === 'hired' || candidate.status === 'rejected';
  const next = nextStatus(candidate.status);
  return (
    <li
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* 上段: 名前・バッジ・日付 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{candidate.name}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={candidate.status} />
            <span
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: 'var(--noxa-text-faint)',
                background: 'var(--noxa-surface-muted)',
                padding: '2px 7px',
                borderRadius: 9999,
              }}
            >
              {candidate.source}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              letterSpacing: '0.06em',
            }}
          >
            体験日
          </div>
          <div style={{ fontFamily: mono, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            {candidate.scheduledAt ? candidate.scheduledAt.replace(/^\d{4}-/, '') : '未定'}
          </div>
        </div>
      </div>

      {/* 中段: 時給・評価・連絡先 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginBottom: 2 }}>時給</div>
          <div style={{ fontFamily: mono, fontSize: 13 }}>{yen(candidate.wage)}</div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginBottom: 2 }}>評価</div>
          {candidate.rating > 0 ? (
            <Stars rating={candidate.rating} />
          ) : (
            <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>未評価</span>
          )}
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginBottom: 2 }}>連絡先</div>
          <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{candidate.contact || '—'}</div>
        </div>
      </div>

      {candidate.note && (
        <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', lineHeight: 1.6 }}>{candidate.note}</div>
      )}

      {/* 下段: アクションボタン */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4, alignItems: 'center' }}>
        {!isFinalized && next && (
          <button
            type="button"
            onClick={() => onAdvance(candidate)}
            disabled={busy}
            aria-label={`${candidate.name} を「${STATUS_META[next].label}」へ進める`}
            style={{
              padding: '6px 14px',
              background: 'rgba(103,232,249,0.10)',
              border: '1px solid rgba(103,232,249,0.30)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-accent-primary-ink)',
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {STATUS_META[next].label}へ →
          </button>
        )}
        {!isFinalized && (
          <button
            type="button"
            onClick={() => onHire(candidate)}
            disabled={busy}
            aria-label={`${candidate.name} を本入店にする`}
            style={{
              padding: '6px 14px',
              background: 'rgba(123,232,161,0.12)',
              border: '1px solid rgba(123,232,161,0.35)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-status-success)',
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            本入店にする
          </button>
        )}
        {!isFinalized && (
          <button
            type="button"
            onClick={() => onReject(candidate)}
            disabled={busy}
            aria-label={`${candidate.name} を不採用にする`}
            style={{
              padding: '6px 14px',
              background: 'rgba(252,129,129,0.08)',
              border: '1px solid rgba(252,129,129,0.25)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-status-error)',
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            不採用
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(candidate)}
          aria-label={`${candidate.name} を編集`}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--noxa-border)',
            borderRadius: 9999,
            fontFamily: mono,
            fontSize: 11,
            color: 'var(--noxa-text-muted)',
            cursor: 'pointer',
          }}
        >
          編集
        </button>
        <button
          type="button"
          onClick={() => onDelete(candidate)}
          disabled={busy}
          aria-label={`${candidate.name} を削除`}
          title="削除"
          style={{
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--noxa-border)',
            borderRadius: 9999,
            fontFamily: mono,
            fontSize: 12,
            color: 'var(--noxa-text-faint)',
            cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          ×
        </button>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────
// 追加／編集エディタ
// ─────────────────────────────────────────────

type DraftKey = 'new' | string;
type Draft = {
  name: string;
  source: Source;
  status: TrialStatus;
  scheduledAt: string;
  wage: string;
  rating: number;
  contact: string;
  note: string;
};

function emptyDraft(): Draft {
  return { name: '', source: 'SNS', status: 'applied', scheduledAt: '', wage: '', rating: 0, contact: '', note: '' };
}

function draftFrom(c: Candidate): Draft {
  return {
    name: c.name,
    source: c.source,
    status: c.status,
    scheduledAt: c.scheduledAt,
    wage: c.wage == null ? '' : String(c.wage),
    rating: c.rating,
    contact: c.contact,
    note: c.note,
  };
}

const field: React.CSSProperties = {
  minHeight: 40,
  padding: '8px 10px',
  borderRadius: 10,
  background: 'var(--noxa-bg-base)',
  border: '1px solid var(--noxa-border)',
  color: 'var(--noxa-text-primary)',
  fontSize: 14,
  width: '100%',
};
const lbl: React.CSSProperties = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)' };

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    background: active ? 'var(--noxa-surface-muted)' : 'transparent',
    border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
    borderRadius: 9999,
    fontFamily: mono,
    fontSize: 11,
    color: active ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)',
    cursor: 'pointer',
  };
}

function Editor({
  draftKey,
  initial,
  onSave,
  onClose,
  busy,
}: {
  draftKey: DraftKey;
  initial: Draft;
  onSave: (key: DraftKey, draft: Draft) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const isNew = draftKey === 'new';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 210,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--noxa-surface-card)',
          border: '1px solid var(--noxa-border)',
          borderRadius: 16,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16 }}>
          {isNew ? '候補者を追加' : '候補者を編集'}
        </h3>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>名前（源氏名）</span>
          <input value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="あかり（仮）" style={field} />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>流入元</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SOURCES.map((s) => (
              <button key={s} type="button" onClick={() => set('source', s)} style={chip(d.source === s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>ステータス</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(STATUS_META) as TrialStatus[]).map((s) => (
              <button key={s} type="button" onClick={() => set('status', s)} style={chip(d.status === s)}>
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lbl}>体験日</span>
            <input
              type="date"
              value={d.scheduledAt}
              onChange={(e) => set('scheduledAt', e.target.value)}
              style={{ ...field, fontFamily: mono }}
            />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lbl}>時給</span>
            <input
              type="number"
              inputMode="numeric"
              value={d.wage}
              onChange={(e) => set('wage', e.target.value)}
              placeholder="3000"
              style={{ ...field, fontFamily: mono }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>評価</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => set('rating', d.rating === i ? 0 : i)}
                aria-label={`評価 ${i} 点`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 20,
                  padding: 0,
                  color: i <= d.rating ? 'var(--noxa-status-warning)' : 'var(--noxa-surface-muted)',
                }}
              >
                ★
              </button>
            ))}
            <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>
              {d.rating > 0 ? `${d.rating} 点` : '未評価'}
            </span>
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>連絡先</span>
          <input value={d.contact} onChange={(e) => set('contact', e.target.value)} placeholder="LINE / 電話 など" style={field} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>メモ</span>
          <textarea
            value={d.note}
            onChange={(e) => set('note', e.target.value)}
            rows={3}
            placeholder="次アクション・所感など"
            style={{ ...field, minHeight: 70, resize: 'vertical', fontFamily: 'var(--noxa-font-sans-jp)' }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button
            type="button"
            onClick={() => onSave(draftKey, d)}
            disabled={busy || !d.name.trim()}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              cursor: 'pointer',
              background: 'var(--noxa-accent-primary)',
              color: '#fff',
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              opacity: busy || !d.name.trim() ? 0.6 : 1,
            }}
          >
            {isNew ? '追加' : '保存'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 12,
              cursor: 'pointer',
              background: 'transparent',
              color: 'var(--noxa-text-muted)',
              border: '1px solid var(--noxa-border)',
              fontSize: 14,
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

export function TrialClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TrialStatus | 'all'>('all');
  const [busy, setBusy] = useState(false);
  // null=非表示, 'new'=新規, それ以外=編集対象 id
  const [editorKey, setEditorKey] = useState<DraftKey | null>(null);

  const path = shop.shopId ? `shop_shops/${shop.shopId}/trials` : null;

  useEffect(() => {
    if (shop.loading) return;
    if (!path) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, path),
      (snap) => {
        const out: Candidate[] = [];
        snap.forEach((dd) => out.push(mapCandidate(dd.id, dd.data())));
        out.sort((a, b) => {
          // 体験日降順、無いものは末尾
          if (a.scheduledAt && b.scheduledAt) return b.scheduledAt.localeCompare(a.scheduledAt);
          if (a.scheduledAt) return -1;
          if (b.scheduledAt) return 1;
          return a.name.localeCompare(b.name);
        });
        setCandidates(out);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [shop.loading, path]);

  // 追加／編集の保存（undefined を書き込まない）
  const saveDraft = async (key: DraftKey, d: Draft) => {
    if (!path || busy || !d.name.trim()) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: d.name.trim(),
        source: d.source,
        status: d.status,
        rating: d.rating, // 0=未評価
      };
      if (d.scheduledAt) payload.scheduledAt = d.scheduledAt;
      if (d.wage.trim() !== '' && Number.isFinite(Number(d.wage))) payload.wage = Number(d.wage);
      if (d.contact.trim()) payload.contact = d.contact.trim();
      if (d.note.trim()) payload.note = d.note.trim();

      if (key === 'new') {
        await addDoc(collection(db, path), { ...payload, createdAt: serverTimestamp(), createdBy: user.uid });
      } else {
        await updateDoc(doc(db, `${path}/${key}`), payload);
      }
      setEditorKey(null);
    } finally {
      setBusy(false);
    }
  };

  const patchStatus = async (c: Candidate, status: TrialStatus) => {
    if (!path || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, `${path}/${c.id}`), { status });
    } finally {
      setBusy(false);
    }
  };
  const advance = (c: Candidate) => {
    const next = nextStatus(c.status);
    if (next) void patchStatus(c, next);
  };
  const hire = (c: Candidate) => void patchStatus(c, 'hired');
  const reject = (c: Candidate) => void patchStatus(c, 'rejected');

  const remove = async (c: Candidate) => {
    if (!path || busy) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, `${path}/${c.id}`));
    } finally {
      setBusy(false);
    }
  };

  const active = candidates.filter((c) => c.status !== 'rejected');
  const today = ymd();
  const month = ym();
  const todayCount = candidates.filter((c) => c.scheduledAt === today).length;
  const monthCount = candidates.filter((c) => c.scheduledAt.startsWith(month)).length;
  const hiredCount = candidates.filter((c) => c.status === 'hired').length;
  const eligibleCount = candidates.filter((c) => c.status === 'hired' || c.status === 'review').length;
  const hireRate = eligibleCount > 0 ? `${Math.round((hiredCount / eligibleCount) * 100)}%` : '—';

  const filtered = filterStatus === 'all' ? candidates : candidates.filter((c) => c.status === filterStatus);

  const editorInitial = useMemo<Draft | null>(() => {
    if (editorKey === null) return null;
    if (editorKey === 'new') return emptyDraft();
    const c = candidates.find((x) => x.id === editorKey);
    return c ? draftFrom(c) : null;
  }, [editorKey, candidates]);

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
          background: 'radial-gradient(ellipse, rgba(246,173,85,0.07) 0%, transparent 65%)',
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
            <li>trial</li>
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
              ノクサ · 体験入店
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
                №
              </span>
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-jp)',
                  fontWeight: 500,
                }}
              >
                体験入店
              </span>
            </h1>
          </div>

          {/* 追加ボタン */}
          <button
            type="button"
            onClick={() => setEditorKey('new')}
            disabled={!shop.shopId}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: 'var(--noxa-accent-primary)',
              border: 'none',
              borderRadius: 9999,
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              cursor: shop.shopId ? 'pointer' : 'not-allowed',
              opacity: shop.shopId ? 1 : 0.5,
            }}
          >
            ＋ 候補者を追加
          </button>
        </div>

        {shop.loading || loading ? (
          <p style={{ fontFamily: mono, fontSize: 13, color: 'var(--noxa-text-muted)' }}>読み込み中…</p>
        ) : !shop.shopId ? (
          <div
            style={{
              padding: 24,
              border: '1px solid var(--noxa-border)',
              borderRadius: 14,
              background: 'var(--noxa-surface-card)',
              textAlign: 'center',
              color: 'var(--noxa-text-faint)',
              fontFamily: mono,
              fontSize: 13,
            }}
          >
            所属店舗が見つかりません。
          </div>
        ) : (
          <>
            {/* KPI サマリ */}
            <div className="grid grid-cols-2 lg:grid-cols-3" style={{ gap: 12, marginBottom: 24 }}>
              <KpiCard label="本日の体験" value={todayCount} />
              <KpiCard label="今月の体験" value={monthCount} />
              <KpiCard label="本入店化率" value={hireRate} />
            </div>

            {/* パイプライン概要バー */}
            <section aria-label="ステータス別パイプライン" style={{ marginBottom: 20 }}>
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 10, color: 'var(--noxa-text-faint)' }}>
                パイプライン
              </h2>
              <div
                style={{
                  display: 'flex',
                  gap: 0,
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  paddingBottom: 4,
                }}
                role="list"
              >
                {PIPELINE_STEPS.map((step, i) => {
                  const count = candidates.filter((c) => c.status === step.key).length;
                  const isActive = filterStatus === step.key;
                  const meta = STATUS_META[step.key];
                  return (
                    <button
                      key={step.key}
                      type="button"
                      role="listitem"
                      onClick={() => setFilterStatus(isActive ? 'all' : step.key)}
                      aria-pressed={isActive}
                      aria-label={`${step.label}（${count}名）でフィルタ`}
                      style={{
                        flex: '1 1 0',
                        minWidth: 72,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        padding: '10px 8px',
                        background: isActive ? meta.bg : 'transparent',
                        border: `1px solid ${isActive ? meta.border : 'var(--noxa-border)'}`,
                        borderRight: i < PIPELINE_STEPS.length - 1 ? 'none' : undefined,
                        borderRadius:
                          i === 0 ? '10px 0 0 10px' : i === PIPELINE_STEPS.length - 1 ? '0 10px 10px 0' : 0,
                        cursor: 'pointer',
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 18,
                          fontWeight: 700,
                          color: isActive ? meta.color : 'var(--noxa-text-primary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {count}
                      </span>
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          color: isActive ? meta.color : 'var(--noxa-text-faint)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {step.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* フィルタ制御 */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: 16,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                aria-pressed={filterStatus === 'all'}
                style={{
                  padding: '5px 12px',
                  background: filterStatus === 'all' ? 'var(--noxa-surface-muted)' : 'transparent',
                  border: '1px solid var(--noxa-border)',
                  borderRadius: 9999,
                  fontFamily: mono,
                  fontSize: 11,
                  color: 'var(--noxa-text-muted)',
                  cursor: 'pointer',
                }}
              >
                すべて（{candidates.length}）
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus(filterStatus === 'rejected' ? 'all' : 'rejected')}
                aria-pressed={filterStatus === 'rejected'}
                style={{
                  padding: '5px 12px',
                  background: filterStatus === 'rejected' ? STATUS_META.rejected.bg : 'transparent',
                  border: `1px solid ${filterStatus === 'rejected' ? STATUS_META.rejected.border : 'var(--noxa-border)'}`,
                  borderRadius: 9999,
                  fontFamily: mono,
                  fontSize: 11,
                  color: filterStatus === 'rejected' ? STATUS_META.rejected.color : 'var(--noxa-text-faint)',
                  cursor: 'pointer',
                }}
              >
                不採用（{candidates.filter((c) => c.status === 'rejected').length}）
              </button>
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: mono,
                  fontSize: 11,
                  color: 'var(--noxa-text-faint)',
                }}
              >
                アクティブ {active.length} 名
              </span>
            </div>

            {/* 候補者リスト */}
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  border: '1px solid var(--noxa-border)',
                  borderRadius: 14,
                  background: 'var(--noxa-surface-card)',
                  textAlign: 'center',
                  color: 'var(--noxa-text-faint)',
                  fontFamily: mono,
                  fontSize: 13,
                }}
              >
                {candidates.length === 0 ? '候補者を追加してください' : '該当する候補者はいません'}
              </div>
            ) : (
              <ul
                aria-label="候補者一覧"
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {filtered.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    onAdvance={advance}
                    onHire={hire}
                    onReject={reject}
                    onEdit={(cc) => setEditorKey(cc.id)}
                    onDelete={remove}
                    busy={busy}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editorKey !== null && editorInitial && (
        <Editor
          draftKey={editorKey}
          initial={editorInitial}
          onSave={saveDraft}
          onClose={() => setEditorKey(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

export default TrialClient;
