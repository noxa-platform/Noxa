'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { useShopConfig, DEFAULT_MODULES, DEFAULT_TERMS, DEFAULT_TRANSPORT_TYPES, DEFAULT_INVENTORY_CATEGORIES, type ModuleCfg, type RoleWage, type SalesAttribution, type ChoiceItem } from '@/lib/shopConfig';
import { DEFAULT_NOMINATION_RULE, type NominationBasis, type NominationRule } from '@/lib/lexicon/nomination-rule';
import { shopCodeFromId } from '@/lib/shop-identity';
import { MembersSection } from '@/components/store/MembersSection';
import { describeFirestoreError } from '@/lib/firestore-error';

const TERM_KEYS: { key: string; label: string }[] = [
  { key: 'cast', label: 'スタッフの呼称' },
  { key: 'nomination', label: '指名（総称）' },
  { key: 'nominationPrimary', label: '本指名' },
  { key: 'nominationInhouse', label: '場内指名' },
  { key: 'nominationFree', label: 'フリー' },
  { key: 'dohan', label: '同伴' },
  { key: 'extension', label: '延長' },
  { key: 'escortHome', label: '送り' },
  { key: 'closingRound', label: '締め' },
  { key: 'restart', label: '飲み直し' },
  { key: 'displayName', label: '表示名' },
  { key: 'table', label: '卓 / 席' },
  { key: 'checkout', label: '会計' },
  { key: 'customer', label: 'お客様' },
];
const moduleLabel = (key: string) => DEFAULT_MODULES.find((d) => d.key === key)?.label ?? key;

function SettingsClient({ user }: { user: User }) {
  const { loading, shopId, canManage, config, configError, shopError, save } = useShopConfig(user);

  if (loading) return <P>読み込み中…</P>;
  if (!shopId) return <P>{shopError ? `${shopError} 店舗を確認できないため設定を開けません。画面を再読み込みしてください。` : '店舗が見つかりません。'}</P>;
  if (!canManage) return <P>この設定はオーナー専用です。</P>;
  // 設定が読めていないときにフォームを出さない（Day110）。
  // 既定値で初期化されたフォームを保存すると、店舗の設定が**既定値で上書き**されて消える。
  if (configError) {
    return (
      <P>
        <span role="alert" style={{ color: 'var(--noxa-status-error)' }}>{configError}</span>
        <br />いまの設定を読み取れていないため、編集フォームを表示していません（このまま保存すると店舗の設定が既定値で上書きされます）。画面を再読み込みしてください。
      </P>
    );
  }

  // 編集セッション: key=shopId でフォームを再マウントし、初期値は lazy initializer で確定
  // （useShopConfig の loading は config 到着で解けるため、この時点で config は確定済み。
  //  旧実装の「loading 解決時に effect で全フィールドへミラー」は set-state-in-effect 違反だった）
  return <SettingsForm key={shopId} shopId={shopId} myUid={user.uid} config={config} save={save} />;
}

function SettingsForm({ shopId, myUid, config, save }: {
  shopId: string; myUid: string; config: ReturnType<typeof useShopConfig>['config']; save: ReturnType<typeof useShopConfig>['save'];
}) {
  const [terms, setTerms] = useState<Record<string, string>>(() => config.terminology ?? {});
  const [roles, setRoles] = useState<RoleWage[]>(() => config.roles);
  const [modules, setModules] = useState<ModuleCfg[]>(() => config.modules);
  const [attr, setAttr] = useState<SalesAttribution>(() => config.salesAttribution);
  // 本指名の判定規則（呼び名ではなく「意味」の設定・Day126）
  const [nomRule, setNomRule] = useState<NominationRule>(() => config.nominationRule ?? DEFAULT_NOMINATION_RULE);
  const [setLen, setSetLen] = useState(() => config.setTimeLength);
  const [rotLen, setRotLen] = useState(() => config.rotationTimeLength);
  const [transportTypes, setTransportTypes] = useState<ChoiceItem[]>(() => config.transportTypes?.length ? config.transportTypes : DEFAULT_TRANSPORT_TYPES);
  const [invCats, setInvCats] = useState<ChoiceItem[]>(() => config.inventoryCategories?.length ? config.inventoryCategories : DEFAULT_INVENTORY_CATEGORIES);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 保存の失敗（旧実装は catch が無く無音だった）
  const [saveError, setSaveError] = useState<string | null>(null);

  // 未保存インジケータ: マウント時の内容と比較して導出（PosConfig の Day15 事故対策の横展開。
  // 保存成功でベースラインを更新）
  const draftJson = JSON.stringify({ terms, roles, modules, attr, nomRule, setLen, rotLen, transportTypes, invCats });
  const [baselineJson, setBaselineJson] = useState(() => draftJson);
  const dirty = draftJson !== baselineJson;

  // 未保存のままタブを閉じる/リロードを確認（SPA 内遷移は対象外＝既知の限界）
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const moveModule = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= modules.length) return;
    const next = [...modules]; [next[i], next[j]] = [next[j], next[i]]; setModules(next);
  };

  const onSave = async () => {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      await save({ terminology: terms, roles: roles.filter((r) => r.name.trim()), modules, salesAttribution: attr, nominationRule: nomRule, setTimeLength: Math.max(1, setLen), rotationTimeLength: Math.max(1, rotLen), transportTypes: transportTypes.filter((t) => t.label.trim()), inventoryCategories: invCats.filter((t) => t.label.trim()) });
      setBaselineJson(draftJson);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // 旧実装は catch が無く、権限/通信エラーでも「保存しました」が出ないだけの無音だった
      // （未保存のまま離脱すると設定が消えたように見える）
      setSaveError(describeFirestoreError(e, '店舗設定の保存'));
    } finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Store · 設定</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>店舗カスタム設定</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 22px' }}>
        業種・店舗に合わせて呼称・役職・モジュール構成・売上ルールを編集できます。料金/税/メニュー/卓名は <Link href="/pos/settings" style={{ color: 'var(--noxa-accent-primary-ink)' }}>POS設定</Link> で。
      </p>

      {/* 店舗コード（改名しても不変の識別子・Day126） */}
      <Section title="店舗コード">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <code style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 18, letterSpacing: 1, padding: '8px 14px', borderRadius: 10, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)' }}>{shopCodeFromId(shopId)}</code>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(shopCodeFromId(shopId)); }}
            style={{ padding: '8px 14px', borderRadius: 10, cursor: 'pointer', background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12 }}>コピー</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>
          店名や業態を変えても変わらない、この店舗の永久的な番号です。サポートへの問い合わせや、店舗を増やしたとき・統合したときの照合に使います。
        </p>
      </Section>

      {/* メンバー・招待 */}
      <Section title="メンバーと招待">
        <MembersSection shopId={shopId} myUid={myUid} />
      </Section>

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

      {/* 在庫カテゴリ */}
      <Section title="在庫カテゴリ（在庫品目の区分）">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invCats.map((t, i) => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={t.label} onChange={(e) => setInvCats((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="カテゴリ名（例: ボトル）" className="noxa-input" style={{ flex: 1 }} />
              <button type="button" onClick={() => setInvCats((p) => p.filter((_, j) => j !== i))} style={mini}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setInvCats((p) => [...p, { id: `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: '' }])} style={{ ...mini, alignSelf: 'flex-start' }}>＋ カテゴリを追加</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>在庫画面の区分タブ・品目登録の選択肢になります。削除しても登録済み品目は残ります。</p>
      </Section>

      {/* 送迎タイプ */}
      <Section title="送迎タイプ（送迎リクエストの種別）">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {transportTypes.map((t, i) => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={t.label} onChange={(e) => setTransportTypes((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="種別名（例: 同伴PU）" className="noxa-input" style={{ flex: 1 }} />
              <button type="button" onClick={() => setTransportTypes((p) => p.filter((_, j) => j !== i))} style={mini}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setTransportTypes((p) => [...p, { id: `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: '' }])} style={{ ...mini, alignSelf: 'flex-start' }}>＋ 送迎タイプを追加</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>送迎画面のリクエスト種別の選択肢になります。削除しても過去の記録は残ります。</p>
      </Section>

      {/* 売上の付け方 */}
      <Section title="売上の付け方（会計時の帰属）">
        <div style={{ display: 'flex', gap: 8 }}>
          {([['mainCast', '担当キャストに付ける'], ['operator', 'レジ操作者に付ける']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setAttr(v)} style={{ flex: 1, padding: '10px 14px', borderRadius: 12, cursor: 'pointer', background: attr === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: attr === v ? '#fff' : 'var(--noxa-text-primary)', border: `1px solid ${attr === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, fontSize: 13 }}>{label}</button>
          ))}
        </div>
      </Section>

      {/* 本指名の判定（呼び名ではなく意味の設定・Day126） */}
      <Section title="本指名の判定（この店では何を本指名と数えるか）">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([
            ['tableMainHost', '卓の本指名に入っている担当', '席回しで「本指名」に指定した担当だけを本指名として数えます。'],
            ['customerMainCast', '顧客カルテの担当と同じ', '前回から同じ担当が続いている客を本指名として数えます。'],
            ['either', 'どちらかを満たせば本指名', '上の2つのどちらかに当てはまれば本指名として数えます。'],
          ] as const).map(([v, label, desc]) => (
            <button key={v} type="button" onClick={() => setNomRule((p) => ({ ...p, basis: v as NominationBasis }))}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: 'pointer', background: nomRule.basis === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: nomRule.basis === v ? '#fff' : 'var(--noxa-text-primary)', border: `1px solid ${nomRule.basis === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{label}</span>
              <span style={{ display: 'block', fontSize: 11, opacity: 0.85, marginTop: 2 }}>{desc}</span>
            </button>
          ))}
        </div>
        {nomRule.basis !== 'tableMainHost' && (
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>顧客カルテが無い（初回など、続きかどうか確かめられない）とき</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {([['inhouse', '場内指名として数える'], ['primary', '本指名として数える']] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setNomRule((p) => ({ ...p, firstVisitAs: v }))}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', background: nomRule.firstVisitAs === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: nomRule.firstVisitAs === v ? '#fff' : 'var(--noxa-text-primary)', border: `1px solid ${nomRule.firstVisitAs === v ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, fontSize: 12 }}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>
          同じ「本指名」でも数え方は店によって違い、指名料とバックが変わります。ここを間違えると数字は出るのに金額だけが静かにズレるため、実際の運用に合わせてください。
        </p>
      </Section>

      {/* 席回し既定 */}
      <Section title="席回し（既定セット長・ローテ間隔）">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>1セット長（分）</span>
            <input type="number" value={setLen} onChange={(e) => setSetLen(Number(e.target.value))} className="noxa-input" style={{ width: 140 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>卓内ローテ間隔（分）</span>
            <input type="number" value={rotLen} onChange={(e) => setRotLen(Number(e.target.value))} className="noxa-input" style={{ width: 140 }} /></label>
        </div>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '8px 0 0' }}>新規に作成する卓の既定値。各卓の個別設定は席回し画面の卓詳細から変更できます。</p>
      </Section>

      {saveError && (
        <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '8px 0 0', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{saveError} 入力内容はそのまま残っています。</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button type="button" onClick={onSave} disabled={saving} className="noxa-btn noxa-btn-primary" style={{ padding: '12px 28px', fontSize: 15 }}>{saving ? '保存中…' : '設定を保存'}</button>
        {saved && <span style={{ color: 'var(--noxa-status-success)', fontSize: 13 }}>✓ 保存しました</span>}
        {dirty && !saving && !saved && !saveError && <span style={{ color: 'var(--noxa-status-warning)', fontSize: 13 }}>● 未保存の変更があります</span>}
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
