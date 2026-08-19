'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { getActiveShop, pickShopId } from '@/lib/workspace';
import { activeMembershipIds } from '@/lib/membership';
import type { StoreConfig, MenuItemDef, MenuCategoryDef, PinnedOrderDef } from '@/lib/pos/types';
import { createDefaultStoreConfig } from '@/lib/pos/defaultConfig';
import { previewConfig, diffPreview } from '@/lib/pos/preview';
import { describeFirestoreError } from '@/lib/firestore-error';
import { describeOwnerSettingDenied } from '@/lib/permission-guidance';

/**
 * POS 設定エディタ — 店舗ごとの料金・メニュー・税/手数料・クイック・カテゴリ・半額ルールを
 * 編集して shop_shops/{shopId}/pos_config/active に保存。どの業態にも合わせられる。
 * オーナー（pos_config 書込可）専用。
 */

const mono = 'var(--noxa-font-mono)';

export function PosConfigClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<StoreConfig | null>(null);
  // 保存済みの設定（編集中の cfg との差額を出すため。Day127）
  const [savedCfg, setSavedCfg] = useState<StoreConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /**
   * 自分が「オーナーではないが在籍している」か（Day114）。
   * この画面は所有クエリしか見ないため、店長・経理・キャストは全員 `shops.empty` に落ちる。
   * 旧実装はそこで一律に「店舗を登録してください」と案内しており、**在籍中のスタッフに
   * 自分の店を作れと誘導**していた（Day109 の誤誘導と同型）。
   * null は「所属を確認できていない」＝どちらとも言い切らない。
   */
  const [isMember, setIsMember] = useState<boolean | null>(null);

  // 未保存の変更がある間はタブ閉じ/リロードを確認（料金表の編集途中の入力消失防止）
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const shops = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        if (!alive) return;
        if (shops.empty) {
          // オーナーではない＝在籍しているのか本当に店が無いのかで案内が真逆になる
          const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`))
            .then((s) => activeMembershipIds(s.docs).length > 0) // 在籍中だけを数える（Day122）
            .catch(() => null); // 確認できないときは断定しない（Day109）
          if (alive) { setIsMember(ms); setLoading(false); }
          return;
        }
        // アクティブ店舗を尊重（WorkspaceSwitcher）。旧実装は「最初の店」固定で、
        // 複数店舗オーナーが選択中でない店の料金設定を書き換える事故があった
        const ownedIds = shops.docs.map((d) => d.id);
        const { shopId: picked } = pickShopId(ownedIds, [], getActiveShop());
        const id = picked && ownedIds.includes(picked) ? picked : ownedIds[0];
        setShopId(id);
        const shopDoc = shops.docs.find((d) => d.id === id);
        const snap = await getDoc(doc(db, `shop_shops/${id}/pos_config/active`));
        const base = createDefaultStoreConfig('active', shopDoc?.data().name as string | undefined);
        const loaded = snap.exists() ? ({ ...base, ...(snap.data() as Partial<StoreConfig>) } as StoreConfig) : base;
        setCfg(loaded);
        setSavedCfg(loaded);
      } catch (e) { if (alive) setErr(describeFirestoreError(e, '料金設定の読み込み')); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [user.uid]);

  const update = (patch: Partial<StoreConfig>) => { setCfg((c) => (c ? { ...c, ...patch } : c)); setDirty(true); setSavedAt(null); };

  const save = async () => {
    if (!shopId || !cfg) return;
    setSaving(true); setErr(null);
    try {
      await setDoc(doc(db, `shop_shops/${shopId}/pos_config/active`), { ...cfg, id: 'active', updatedAt: serverTimestamp() }, { merge: true });
      const d = new Date();
      setSavedAt(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      setSavedCfg(cfg);
      setDirty(false);
    } catch (e) { setErr(describeFirestoreError(e, '料金設定の保存')); }
    finally { setSaving(false); }
  };

  if (loading) return <Shell><div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div></Shell>;
  if (!shopId || !cfg) {
    // 「確認できなかった」を「オーナーではない」と言い切らない（Day113・Day109 と同型）。
    // 旧実装は所有クエリが落ちても err を描画せずこの分岐に落ち、**自分の店を持つオーナーに
    // 「オーナー専用です。店舗を登録してください」**と表示していた（原因も出ない）。
    if (err) {
      return (
        <Shell>
          <Empty>
            <span role="alert" style={{ color: 'var(--noxa-status-error)' }}>{err}</span>
            <br />店舗と権限を確認できないため、料金設定を開けません。画面を再読み込みしてください。
          </Empty>
        </Shell>
      );
    }
    // 在籍しているスタッフに「店舗を登録してください」は誤誘導。自分にできる次の一手を出す（Day114）
    if (isMember) {
      return (
        <Shell>
          <Empty>
            {describeOwnerSettingDenied('料金・メニュー')}
            <br /><Link href="/pos" style={{ color: 'var(--noxa-accent-primary-ink)' }}>POS へ戻る</Link>
          </Empty>
        </Shell>
      );
    }
    if (isMember === null) {
      // 所属を確認できていない＝「店が無い」前提の案内を出さない
      return (
        <Shell>
          <Empty>
            料金・メニューの設定はオーナー専用です。所属を確認できなかったため、画面を再読み込みしてください。
            <br /><Link href="/pos" style={{ color: 'var(--noxa-accent-primary-ink)' }}>POS へ戻る</Link>
          </Empty>
        </Shell>
      );
    }
    return <Shell><Empty>POS 設定はオーナー専用です。<Link href="/store/new" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗を登録</Link>してください。</Empty></Shell>;
  }

  return (
    <Shell>
      {/* 保存バー */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', padding: '8px 0', marginBottom: 12, background: 'var(--noxa-bg-base)' }}>
        {err && <span style={{ fontSize: 12, color: 'var(--noxa-status-error)', marginRight: 'auto' }}>{err}</span>}
        {dirty && !err && <span style={{ fontSize: 11, color: 'var(--noxa-status-warning)', fontFamily: mono, marginRight: 'auto' }}>● 未保存の変更があります</span>}
        {savedAt && !dirty && <span style={{ fontSize: 11, color: 'var(--noxa-status-success)', fontFamily: mono }}>保存しました {savedAt}</span>}
        <button type="button" onClick={save} disabled={saving} className="noxa-btn noxa-btn-primary"
          style={{ ...primaryBtn, width: 'auto', padding: '0 22px', opacity: saving ? 0.7 : 1 }}>{saving ? '保存中…' : '保存'}</button>
      </div>

      {/* 基本 */}
      <Section title="基本">
        <Grid>
          <TextF label="店名" value={cfg.storeName} onChange={(v) => update({ storeName: v })} />
          <NumF label="税/サービス料 %" value={Math.round(cfg.taxRate * 100)} onChange={(v) => update({ taxRate: v / 100 })} />
          <NumF label="同伴料" value={cfg.dohanFee} onChange={(v) => update({ dohanFee: v })} />
          <NumF label="複数指名料/人" value={cfg.additionalNominationFee} onChange={(v) => update({ additionalNominationFee: v })} />
          <NumF label="閉店時刻(24h+)" value={cfg.closingHour} onChange={(v) => update({ closingHour: v })} hint="例: 翌1時=25" />
          <NumF label="初回0オーダー税率%" value={Math.round(cfg.initialNoOrderTaxRate * 100)} onChange={(v) => update({ initialNoOrderTaxRate: v / 100 })} />
        </Grid>
      </Section>

      {/* テスト伝票プレビュー（保存前に金額で確かめる・Day127） */}
      <Section title="この設定だといくらになるか">
        <p style={{ fontSize: 12, color: 'var(--noxa-text-muted)', margin: '0 0 10px' }}>
          実際の会計と同じ計算で、代表的なパターンの合計を出しています。保存前にここで確かめてください。
        </p>
        {savedCfg && dirty && (() => {
          const diff = diffPreview(savedCfg, cfg);
          if (diff.length === 0) return null;
          return (
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,193,7,0.10)', border: '1px solid var(--noxa-status-warning)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>保存すると会計金額が変わります</div>
              {diff.map((d) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, fontFamily: mono }}>
                  <span>{d.label}</span>
                  <span>¥{d.before.toLocaleString('ja-JP')} → ¥{d.after.toLocaleString('ja-JP')}（{d.delta > 0 ? '+' : ''}{d.delta.toLocaleString('ja-JP')}）</span>
                </div>
              ))}
            </div>
          );
        })()}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {previewConfig(cfg).map((p) => (
            <div key={p.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{p.label}</span>
                <span style={{ fontSize: 15, fontFamily: mono }}>¥{p.result.currentTotal.toLocaleString('ja-JP')}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--noxa-text-faint)', marginTop: 2 }}>{p.note}</div>
              <div style={{ fontSize: 11, color: 'var(--noxa-text-muted)', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {p.result.breakdown.filter((b) => !b.isTotal).map((b, i) => (
                  <span key={i}>{b.label} ¥{b.amount.toLocaleString('ja-JP')}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 料金 */}
      <Section title="料金表">
        <SubTitle>通常</SubTitle>
        <Grid>
          <NumF label="早セット" value={cfg.regularPricing.earlySet} onChange={(v) => update({ regularPricing: { ...cfg.regularPricing, earlySet: v } })} />
          <NumF label="遅セット" value={cfg.regularPricing.lateSet} onChange={(v) => update({ regularPricing: { ...cfg.regularPricing, lateSet: v } })} />
          <NumF label="延長" value={cfg.regularPricing.ext} onChange={(v) => update({ regularPricing: { ...cfg.regularPricing, ext: v } })} />
          <NumF label="指名" value={cfg.regularPricing.nom} onChange={(v) => update({ regularPricing: { ...cfg.regularPricing, nom: v } })} />
          <NumF label="T.C" value={cfg.regularPricing.tc} onChange={(v) => update({ regularPricing: { ...cfg.regularPricing, tc: v } })} />
          <NumF label="早/遅 境界時" value={cfg.regularPricing.thresholdHour} onChange={(v) => update({ regularPricing: { ...cfg.regularPricing, thresholdHour: v } })} hint="例: 21" />
        </Grid>
        {([['initialPricing', '初回'], ['rWithinPricing', 'R内'], ['rAfterPricing', 'R後']] as const).map(([key, label]) => (
          <div key={key}>
            <SubTitle>{label}</SubTitle>
            <Grid>
              <NumF label="セット" value={cfg[key].set} onChange={(v) => update({ [key]: { ...cfg[key], set: v } } as Partial<StoreConfig>)} />
              <NumF label="延長" value={cfg[key].ext} onChange={(v) => update({ [key]: { ...cfg[key], ext: v } } as Partial<StoreConfig>)} />
              <NumF label="指名" value={cfg[key].nom} onChange={(v) => update({ [key]: { ...cfg[key], nom: v } } as Partial<StoreConfig>)} />
              <NumF label="T.C" value={cfg[key].tc} onChange={(v) => update({ [key]: { ...cfg[key], tc: v } } as Partial<StoreConfig>)} />
            </Grid>
          </div>
        ))}
        <SubTitle>初回セット価格の選択肢</SubTitle>
        <TextF label="カンマ区切り" value={cfg.initialSetPriceOptions.join(',')} onChange={(v) => update({ initialSetPriceOptions: v.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) })} />
      </Section>

      {/* 卓名 */}
      <Section title="卓名（初期作成に使用）">
        <TextF label="カンマ区切り" value={cfg.tableNames.join(',')} onChange={(v) => update({ tableNames: v.split(',').map((s) => s.trim()).filter(Boolean) })} hint="既存の卓は席回しで管理。ここは初期作成用" />
      </Section>

      {/* メニュー */}
      <Section title={`メニュー（${cfg.menuItems.length}品）`}>
        <ListEditor
          rows={cfg.menuItems}
          onChange={(rows) => update({ menuItems: rows })}
          empty={{ name: '', price: 0 } as MenuItemDef}
          render={(row, set) => (
            <>
              <input value={row.name} onChange={(e) => set({ ...row, name: e.target.value })} placeholder="品名" style={{ ...cell, flex: 2 }} />
              <input type="number" value={row.price} onChange={(e) => set({ ...row, price: Number(e.target.value) })} placeholder="価格" style={{ ...cell, width: 90 }} />
              <Chk label="半額可" checked={!!row.canHalfOff} onChange={(b) => set({ ...row, canHalfOff: b })} />
              <Chk label="価格入力" checked={!!row.isCustom} onChange={(b) => set({ ...row, isCustom: b })} />
            </>
          )}
        />
      </Section>

      {/* カテゴリ */}
      <Section title={`カテゴリ（${cfg.menuCategories.length}）`}>
        <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '0 0 8px' }}>「品名」は上のメニュー品名をカンマ区切りで。</p>
        <ListEditor
          rows={cfg.menuCategories}
          onChange={(rows) => update({ menuCategories: rows })}
          empty={{ id: '', label: '', items: [] } as MenuCategoryDef}
          render={(row, set) => (
            <>
              <input value={row.label} onChange={(e) => set({ ...row, label: e.target.value, id: row.id || e.target.value })} placeholder="カテゴリ名" style={{ ...cell, flex: 1 }} />
              <input value={row.items.join(',')} onChange={(e) => set({ ...row, items: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="品名,品名,…" style={{ ...cell, flex: 3 }} />
            </>
          )}
        />
      </Section>

      {/* クイック（ピン留め） */}
      <Section title={`クイック（缶モノ等・${cfg.pinnedOrders.length}）`}>
        <ListEditor
          rows={cfg.pinnedOrders}
          onChange={(rows) => update({ pinnedOrders: rows })}
          empty={{ name: '', price: 0 } as PinnedOrderDef}
          render={(row, set) => (
            <>
              <input value={row.name} onChange={(e) => set({ ...row, name: e.target.value })} placeholder="品名" style={{ ...cell, flex: 2 }} />
              <input type="number" value={row.price} onChange={(e) => set({ ...row, price: Number(e.target.value) })} placeholder="価格" style={{ ...cell, width: 90 }} />
              <Chk label="半額可" checked={!!row.canHalfOff} onChange={(b) => set({ ...row, canHalfOff: b })} />
              <Chk label="既定半額" checked={!!row.defaultIsHalfOff} onChange={(b) => set({ ...row, defaultIsHalfOff: b })} />
            </>
          )}
        />
      </Section>

      {/* 詳細（半額/ゴールド） */}
      <Section title="詳細（半額ルール・ゴールド）">
        <Grid>
          <NumF label="ゴールド セット" value={cfg.goldTicket.setOverride} onChange={(v) => update({ goldTicket: { ...cfg.goldTicket, setOverride: v } })} />
          <NumF label="ゴールド 延長" value={cfg.goldTicket.extOverride} onChange={(v) => update({ goldTicket: { ...cfg.goldTicket, extOverride: v } })} />
          <NumF label="缶の半額特価" value={cfg.halfOffRules.canSpecialPrice} onChange={(v) => update({ halfOffRules: { ...cfg.halfOffRules, canSpecialPrice: v } })} />
          <NumF label="青→金 下限" value={cfg.halfOffRules.blueToGoldMinPrice} onChange={(v) => update({ halfOffRules: { ...cfg.halfOffRules, blueToGoldMinPrice: v } })} />
          <NumF label="青→金 上限" value={cfg.halfOffRules.blueToGoldMaxPrice} onChange={(v) => update({ halfOffRules: { ...cfg.halfOffRules, blueToGoldMaxPrice: v } })} />
        </Grid>
        <SubTitle>半額対象シャンパン（カンマ区切り）</SubTitle>
        <TextF label="" value={cfg.halfOffRules.champagneNames.join(',')} onChange={(v) => update({ halfOffRules: { ...cfg.halfOffRules, champagneNames: v.split(',').map((s) => s.trim()).filter(Boolean) } })} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13 }}>
          <input type="checkbox" checked={cfg.halfOffRules.initialROneBottleLimit} onChange={(e) => update({ halfOffRules: { ...cfg.halfOffRules, initialROneBottleLimit: e.target.checked } })} />
          初回/R は半額シャンパン1本まで
        </label>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={save} disabled={saving} className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, width: 'auto', padding: '0 22px' }}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </Shell>
  );
}

// ───────────────────────── 汎用リストエディタ

function ListEditor<T>({ rows, onChange, empty, render }: {
  rows: T[]; onChange: (rows: T[]) => void; empty: T; render: (row: T, set: (r: T) => void) => React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {render(row, (r) => onChange(rows.map((x, j) => (j === i ? r : x))))}
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="削除"
            style={{ ...cell, width: 32, cursor: 'pointer', color: 'var(--noxa-status-error)', borderColor: 'rgba(229,115,115,0.4)' }}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { ...empty }])} style={{ alignSelf: 'flex-start', appearance: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 9999, border: '1px dashed var(--noxa-border-strong)', background: 'transparent', color: 'var(--noxa-accent-primary-ink)', fontSize: 13 }}>＋ 行を追加</button>
    </div>
  );
}

// ───────────────────────── パーツ

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139,92,246,0.10) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li><li aria-hidden>·</li>
            <li><Link href="/pos" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>pos</Link></li><li aria-hidden>·</li><li>settings</li>
          </ol>
        </nav>
        <div style={{ marginBottom: 18 }}>
          <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · POS 設定</div>
          <h1 className="noxa-display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>POS 設定</h1>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--noxa-text-muted)' }}>料金・メニュー・税/手数料・クイック・半額ルールを店舗に合わせて編集。</p>
        </div>
        {children}
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </section>
  );
}
function SubTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--noxa-text-muted)', marginTop: 4 }}>{children}</div>;
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>{children}</div>;
}
function NumF({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={lbl}>{label}{hint ? <span style={{ color: 'var(--noxa-text-faint)', textTransform: 'none', letterSpacing: 0 }}> {hint}</span> : null}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} style={cell} inputMode="numeric" />
    </label>
  );
}
function TextF({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label ? <span style={lbl}>{label}{hint ? <span style={{ color: 'var(--noxa-text-faint)', textTransform: 'none', letterSpacing: 0 }}> {hint}</span> : null}</span> : null}
      <input value={value} onChange={(e) => onChange(e.target.value)} style={cell} />
    </label>
  );
}
function Chk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--noxa-text-muted)', whiteSpace: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}
    </label>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 24, color: 'var(--noxa-text-muted)', fontSize: 13 }}>{children}</div>;
}

const lbl: React.CSSProperties = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' };
const cell: React.CSSProperties = { minHeight: 38, padding: '6px 10px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 14 };
const primaryBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', minHeight: 44, borderRadius: 12, border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff', fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)' };

export default PosConfigClient;
