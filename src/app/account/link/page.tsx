'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { db } from '@/lib/firebase/config';
import { getProfilePage, updateProfilePage, changeUserHandle, validateHandle, isHandleAvailable, resolveVisibility, type Visibility } from '@/lib/handle';
import {
  normalizeBlocks, blocksFromLegacy, createBlock, moveBlock, sanitizeForSave, isSafeUrl,
  type ProfileBlock,
} from '@/lib/profile-blocks';
import { compressImage } from '@/lib/menu/imageCompress';

const PLATFORMS = ['instagram', 'x', 'tiktok', 'line', 'youtube', 'other'];

const VIS_OPTIONS: { value: Visibility; label: string; desc: string }[] = [
  { value: 'public', label: '公開', desc: '誰でも閲覧可・検索にも出る' },
  { value: 'unlisted', label: 'リンク限定', desc: 'URLを知ってる人だけ・検索に出ない' },
  { value: 'private', label: '非公開', desc: '自分だけ確認できる' },
];

function ProfileLinkClient({ user }: { user: User }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 編集フィールド（blocks が正本。bio/sns は初回に blocks へ one-way migration）
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [blocks, setBlocks] = useState<ProfileBlock[]>([]);
  const [visibility, setVisibility] = useState<Visibility>('private');
  // ハンドル変更。可用性は「どのハンドルの結果か」つきで持ち、表示状態を導出する
  // （同期分岐の setHStatus は set-state-in-effect 違反）
  const [editingHandle, setEditingHandle] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [checkSnap, setCheckSnap] = useState<{ for: string; status: 'ok' | 'taken' } | null>(null);
  const [hBusy, setHBusy] = useState(false);
  const validH = validateHandle(newHandle);
  const hStatus: 'idle' | 'checking' | 'ok' | 'taken' | 'invalid' =
    !editingHandle ? 'idle'
    : !validH ? (newHandle ? 'invalid' : 'idle')
    : validH === handle ? 'idle'
    : checkSnap?.for === validH ? checkSnap.status : 'checking';

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await getDoc(doc(db, `account_users/${user.uid}`));
      const h = s.exists() ? (s.data() as { handle?: string }).handle : undefined;
      if (!alive) return;
      setHandle(h ?? null);
      if (h) {
        const p = await getProfilePage(h);
        if (!alive) return;
        if (p) {
          setDisplayName(p.displayName || user.displayName || '');
          setAvatar(p.avatar || user.photoURL || '');
          setVisibility(resolveVisibility(p));
          // blocks 正本。無ければ旧 bio/sns から one-way migration（保存時に確定）
          const bl = normalizeBlocks(p.blocks);
          setBlocks(bl.length > 0 ? bl : blocksFromLegacy(p));
        }
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.uid, user.displayName, user.photoURL]);

  const onAvatar = async (file: File) => {
    try { const d = await compressImage(file, { maxSize: 512 }); setAvatar(d); } catch { /* skip */ }
  };

  useEffect(() => {
    if (!editingHandle) return;
    const h = validateHandle(newHandle);
    if (!h || h === handle) return; // 表示は導出（invalid/idle）
    let alive = true;
    const t = setTimeout(async () => { const ok = await isHandleAvailable(h); if (alive) setCheckSnap({ for: h, status: ok ? 'ok' : 'taken' }); }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [newHandle, editingHandle, handle]);

  const doChangeHandle = async () => {
    if (!handle) return;
    const h = validateHandle(newHandle); if (!h) return;
    setHBusy(true);
    try { const nh = await changeUserHandle(user.uid, handle, h); setHandle(nh); setEditingHandle(false); setNewHandle(''); }
    catch { setCheckSnap({ for: h, status: 'taken' }); }
    finally { setHBusy(false); }
  };

  const save = async () => {
    if (!handle) return;
    setSaving(true); setSaved(false); setError(null);
    try {
      // blocks を正本として保存（旧 bio/sns はもう書かない＝二重管理による表示ズレを防ぐ）
      await updateProfilePage(handle, {
        displayName, avatar,
        blocks: sanitizeForSave(blocks),
        visibility,
        published: visibility === 'public', // 旧クライアント互換ミラー
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally { setSaving(false); }
  };

  // blocks 操作
  const patchBlock = (id: string, patch: Partial<ProfileBlock>) =>
    setBlocks((p) => p.map((b) => (b.id === id ? ({ ...b, ...patch } as ProfileBlock) : b)));
  const removeBlock = (id: string) => setBlocks((p) => p.filter((b) => b.id !== id));
  const addBlock = (type: 'text' | 'link' | 'schedule') =>
    setBlocks((p) => [...p, type === 'link' ? createBlock('link', { label: '', url: '' }) : createBlock(type, '')]);

  if (loading) return <Eyebrow>読み込み中…</Eyebrow>;
  if (!handle) return <p style={{ color: 'var(--noxa-text-muted)' }}>ハンドルが未設定です。<Link href="/account/onboarding" style={{ color: 'var(--noxa-accent-primary-ink)' }}>設定する</Link></p>;

  const publicUrl = `https://noxa.egshugy.com/u/${handle}`;

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Account · NOXAページ</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>NOXAページ（公開プロフィール）</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 8px' }}>
        自己紹介・リンク・出勤予定をブロックで組める公開ページ。本名・所在地は載せず、源氏名でどうぞ。
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: editingHandle ? 8 : 20, flexWrap: 'wrap' }}>
        <code style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 12, background: 'var(--noxa-surface-muted)', padding: '4px 8px', borderRadius: 6 }}>{publicUrl}</code>
        <button type="button" onClick={() => navigator.clipboard?.writeText(publicUrl)} style={miniBtn}>コピー</button>
        <Link href={`/u/${handle}`} target="_blank" style={miniBtn}>開く ↗</Link>
        <button type="button" onClick={() => { setEditingHandle((v) => !v); setNewHandle(handle ?? ''); }} style={miniBtn}>ID変更</button>
      </div>
      {editingHandle && (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 12, color: 'var(--noxa-text-faint)' }}>/u/</span>
            <input value={newHandle} onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))} className="noxa-input" style={{ flex: 1 }} />
            <button type="button" onClick={doChangeHandle} disabled={hBusy || hStatus !== 'ok'} className="noxa-btn noxa-btn-primary" style={{ padding: '0 16px' }}>{hBusy ? '変更中…' : '変更'}</button>
          </div>
          <div style={{ minHeight: 18, marginTop: 6, fontSize: 12 }}>
            {hStatus === 'ok' && <span style={{ color: 'var(--noxa-status-success)' }}>✓ 使用できます</span>}
            {hStatus === 'taken' && <span style={{ color: 'var(--noxa-accent-destructive)' }}>このIDは使用済みです</span>}
            {hStatus === 'invalid' && <span style={{ color: 'var(--noxa-accent-destructive)' }}>英数字と「_」3〜20文字</span>}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>※ 変更すると以前のURL（/u/{handle}）は無効になります。</p>
        </div>
      )}

      {/* 公開範囲（3値） */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        {VIS_OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => setVisibility(o.value)}
            style={{ flex: 1, padding: '10px 8px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: visibility === o.value ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)',
              color: visibility === o.value ? '#fff' : 'var(--noxa-text-primary)',
              border: `1px solid ${visibility === o.value ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` }}>
            {o.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '0 0 16px' }}>{VIS_OPTIONS.find((o) => o.value === visibility)?.desc}</p>

      {/* アバター */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: 'var(--noxa-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--noxa-text-faint)' }}>♠</span>}
        </div>
        <label style={{ ...miniBtn, cursor: 'pointer' }}>画像を選択
          <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAvatar(f); }} style={{ display: 'none' }} />
        </label>
      </div>

      <Field label="表示名（源氏名）"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="noxa-input" maxLength={40} /></Field>

      {/* ブロックエディタ（正本） */}
      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 8 }}>ページの中身（上から順に表示）</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {blocks.map((b, i) => (
            <div key={b.id} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', opacity: b.visible ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 10, color: 'var(--noxa-accent-primary-ink)', letterSpacing: '0.06em' }}>
                  {b.type === 'text' ? 'テキスト' : b.type === 'link' ? 'リンク' : '出勤予定'}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => setBlocks((p) => moveBlock(p, i, -1))} disabled={i === 0} style={iconBtn}>↑</button>
                <button type="button" onClick={() => setBlocks((p) => moveBlock(p, i, 1))} disabled={i === blocks.length - 1} style={iconBtn}>↓</button>
                <button type="button" onClick={() => patchBlock(b.id, { visible: !b.visible })} title="表示/非表示" style={iconBtn}>{b.visible ? '👁' : '－'}</button>
                <button type="button" onClick={() => removeBlock(b.id)} style={{ ...iconBtn, color: 'var(--noxa-status-error)' }}>×</button>
              </div>
              {b.type === 'text' && (
                <textarea value={b.value} onChange={(e) => patchBlock(b.id, { value: e.target.value })} placeholder="自己紹介・お知らせなど" className="noxa-input" rows={3} maxLength={500} style={{ resize: 'vertical', width: '100%' }} />
              )}
              {b.type === 'schedule' && (
                <textarea value={b.value} onChange={(e) => patchBlock(b.id, { value: e.target.value })} placeholder={'出勤予定（例）\n金・土 21:00〜LAST\n日 お休み'} className="noxa-input" rows={3} maxLength={300} style={{ resize: 'vertical', width: '100%', fontFamily: 'var(--noxa-font-mono)' }} />
              )}
              {b.type === 'link' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={b.platform ?? 'other'} onChange={(e) => patchBlock(b.id, { platform: e.target.value })} className="noxa-input" style={{ width: 130, flex: 'none' }}>
                      {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input value={b.label} onChange={(e) => patchBlock(b.id, { label: e.target.value })} placeholder="表示名（空欄はSNS名）" className="noxa-input" style={{ flex: 1 }} maxLength={40} />
                  </div>
                  <input value={b.url} onChange={(e) => patchBlock(b.id, { url: e.target.value })} placeholder="https://…" className="noxa-input" />
                  {b.url && !isSafeUrl(b.url) && <span style={{ fontSize: 11, color: 'var(--noxa-status-error)' }}>https:// から始まるURLを入れてください（保存時に除外されます）</span>}
                </div>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => addBlock('text')} style={{ ...miniBtn, borderStyle: 'dashed' }}>＋ テキスト</button>
            <button type="button" onClick={() => addBlock('link')} style={{ ...miniBtn, borderStyle: 'dashed' }}>＋ リンク</button>
            <button type="button" onClick={() => addBlock('schedule')} style={{ ...miniBtn, borderStyle: 'dashed' }}>＋ 出勤予定</button>
          </div>
        </div>
      </div>

      {error && <p style={{ color: 'var(--noxa-status-error)', fontSize: 12, margin: '8px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button type="button" onClick={save} disabled={saving} className="noxa-btn noxa-btn-primary" style={{ padding: '12px 24px', fontSize: 15 }}>{saving ? '保存中…' : '保存'}</button>
        {saved && <span style={{ color: 'var(--noxa-status-success)', fontSize: 13 }}>✓ 保存しました</span>}
        <Link href={`/u/${handle}`} target="_blank" style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>プレビュー ↗</Link>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 6 }}>{label}</div>{children}</div>;
}
function Eyebrow({ children }: { children: React.ReactNode }) { return <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>{children}</p>; }
const miniBtn: React.CSSProperties = { display: 'inline-block', padding: '6px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'none' };
const iconBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 7, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 11, cursor: 'pointer', flex: 'none' };

export default function Page() {
  return <AuthGuard>{(user) => <AccountShell user={user}><ProfileLinkClient user={user} /></AccountShell>}</AuthGuard>;
}
