'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { useShopConfig, DEFAULT_MODULES, DEFAULT_TERMS, type ModuleCfg, type RoleWage, type SalesAttribution } from '@/lib/shopConfig';

const TERM_KEYS: { key: string; label: string }[] = [
  { key: 'cast', label: 'スタッフの呼称' },
  { key: 'nomination', label: '指名' },
  { key: 'displayName', label: '表示名' },
  { key: 'table', label: '卓 / 席' },
  { key: 'checkout', label: '会計' },
  { key: 'customer', label: 'お客様' },
];
const moduleLabel = (key: string) => DEFAULT_MODULES.find((d) => d.key === key)?.label ?? key;

function SettingsClient({ user }: { user: User }) {
  const { loading, shopId, canManage, config, save } = useShopConfig(user);
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<RoleWage[]>([]);
  const [modules, setModules] = useState<ModuleCfg[]>([]);
  const [attr, setAttr] = useState<SalesAttribution>('mainCast');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loading) return;
    setTerms(config.terminology ?? {});
    setRoles(config.roles);
    setModules(config.modules);
    setAttr(config.salesAttribution);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <P>読み込み中…</P>;
  if (!shopId) return <P>店舗が見つかりません。</P>;
  if (!canManage) return <P>この設定はオーナー専用です。</P>;

  const moveModule = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= modules.length) return;
    const next = [...modules]; [next[i], next[j]] = [next[j], next[i]]; setModules(next);
  };

  const onSave = async () => {
    setSaving(true); setSaved(false);
    try {
      await save({ terminology: terms, roles: roles.filter((r) => r.name.trim()), modules, salesAttribution: attr });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Store · 設定</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>店舗カスタム設定</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 22px' }}>
        業種・店舗に合わせて呼称・役職・モジュール構成・売上ルールを編集できます。料金/税/メニュー/卓名は <Link href="/pos/settings" style={{ color: 'var(--noxa-accent-primary-ink)' }}>POS設定</Link> で。
      </p>

      {/* 用語辞書 */}
      <Section title="用語（呼称）">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
          {TERM_KEYS.map((t) => (
            <label key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{t.label}</span>
              <input value={terms[t.key] ?? ''} onChange={(e) => setTerms((p) => ({ ...p, [t.key]: e.target.value }))} placeholder={DEFAULT_TERMS[t.key]} className="noxa-input" />
            </label>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>空欄は業種の既定（例: コンカフェ→推し/キャラ名/席）が使われます。</p>
      </Section>

      {/* 役職＆既定時給 */}
      <Section title="役職と既定時給">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roles.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input value={r.name} onChange={(e) => setRoles((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="役職名" className="noxa-input" style={{ flex: 1 }} />
              <input type="number" value={r.wage} onChange={(e) => setRoles((p) => p.map((x, j) => j === i ? { ...x, wage: Number(e.target.value) } : x))} placeholder="時給" className="noxa-input" style={{ width: 120 }} />
              <button type="button" onClick={() => setRoles((p) => p.filter((_, j) => j !== i))} style={mini}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setRoles((p) => [...p, { name: '', wage: 0 }])} style={{ ...mini, alignSelf: 'flex-start' }}>＋ 役職を追加</button>
        </div>
      </Section>

      {/* モジュール構成 */}
      <Section title="モジュール構成（表示・並び・名称）">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {modules.map((m, i) => (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', opacity: m.enabled ? 1 : 0.5 }}>
              <button type="button" onClick={() => moveModule(i, -1)} disabled={i === 0} style={iconMini}>↑</button>
              <button type="button" onClick={() => moveModule(i, 1)} disabled={i === modules.length - 1} style={iconMini}>↓</button>
              <input value={m.label ?? ''} onChange={(e) => setModules((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={moduleLabel(m.key)} className="noxa-input" style={{ flex: 1 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--noxa-text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={m.enabled} onChange={(e) => setModules((p) => p.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} />表示
              </label>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>名称は空欄で既定名。非表示にするとサイドメニューから消えます（データは保持）。</p>
      </Section>

      {/* 売上の付け方 */}
      <Section title="売上の付け方（会計時の帰属）">
        <div style={{ display: 'flex', gap: 8 }}>
          {([['mainCast', '担当キャストに付ける'], ['operator', 'レジ操作者に付ける']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setAttr(v)} style={{ flex: 1, padding: '10px 14px', borderRadius: 12, cursor: 'pointer', background: attr === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: attr === v ? '#fff' : 'var(--noxa-text-primary)', border: `1px solid ${attr === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, fontSize: 13 }}>{label}</button>
          ))}
        </div>
      </Section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button type="button" onClick={onSave} disabled={saving} className="noxa-btn noxa-btn-primary" style={{ padding: '12px 28px', fontSize: 15 }}>{saving ? '保存中…' : '設定を保存'}</button>
        {saved && <span style={{ color: 'var(--noxa-status-success)', fontSize: 13 }}>✓ 保存しました</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24, padding: 16, borderRadius: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)' }}>
      <h2 style={{ fontSize: 15, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500, margin: '0 0 12px' }}>{title}</h2>
      {children}
    </section>
  );
}
function P({ children }: { children: React.ReactNode }) { return <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, padding: 8 }}>{children}</p>; }
const mini: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12, cursor: 'pointer' };
const iconMini: React.CSSProperties = { width: 28, height: 28, borderRadius: 7, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12, cursor: 'pointer', flex: 'none' };

export default function Page() {
  return <AuthGuard>{(user) => <AccountShell user={user}><SettingsClient user={user} /></AccountShell>}</AuthGuard>;
}
