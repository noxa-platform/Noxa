'use client';

import { useState } from 'react';
import Link from 'next/link';
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

function StoreNewForm() {
  const [name, setName] = useState('');
  const [biz, setBiz] = useState(BIZ[0]);
  const [area, setArea] = useState('');
  const [pin, setPin] = useState('');
  const [done, setDone] = useState(false);

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
            <p style={{ margin: '0 0 8px', fontSize: 15, color: 'var(--noxa-status-success)' }}>登録イメージを確認しました（デモ）</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>実登録（shop_shops 作成・端末プロファイル発行）は権限/ルール確認のうえ有効化します。</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setDone(true); }} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
            <button type="submit" className="noxa-btn noxa-btn-primary" style={{ appearance: 'none', cursor: 'pointer', minHeight: 48, borderRadius: 12, border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)' }}>
              店舗を登録する
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function StoreNewPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><StoreNewForm /></AccountShell>}</AuthGuard>;
}
