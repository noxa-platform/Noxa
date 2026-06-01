'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';

/**
 * 店舗登録（ガワ）。登録すると店舗運営モジュールが解放され、店舗端末用の
 * デバイスプロファイル（フロア/初回パネル等）＋ 店舗管理パスワードを設定する想定。
 * 実 Firestore 書き込み（shop_shops 作成）は権限・ルール確認のうえ別途実装。
 */
const mono = 'var(--noxa-font-mono)';
const labelStyle: React.CSSProperties = { fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--noxa-text-muted)' };
const inputStyle: React.CSSProperties = { width: '100%', minHeight: 46, padding: '10px 14px', borderRadius: 10, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16 };

const BIZ = ['キャバクラ', 'ホストクラブ', 'ラウンジ', 'ガールズバー', 'スナック', 'その他'];

async function createShop(uid: string, name: string, biz: string, area: string): Promise<void> {
  // yorulog createWorkspace（type='business'）と同等スキーマで shop_shops を作成。
  const ref = await addDoc(collection(db, 'shop_shops'), {
    name,
    ownerUid: uid,
    type: 'business',
    storeTypeName: biz,
    ...(area ? { area } : {}),
    anonymousTitleMode: false,
    reminderSettings: { birthdayDaysBefore: 3, inactiveDays: 14 },
    customTags: [] as string[],
    customVisitTypes: [] as { id: string; name: string }[],
    customPlaces: [] as { name: string }[],
    monthlyGoal: 0,
    aiContribution: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // オーナーをメンバーに
  await setDoc(doc(db, `shop_shops/${ref.id}/members/${uid}`), {
    role: 'owner',
    joinedAt: serverTimestamp(),
  });
}

function StoreNewForm({ user }: { user: User }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [biz, setBiz] = useState(BIZ[0]);
  const [area, setArea] = useState('');
  const [pin, setPin] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await createShop(user.uid, name.trim(), biz, area.trim());
      setDone(true);
      // 店舗運営モジュールが解放された状態でダッシュボードへ
      setTimeout(() => router.push('/account'), 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登録に失敗しました（権限をご確認ください）');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 600, height: 360, background: 'radial-gradient(ellipse, rgba(139,92,246,0.12) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', maxWidth: 560 }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li><li aria-hidden>·</li><li>店舗登録</li>
          </ol>
        </nav>
        <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Store</div>
        <h1 className="noxa-display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: '0 0 8px', fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>店舗を登録</h1>
        <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, margin: '0 0 24px', lineHeight: 1.6 }}>
          登録すると POS・席回し・勤怠・給与・初回案内・送迎・在庫・体験入店・予約VIP・売掛・リスク客共有が解放されます。
          店舗端末は<strong style={{ color: 'var(--noxa-text-primary)' }}>店舗管理パスワード（PIN）</strong>でデバイスログインします。
        </p>

        {done ? (
          <div style={{ padding: 20, borderRadius: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-status-success)' }}>
            <p style={{ margin: '0 0 8px', fontSize: 15, color: 'var(--noxa-status-success)' }}>店舗を登録しました</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>店舗運営モジュールが解放されました。ダッシュボードに移動します…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label htmlFor="name" style={labelStyle}>店名</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="例：Club Noxa" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label htmlFor="biz" style={labelStyle}>業態</label>
              <select id="biz" value={biz} onChange={(e) => setBiz(e.target.value)} style={inputStyle}>
                {BIZ.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label htmlFor="area" style={labelStyle}>エリア</label>
              <input id="area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="例：大阪・ミナミ" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label htmlFor="pin" style={labelStyle}>店舗管理パスワード（端末ログイン用 PIN）</label>
              <input id="pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6 桁の数字" style={{ ...inputStyle, letterSpacing: '0.3em', fontFamily: mono }} />
              <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)' }}>共有タブレットはこの PIN でログイン。給与・売掛・リスク客は端末では非表示。</span>
            </div>
            {err && <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-status-error)' }}>{err}</p>}
            <button type="submit" disabled={saving} className="noxa-btn noxa-btn-primary" style={{ appearance: 'none', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, minHeight: 48, borderRadius: 12, border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)' }}>
              {saving ? '登録中…' : '店舗を登録する'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function StoreNewPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><StoreNewForm user={user} /></AccountShell>}</AuthGuard>;
}
