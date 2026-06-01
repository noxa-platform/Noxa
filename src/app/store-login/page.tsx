'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * 店舗デバイスログイン（ガワ）。共有タブレット用。オーナー個人垢を使わず、
 * 店舗 ID ＋ 端末プロファイル（フロア/初回パネル等）＋ PIN でログインする想定。
 * プロファイルごとに表示モジュールを allowlist 制限（給与/売掛/リスク客は端末で非表示）。
 * 実認証（Cloud Function で PIN 検証 → Custom Token）は別途実装。
 */
const mono = 'var(--noxa-font-mono)';

const PROFILES = [
  { id: 'floor', label: 'フロア端末', allow: 'POS・席回し・初回案内・勤怠打刻・送迎・在庫' },
  { id: 'panel', label: '初回案内パネル', allow: '初回案内（パネル表示）のみ' },
  { id: 'cashier', label: 'レジ / 締め端末', allow: 'POS・在庫・締め' },
];

export default function StoreLoginPage() {
  const [shopId, setShopId] = useState('');
  const [profile, setProfile] = useState(PROFILES[0].id);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = { width: '100%', minHeight: 48, padding: '10px 14px', borderRadius: 10, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16 };

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(20px,5vw,48px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)', width: 800, height: 460, background: 'radial-gradient(ellipse, rgba(139,92,246,0.16) 0%, transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 420, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 18, padding: 'clamp(22px,4vw,32px)', boxShadow: 'var(--noxa-glow-soft)' }}>
        <Link href="/" className="noxa-logo" style={{ fontSize: 24, display: 'block', marginBottom: 4 }}>N<em>o</em>xa</Link>
        <div className="noxa-eyebrow" style={{ marginBottom: 20 }}>店舗デバイスログイン</div>

        <form onSubmit={(e) => { e.preventDefault(); setMsg('デバイスログイン（デモ）。実認証は店舗管理パスワードを Cloud Function で検証して有効化します。'); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="shop" style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>店舗 ID</label>
            <input id="shop" value={shopId} onChange={(e) => setShopId(e.target.value)} required placeholder="店舗コード" style={inputStyle} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>端末プロファイル</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PROFILES.map((p) => {
                const active = profile === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => setProfile(p.id)} aria-pressed={active}
                    style={{ appearance: 'none', cursor: 'pointer', textAlign: 'left', padding: '12px 14px', borderRadius: 12, background: active ? 'rgba(139,92,246,0.12)' : 'transparent', border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, boxShadow: active ? 'var(--noxa-glow-ring)' : 'none' }}>
                    <div style={{ color: 'var(--noxa-text-primary)', fontSize: 14, fontWeight: 600 }}>{p.label}</div>
                    <div style={{ color: 'var(--noxa-text-muted)', fontSize: 11, marginTop: 2 }}>{p.allow}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="pin" style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>店舗管理パスワード（PIN）</label>
            <input id="pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" required placeholder="• • • • • •" style={{ ...inputStyle, letterSpacing: '0.4em', fontFamily: mono, textAlign: 'center' }} />
          </div>

          {msg && <p style={{ margin: 0, fontSize: 12, color: 'var(--noxa-status-info)', lineHeight: 1.6 }}>{msg}</p>}

          <button type="submit" className="noxa-btn noxa-btn-primary" style={{ appearance: 'none', cursor: 'pointer', minHeight: 50, borderRadius: 12, border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)' }}>
            この端末でログイン
          </button>
        </form>

        <p style={{ margin: '18px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)', lineHeight: 1.6, textAlign: 'center' }}>
          給与・売掛・リスク客は端末では表示されません。<br />
          オーナーの方は <Link href="/account/login" style={{ color: 'var(--noxa-accent-primary-ink)' }}>個人ログイン</Link>
        </p>
      </div>
    </main>
  );
}
