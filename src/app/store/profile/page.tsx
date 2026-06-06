'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import { validateHandle, isHandleAvailable, claimHandle, getProfilePage, updateProfilePage, type SnsLink } from '@/lib/handle';
import { compressImage } from '@/lib/menu/imageCompress';

const PLATFORMS = ['instagram', 'x', 'tiktok', 'line', 'youtube', 'other'];

function StoreProfileClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const [shopName, setShopName] = useState('');
  const [handle, setHandle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // ハンドル未設定時の claim
  const [newHandle, setNewHandle] = useState('');
  const [claimStatus, setClaimStatus] = useState<'idle' | 'ok' | 'taken' | 'invalid'>('idle');
  const [claiming, setClaiming] = useState(false);
  // プロフィール編集
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [sns, setSns] = useState<SnsLink[]>([]);
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadProfile = async (h: string, fallbackName: string) => {
    const p = await getProfilePage(h);
    if (p) {
      setDisplayName(p.displayName || fallbackName);
      setBio(p.bio || ''); setAvatar(p.avatar || ''); setSns(p.sns ?? []); setPublished(!!p.published);
    } else { setDisplayName(fallbackName); }
  };

  useEffect(() => {
    if (shop.loading) return;
    let alive = true;
    (async () => {
      if (!shop.shopId) { setLoading(false); return; }
      const s = await getDoc(doc(db, `shop_shops/${shop.shopId}`));
      if (!alive) return;
      const d = s.data() as { name?: string; handle?: string } | undefined;
      const nm = d?.name ?? ''; const h = d?.handle ?? null;
      setShopName(nm); setHandle(h);
      if (h) await loadProfile(h, nm);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [shop.loading, shop.shopId]);

  useEffect(() => {
    const h = validateHandle(newHandle);
    if (!h) { setClaimStatus(newHandle ? 'invalid' : 'idle'); return; }
    let alive = true;
    const t = setTimeout(async () => { const ok = await isHandleAvailable(h); if (alive) setClaimStatus(ok ? 'ok' : 'taken'); }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [newHandle]);

  if (shop.loading || loading) return <P>読み込み中…</P>;
  if (!shop.shopId) return <P>店舗が見つかりません。</P>;
  if (!shop.canManage) return <P>この設定はオーナー専用です。</P>;

  const doClaim = async () => {
    const h = validateHandle(newHandle); if (!h) return;
    setClaiming(true);
    try { await claimHandle(h, { type: 'shop', ownerUid: user.uid, refId: shop.shopId!, displayName: shopName }); setHandle(h); await loadProfile(h, shopName); }
    catch { /* taken */ setClaimStatus('taken'); }
    finally { setClaiming(false); }
  };

  const onAvatar = async (file: File) => { try { setAvatar(await compressImage(file, { maxSize: 512 })); } catch { /* skip */ } };
  const save = async () => {
    if (!handle) return; setSaving(true); setSaved(false);
    try { await updateProfilePage(handle, { displayName, bio, avatar, sns: sns.filter((s) => s.url.trim()), published }); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Store · 公開ページ</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>店舗の公開ページ</h1>

      {!handle ? (
        <>
          <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 16px' }}>
            この店舗の公開ページURL（`/s/◯◯`）になる<b>店舗ID</b>を設定してください。
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontFamily: 'var(--noxa-font-mono)', fontSize: 13, color: 'var(--noxa-text-faint)' }}>noxa.egshugy.com/s/</div>
          <input value={newHandle} onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))} placeholder="club_noxa" className="noxa-input" />
          <div style={{ minHeight: 20, marginTop: 6, fontSize: 12 }}>
            {claimStatus === 'ok' && <span style={{ color: 'var(--noxa-status-success)' }}>✓ 使用できます</span>}
            {claimStatus === 'taken' && <span style={{ color: 'var(--noxa-accent-destructive)' }}>このIDは使用済みです</span>}
            {claimStatus === 'invalid' && <span style={{ color: 'var(--noxa-accent-destructive)' }}>英数字と「_」3〜20文字</span>}
          </div>
          <button type="button" onClick={doClaim} disabled={claiming || claimStatus !== 'ok'} className="noxa-btn noxa-btn-primary" style={{ padding: '12px 24px', fontSize: 15, marginTop: 8 }}>{claiming ? '設定中…' : '店舗IDを設定'}</button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <code style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 12, background: 'var(--noxa-surface-muted)', padding: '4px 8px', borderRadius: 6 }}>noxa.egshugy.com/s/{handle}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(`https://noxa.egshugy.com/s/${handle}`)} style={mini}>コピー</button>
            <Link href={`/s/${handle}`} target="_blank" style={mini}>開く ↗</Link>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: published ? 'rgba(123,232,161,0.10)' : 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{published ? '公開中' : '非公開'}</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', background: 'var(--noxa-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--noxa-text-faint)' }}>♠</span>}
            </div>
            <label style={{ ...mini, cursor: 'pointer' }}>ロゴ/画像を選択<input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAvatar(f); }} style={{ display: 'none' }} /></label>
          </div>
          <F label="表示名（店名）"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="noxa-input" maxLength={40} /></F>
          <F label="紹介文"><textarea value={bio} onChange={(e) => setBio(e.target.value)} className="noxa-input" rows={3} maxLength={150} style={{ resize: 'vertical' }} /></F>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 8 }}>SNS / 予約リンク</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sns.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <select value={s.platform} onChange={(e) => setSns((p) => p.map((x, j) => j === i ? { ...x, platform: e.target.value } : x))} className="noxa-input" style={{ width: 130, flex: 'none' }}>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                  <input value={s.url} onChange={(e) => setSns((p) => p.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" className="noxa-input" style={{ flex: 1 }} />
                  <button type="button" onClick={() => setSns((p) => p.filter((_, j) => j !== i))} style={{ ...mini, color: 'var(--noxa-status-error)' }}>×</button>
                </div>
              ))}
              <button type="button" onClick={() => setSns((p) => [...p, { platform: 'instagram', url: '' }])} style={{ ...mini, alignSelf: 'flex-start' }}>＋ リンクを追加</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
            <button type="button" onClick={save} disabled={saving} className="noxa-btn noxa-btn-primary" style={{ padding: '12px 24px', fontSize: 15 }}>{saving ? '保存中…' : '保存'}</button>
            {saved && <span style={{ color: 'var(--noxa-status-success)', fontSize: 13 }}>✓ 保存しました</span>}
          </div>
        </>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 6 }}>{label}</div>{children}</div>; }
function P({ children }: { children: React.ReactNode }) { return <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, padding: 8 }}>{children}</p>; }
const mini: React.CSSProperties = { display: 'inline-block', padding: '6px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'none' };

export default function Page() {
  return <AuthGuard>{(user) => <AccountShell user={user}><StoreProfileClient user={user} /></AccountShell>}</AuthGuard>;
}
