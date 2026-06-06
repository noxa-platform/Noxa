'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { linkedProviderIds, linkGoogle, linkApple, linkEmailPassword, unlinkProvider } from '@/lib/auth';

const PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: 'google.com', label: 'Google', hint: 'Google アカウントでログイン' },
  { id: 'apple.com', label: 'Apple', hint: 'Apple ID でログイン' },
  { id: 'password', label: 'メール / パスワード', hint: 'メールアドレスとパスワードでログイン' },
];

function ConnectionsClient({ user }: { user: User }) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');

  const refresh = async () => { await user.reload(); setTick((n) => n + 1); };
  const linked = linkedProviderIds(user);
  const isLineAccount = user.uid.startsWith('line_');

  const handleErr = (e: unknown) => {
    const code = (e as { code?: string })?.code ?? (e as Error)?.message ?? '';
    if (code === 'auth/credential-already-in-use') return 'このログイン方法は既に別のアカウントで使われています。下の「アカウント統合」で1つにまとめられます。';
    if (code === 'auth/email-already-in-use') return 'このメールは既に別アカウントで使用されています。';
    if (code === 'LAST_PROVIDER') return '最低1つのログイン方法は残す必要があります。';
    if (code === 'auth/requires-recent-login') return 'セキュリティのため、一度ログインし直してから操作してください。';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
    return '操作に失敗しました。';
  };

  const link = async (id: string) => {
    setBusy(id); setMsg(null);
    try {
      if (id === 'google.com') await linkGoogle(user);
      else if (id === 'apple.com') await linkApple(user);
      await refresh();
      setMsg({ kind: 'ok', text: '連携しました。' });
    } catch (e) { const t = handleErr(e); if (t) setMsg({ kind: 'err', text: t }); }
    finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('この連携を解除しますか？')) return;
    setBusy(id); setMsg(null);
    try { await unlinkProvider(user, id); await refresh(); setMsg({ kind: 'ok', text: '解除しました。' }); }
    catch (e) { const t = handleErr(e); if (t) setMsg({ kind: 'err', text: t }); }
    finally { setBusy(null); }
  };

  const setPassword = async () => {
    if (!user.email) { setMsg({ kind: 'err', text: 'メールアドレスが無いアカウントには設定できません。' }); return; }
    if (pw.length < 8) { setMsg({ kind: 'err', text: 'パスワードは8文字以上にしてください。' }); return; }
    setBusy('password'); setMsg(null);
    try { await linkEmailPassword(user, user.email, pw); await refresh(); setPw(''); setPwOpen(false); setMsg({ kind: 'ok', text: 'パスワードを設定しました。' }); }
    catch (e) { const t = handleErr(e); if (t) setMsg({ kind: 'err', text: t }); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Account · Connections</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>ログイン方法・連携</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 20px' }}>
        このアカウントに複数のログイン方法を紐付けられます。どの方法でも同じアカウントに入れます（1ユーザー＝1アカウント）。
      </p>

      {msg && (
        <p style={{ fontSize: 13, lineHeight: 1.6, padding: '10px 12px', borderRadius: 10, marginBottom: 16, background: msg.kind === 'ok' ? 'rgba(123,232,161,0.10)' : 'rgba(226,109,109,0.10)', color: msg.kind === 'ok' ? 'var(--noxa-status-success)' : 'var(--noxa-accent-destructive)', border: '1px solid var(--noxa-border)' }}>{msg.text}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* LINE（custom token のため参照表示のみ） */}
        <div style={row}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ ...badge, background: '#06C755', color: '#fff' }}>L</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>LINE</div>
              <div style={{ fontSize: 11, color: 'var(--noxa-text-faint)' }}>LINE でログイン</div>
            </div>
          </div>
          <span style={{ fontSize: 12, color: isLineAccount ? 'var(--noxa-status-success)' : 'var(--noxa-text-faint)' }}>
            {isLineAccount ? '連携済み' : '— '}
          </span>
        </div>

        {PROVIDERS.map((p) => {
          const on = linked.includes(p.id);
          return (
            <div key={p.id} style={row}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={badge}>{p.label[0]}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--noxa-text-faint)' }}>{p.hint}</div>
                </div>
              </div>
              {on ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--noxa-status-success)' }}>連携済み</span>
                  <button type="button" onClick={() => remove(p.id)} disabled={busy === p.id} style={btnGhost}>解除</button>
                </div>
              ) : p.id === 'password' ? (
                <button type="button" onClick={() => setPwOpen((v) => !v)} disabled={busy === p.id || !user.email} style={btnLink}>パスワードを設定</button>
              ) : (
                <button type="button" onClick={() => link(p.id)} disabled={busy === p.id} style={btnLink}>{busy === p.id ? '…' : '連携する'}</button>
              )}
            </div>
          );
        })}

        {pwOpen && !linked.includes('password') && (
          <div style={{ ...row, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{user.email} にパスワードを設定（8文字以上）</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="noxa-input" placeholder="新しいパスワード" style={{ flex: 1 }} />
              <button type="button" onClick={setPassword} disabled={busy === 'password'} className="noxa-btn noxa-btn-primary" style={{ padding: '0 18px' }}>設定</button>
            </div>
          </div>
        )}
      </div>

      {/* アカウント統合への導線（誤って2つ作った場合） */}
      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--noxa-divider)' }}>
        <h2 style={{ fontSize: 16, fontFamily: 'var(--noxa-font-display-jp)', margin: '0 0 6px' }}>アカウントを2つ作ってしまった場合</h2>
        <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)', lineHeight: 1.7, margin: '0 0 12px' }}>
          別の方法で誤って2つ目のアカウントを作ってしまったときは、こちらでデータを今のアカウントに統合できます。
        </p>
        <Link href="/account/merge" className="noxa-btn noxa-btn-secondary" style={{ display: 'inline-block', padding: '10px 18px', fontSize: 14 }}>アカウント統合へ</Link>
      </div>
    </div>
  );
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)' };
const badge: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: 'none' };
const btnLink: React.CSSProperties = { padding: '8px 16px', borderRadius: 10, cursor: 'pointer', background: 'var(--noxa-accent-primary)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600 };
const btnGhost: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)', fontSize: 12 };

export default function Page() {
  return <AuthGuard>{(user) => <AccountShell user={user}><ConnectionsClient user={user} /></AccountShell>}</AuthGuard>;
}
