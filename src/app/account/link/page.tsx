'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { db } from '@/lib/firebase/config';
import { getProfilePage, updateProfilePage, changeUserHandle, validateHandle, isHandleAvailable, type ProfilePage, type SnsLink } from '@/lib/handle';
import { compressImage } from '@/lib/menu/imageCompress';

const PLATFORMS = ['instagram', 'x', 'tiktok', 'line', 'youtube', 'other'];

function ProfileLinkClient({ user }: { user: User }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 編集フィールド
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [sns, setSns] = useState<SnsLink[]>([]);
  const [published, setPublished] = useState(false);
  // ハンドル変更
  const [editingHandle, setEditingHandle] = useState(false);
  const [newHandle, setNewHandle] = useState('');
  const [hStatus, setHStatus] = useState<'idle' | 'ok' | 'taken' | 'invalid'>('idle');
  const [hBusy, setHBusy] = useState(false);

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
          setPage(p);
          setDisplayName(p.displayName || user.displayName || '');
          setBio(p.bio || '');
          setAvatar(p.avatar || user.photoURL || '');
          setSns(p.sns?.length ? p.sns : []);
          setPublished(!!p.published);
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
    if (!h) { setHStatus(newHandle ? 'invalid' : 'idle'); return; }
    if (h === handle) { setHStatus('idle'); return; }
    let alive = true;
    const t = setTimeout(async () => { const ok = await isHandleAvailable(h); if (alive) setHStatus(ok ? 'ok' : 'taken'); }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [newHandle, editingHandle, handle]);

  const doChangeHandle = async () => {
    if (!handle) return;
    const h = validateHandle(newHandle); if (!h) return;
    setHBusy(true);
    try { const nh = await changeUserHandle(user.uid, handle, h); setHandle(nh); setEditingHandle(false); setNewHandle(''); }
    catch { setHStatus('taken'); }
    finally { setHBusy(false); }
  };

  const save = async () => {
    if (!handle) return;
    setSaving(true); setSaved(false);
    try {
      await updateProfilePage(handle, { displayName, bio, avatar, sns: sns.filter((s) => s.url.trim()), published });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  if (loading) return <Eyebrow>読み込み中…</Eyebrow>;
  if (!handle) return <p style={{ color: 'var(--noxa-text-muted)' }}>ハンドルが未設定です。<Link href="/account/onboarding" style={{ color: 'var(--noxa-accent-primary-ink)' }}>設定する</Link></p>;

  const publicUrl = `https://noxa.egshugy.com/u/${handle}`;

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Account · 公開プロフィール</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>公開プロフィール（リンク集）</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 8px' }}>
        SNS をまとめた公開ページを作れます。本名・所在地は載せず、源氏名でどうぞ。
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

      {/* 公開トグル */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: published ? 'rgba(123,232,161,0.10)' : 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{published ? '公開中' : '非公開（自分だけ確認可）'}</span>
      </label>

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
      <Field label="ひとこと / 自己紹介"><textarea value={bio} onChange={(e) => setBio(e.target.value)} className="noxa-input" rows={3} maxLength={150} style={{ resize: 'vertical' }} /></Field>

      {/* SNS リンク */}
      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 8 }}>SNS / リンク</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sns.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <select value={s.platform} onChange={(e) => setSns((p) => p.map((x, j) => j === i ? { ...x, platform: e.target.value } : x))} className="noxa-input" style={{ width: 130, flex: 'none' }}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={s.url} onChange={(e) => setSns((p) => p.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" className="noxa-input" style={{ flex: 1 }} />
              <button type="button" onClick={() => setSns((p) => p.filter((_, j) => j !== i))} style={{ ...miniBtn, color: 'var(--noxa-status-error)' }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setSns((p) => [...p, { platform: 'instagram', url: '' }])} style={{ ...miniBtn, alignSelf: 'flex-start' }}>＋ リンクを追加</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button type="button" onClick={save} disabled={saving} className="noxa-btn noxa-btn-primary" style={{ padding: '12px 24px', fontSize: 15 }}>{saving ? '保存中…' : '保存'}</button>
        {saved && <span style={{ color: 'var(--noxa-status-success)', fontSize: 13 }}>✓ 保存しました</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 6 }}>{label}</div>{children}</div>;
}
function Eyebrow({ children }: { children: React.ReactNode }) { return <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>{children}</p>; }
const miniBtn: React.CSSProperties = { display: 'inline-block', padding: '6px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'none' };

export default function Page() {
  return <AuthGuard>{(user) => <AccountShell user={user}><ProfileLinkClient user={user} /></AccountShell>}</AuthGuard>;
}
