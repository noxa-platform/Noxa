'use client';

/**
 * 初回案内 — メニュー/指名タブレット（host-menu-app main.js を NOXA に移植）。
 * パネルグリッド（キャスト写真＋源氏名＋役職）を表示し、色分けで複数客グループの指名を選択、
 * 席（seating_tables）を指定して確定 → menu_orders 記録＋席回し currentHostIds へ連携。
 * 店舗デバイス（panel プロファイル）ログインで表示、オーナーはプレビュー可。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { useMenuStore } from '@/lib/menu/store';
import { useShopConfig } from '@/lib/shopConfig';
import { COLOR_HEX, COLOR_LABEL, COLOR_ORDER, type MenuColor, type MenuPanel } from '@/lib/menu/types';

const mono = 'var(--noxa-font-mono)';

function buildBoxShadow(colors: MenuColor[]): string {
  const map = COLOR_ORDER.filter((c) => colors.includes(c)).map((c) => COLOR_HEX[c]);
  if (map.length === 0) return '';
  if (map.length === 1) return `inset 0 0 0 4px ${map[0]}`;
  if (map.length === 2) return `inset 0 4px 0 0 ${map[0]}, inset 0 -4px 0 0 ${map[1]}, inset 4px 0 0 0 ${map[0]}, inset -4px 0 0 0 ${map[1]}`;
  if (map.length === 3) return `inset 0 4px 0 0 ${map[0]}, inset 4px 0 0 0 ${map[1]}, inset -4px 0 0 0 ${map[1]}, inset 0 -4px 0 0 ${map[2]}`;
  return `inset 0 4px 0 0 ${map[0]}, inset -4px 0 0 0 ${map[1]}, inset 0 -4px 0 0 ${map[2]}, inset 4px 0 0 0 ${map[3]}`;
}

type Checked = Record<string, MenuColor[]>;

export function FirstVisitClient({ user }: { user: User }) {
  const store = useMenuStore(user);
  const { visiblePanels, tables, config } = store;
  const { t } = useShopConfig(user); // 用語: 指名/キャスト/お客様（業種で切替）

  const [pickColor, setPickColor] = useState<MenuColor>('yellow');
  const [checked, setChecked] = useState<Checked>({});
  const [seat, setSeat] = useState('');
  const [seatOpen, setSeatOpen] = useState(false);
  const [fsIndex, setFsIndex] = useState<number | null>(null);
  const [orderGroups, setOrderGroups] = useState<{ color: MenuColor; casts: { id: string; name: string; title: string }[]; seat: string; customerName: string; memo: string }[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const colorsOf = (id: string) => checked[id] ?? [];
  const toggle = (id: string) => {
    setChecked((prev) => {
      const cur = prev[id] ?? [];
      const next = cur.includes(pickColor) ? cur.filter((c) => c !== pickColor) : [...cur, pickColor];
      const out = { ...prev };
      if (next.length === 0) delete out[id]; else out[id] = next;
      return out;
    });
  };

  const counts = useMemo(() => {
    const c: Record<MenuColor, number> = { yellow: 0, red: 0, blue: 0, green: 0 };
    for (const arr of Object.values(checked)) for (const col of arr) c[col]++;
    return c;
  }, [checked]);
  const totalSelections = useMemo(() => Object.values(checked).reduce((s, a) => s + a.length, 0), [checked]);

  const resetSelection = () => { setChecked({}); setPickColor('yellow'); setSeat(''); };

  const groupByColor = () => {
    const byColor = new Map<MenuColor, { id: string; name: string; title: string }[]>();
    for (const [id, cols] of Object.entries(checked)) {
      const p = visiblePanels.find((x) => x.id === id);
      if (!p) continue;
      for (const col of cols) {
        if (!byColor.has(col)) byColor.set(col, []);
        byColor.get(col)!.push({ id: p.id, name: p.name, title: p.title });
      }
    }
    return COLOR_ORDER.filter((c) => byColor.has(c)).map((c) => ({ color: c, casts: byColor.get(c)! }));
  };

  const openConfirm = () => {
    const groups = groupByColor();
    if (groups.length === 0) return;
    if (config.skipOrderInput) { void doSubmit(groups.map((g) => ({ ...g, seat, customerName: '', memo: '' }))); return; }
    setOrderGroups(groups.map((g) => ({ ...g, seat, customerName: '', memo: '' })));
  };

  const doSubmit = async (groups: { color: MenuColor; casts: { id: string; name: string; title: string }[]; seat: string; customerName: string; memo: string }[]) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await store.submitOrders(groups, 'main');
      resetSelection();
      setOrderGroups(null);
    } finally { setSubmitting(false); }
  };

  // 全画面スワイプ用キーボード
  useEffect(() => {
    if (fsIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFsIndex(null);
      if (e.key === 'ArrowRight') setFsIndex((i) => (i !== null && i < visiblePanels.length - 1 ? i + 1 : i));
      if (e.key === 'ArrowLeft') setFsIndex((i) => (i !== null && i > 0 ? i - 1 : i));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fsIndex, visiblePanels.length]);

  if (store.loading) return <div style={{ padding: 40, color: 'var(--noxa-text-muted)' }}>読み込み中…</div>;
  if (!store.shopId) return <div style={{ padding: 40, color: 'var(--noxa-text-muted)' }}>所属店舗が見つかりません。</div>;

  const fsPanel = fsIndex !== null ? visiblePanels[fsIndex] : null;

  return (
    <div style={{ borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(12px,2.5vw,24px)', position: 'relative', color: 'var(--noxa-text-primary)' }}>
      {/* ヘッダー: 色ピッカー + 席 + リセット */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ marginRight: 'auto' }}>
          <div className="noxa-eyebrow" style={{ fontSize: 11 }}>ノクサ · 初回案内</div>
          <h1 className="noxa-display" style={{ fontSize: 'clamp(20px,3vw,30px)', margin: 0 }}>初回案内 <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>メニュー / {t('nomination')}</span></h1>
        </div>
        {/* 色ピッカー */}
        <div style={{ display: 'flex', gap: 6 }}>
          {COLOR_ORDER.map((c) => (
            <button key={c} type="button" onClick={() => setPickColor(c)} title={COLOR_LABEL[c]}
              style={{ position: 'relative', width: 44, height: 44, borderRadius: 12, cursor: 'pointer', background: pickColor === c ? COLOR_HEX[c] : 'transparent', border: `2px solid ${COLOR_HEX[c]}`, boxShadow: pickColor === c ? `0 0 10px ${COLOR_HEX[c]}` : 'none' }}>
              <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: counts[c] ? COLOR_HEX[c] : 'var(--noxa-surface-muted)', color: counts[c] ? '#000' : 'var(--noxa-text-faint)', fontSize: 11, fontWeight: 700, fontFamily: mono, lineHeight: '18px' }}>{counts[c]}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setSeatOpen(true)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, cursor: 'pointer', background: seat ? 'var(--noxa-accent-primary)' : 'transparent', color: seat ? '#fff' : 'var(--noxa-text-muted)', border: `1px solid ${seat ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, fontSize: 14 }}>席：{seat || '未選択'}</button>
        {totalSelections > 0 && <button type="button" onClick={resetSelection} style={{ minHeight: 44, padding: '0 14px', borderRadius: 12, cursor: 'pointer', background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)', fontSize: 14 }}>リセット</button>}
        {store.canManage && <a href="/first-visit/settings" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 14px', borderRadius: 12, background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)', fontSize: 14, textDecoration: 'none' }}>⚙ 設定</a>}
      </header>

      {visiblePanels.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--noxa-text-muted)', fontSize: 14 }}>
          パネルがありません。{store.canManage ? `「⚙ 設定」から${t('cast')}を追加してください。` : 'オーナーがメニューを設定すると表示されます。'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(120px,18vw,180px), 1fr))', gap: 'clamp(8px,1.5vw,14px)' }}>
          {visiblePanels.map((p, i) => {
            const cols = colorsOf(p.id);
            const locked = p.kind === 'cast' && !p.selectable;
            return (
              <div key={p.id} onClick={() => setFsIndex(i)}
                style={{ position: 'relative', aspectRatio: '3/4', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: 'var(--noxa-surface-muted)', border: '1px solid var(--noxa-border)', boxShadow: buildBoxShadow(cols), opacity: locked ? 0.5 : 1 }}>
                {p.image
                  ? <img src={p.image} alt={p.name || p.label} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${p.imgX}% ${p.imgY}%`, transform: `scale(${p.imgScale / 100})` }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: 'var(--noxa-text-faint)' }}>♠</div>}
                {p.isNewFace && <div style={{ position: 'absolute', top: 6, left: 6, padding: '2px 8px', borderRadius: 6, background: 'var(--noxa-accent-primary)', color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: mono }}>NEW</div>}
                {/* 選択中バッジ */}
                {cols.filter((c) => !(cols.length === 1 && cols[0] === pickColor)).length > 0 && (
                  <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {COLOR_ORDER.filter((c) => cols.includes(c)).map((c) => <span key={c} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: COLOR_HEX[c], color: '#000' }}>{COLOR_LABEL[c]}</span>)}
                  </div>
                )}
                {(p.name || p.title || p.label) && (
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 8px 6px', background: 'linear-gradient(to top, rgba(0,0,0,0.78), transparent)' }}>
                    {p.name ? <>
                      {p.title && <div style={{ fontSize: config.titleFontSize, color: 'rgba(255,255,255,0.78)', lineHeight: 1.2 }}>{p.title}</div>}
                      <div style={{ fontSize: config.nameFontSize, fontWeight: 600, color: '#fff', lineHeight: 1.2 }}>{p.ruby ? <ruby>{p.name}<rt style={{ fontSize: '0.5em' }}>{p.ruby}</rt></ruby> : p.name}</div>
                    </> : <div style={{ fontSize: config.nameFontSize, fontWeight: 600, color: '#fff' }}>{p.label}</div>}
                  </div>
                )}
                {/* チェックボックス */}
                {p.kind === 'cast' && !locked && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggle(p.id); }}
                    style={{ position: 'absolute', bottom: 6, right: 6, width: 30, height: 30, borderRadius: 8, cursor: 'pointer', background: cols.includes(pickColor) ? COLOR_HEX[pickColor] : 'rgba(0,0,0,0.45)', border: `2px solid ${COLOR_HEX[pickColor]}`, color: '#000', fontSize: 16, lineHeight: '26px' }}>
                    {cols.includes(pickColor) ? '✓' : ''}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 確定ボタン（フローティング） */}
      {totalSelections > 0 && (
        <button type="button" onClick={openConfirm} disabled={submitting}
          style={{ position: 'sticky', bottom: 16, marginTop: 20, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minHeight: 52, padding: '0 26px', borderRadius: 26, cursor: 'pointer', background: 'var(--noxa-accent-primary)', color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, boxShadow: 'var(--noxa-glow-soft)' }}>
          {t('nomination')}を確定 <span style={{ fontFamily: mono, background: 'rgba(255,255,255,0.25)', borderRadius: 12, padding: '2px 10px' }}>{totalSelections}</span>
        </button>
      )}

      {/* 席ピッカー */}
      {seatOpen && (
        <Overlay onClose={() => setSeatOpen(false)}>
          <h3 style={{ margin: '0 0 12px', fontFamily: 'var(--noxa-font-display-jp)' }}>席を選択</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))', gap: 8, marginBottom: 12 }}>
            {tables.map((t) => (
              <button key={t.id} type="button" onClick={() => { setSeat(t.name); setSeatOpen(false); }}
                style={{ minHeight: 44, borderRadius: 10, cursor: 'pointer', background: seat === t.name ? 'var(--noxa-accent-primary)' : 'transparent', color: seat === t.name ? '#fff' : 'var(--noxa-text-primary)', border: `1px solid ${seat === t.name ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` }}>{t.name}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => { const v = window.prompt('席番号（自由入力）', seat); if (v !== null) setSeat(v.trim()); setSeatOpen(false); }} style={btnSecondary}>その他…</button>
            <button type="button" onClick={() => { setSeat(''); setSeatOpen(false); }} style={btnSecondary}>未選択にする</button>
          </div>
        </Overlay>
      )}

      {/* 全画面表示 */}
      {fsPanel && (
        <div onClick={() => setFsIndex(null)}
          onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            if (!touch.current) return;
            const dx = e.changedTouches[0].clientX - touch.current.x;
            const dy = Math.abs(e.changedTouches[0].clientY - touch.current.y);
            if (Math.abs(dx) > 60 && dy < Math.abs(dx)) {
              if (dx < 0) setFsIndex((i) => (i !== null && i < visiblePanels.length - 1 ? i + 1 : i));
              else setFsIndex((i) => (i !== null && i > 0 ? i - 1 : i));
            }
            touch.current = null;
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: 'min(90vw, 520px)', width: '100%' }}>
            {fsPanel.image
              ? <img src={fsPanel.image} alt={fsPanel.name} style={{ width: '100%', borderRadius: 16, objectFit: 'cover', objectPosition: `${fsPanel.imgX}% ${fsPanel.imgY}%` }} />
              : <div style={{ width: '100%', aspectRatio: '3/4', borderRadius: 16, background: 'var(--noxa-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80, color: 'var(--noxa-text-faint)' }}>♠</div>}
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {fsPanel.title && <div style={{ fontSize: config.fsTitleFontSize, color: 'rgba(255,255,255,0.7)' }}>{fsPanel.title}</div>}
              <div style={{ fontSize: config.fsNameFontSize, fontWeight: 700, color: '#fff' }}>{fsPanel.ruby ? <ruby>{fsPanel.name || fsPanel.label}<rt style={{ fontSize: '0.4em' }}>{fsPanel.ruby}</rt></ruby> : (fsPanel.name || fsPanel.label)}</div>
              {fsPanel.isNewFace && <span style={{ display: 'inline-block', marginTop: 8, padding: '3px 12px', borderRadius: 8, background: 'var(--noxa-accent-primary)', color: '#fff', fontSize: 12, fontWeight: 700 }}>NEW</span>}
            </div>
            {fsPanel.kind === 'cast' && fsPanel.selectable && (
              <button type="button" onClick={() => toggle(fsPanel.id)}
                style={{ display: 'block', margin: '16px auto 0', minHeight: 48, padding: '0 28px', borderRadius: 24, cursor: 'pointer', background: colorsOf(fsPanel.id).includes(pickColor) ? COLOR_HEX[pickColor] : 'transparent', color: colorsOf(fsPanel.id).includes(pickColor) ? '#000' : '#fff', border: `2px solid ${COLOR_HEX[pickColor]}`, fontSize: 15, fontWeight: 700 }}>
                {colorsOf(fsPanel.id).includes(pickColor) ? `✓ ${COLOR_LABEL[pickColor]} で選択中` : `${COLOR_LABEL[pickColor]} で選択`}
              </button>
            )}
          </div>
          <button type="button" onClick={() => setFsIndex(null)} style={{ position: 'absolute', top: 20, right: 20, width: 44, height: 44, borderRadius: 22, cursor: 'pointer', background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none', fontSize: 22 }}>×</button>
        </div>
      )}

      {/* 指名確定モーダル */}
      {orderGroups && (
        <Overlay onClose={() => setOrderGroups(null)}>
          <h3 style={{ margin: '0 0 12px', fontFamily: 'var(--noxa-font-display-jp)' }}>{t('nomination')}を確定</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}>
            {orderGroups.map((g, gi) => (
              <div key={g.color} style={{ borderRadius: 12, border: `1px solid ${COLOR_HEX[g.color]}`, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 6, background: COLOR_HEX[g.color] }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{COLOR_LABEL[g.color]} グループ（{g.casts.length}名）</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {g.casts.map((c) => <span key={c.id} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'var(--noxa-surface-muted)' }}>{c.title && <span style={{ color: 'var(--noxa-text-faint)' }}>{c.title} </span>}{c.name}</span>)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <select value={g.seat} onChange={(e) => setOrderGroups((p) => p && p.map((x, i) => i === gi ? { ...x, seat: e.target.value } : x))} style={field}>
                    <option value="">席を選択</option>
                    {tables.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    {g.seat && !tables.some((t) => t.name === g.seat) && <option value={g.seat}>{g.seat}</option>}
                  </select>
                  <input value={g.customerName} onChange={(e) => setOrderGroups((p) => p && p.map((x, i) => i === gi ? { ...x, customerName: e.target.value } : x))} placeholder={`${t('customer')}名`} style={field} />
                  <textarea value={g.memo} onChange={(e) => setOrderGroups((p) => p && p.map((x, i) => i === gi ? { ...x, memo: e.target.value } : x))} placeholder="メモ（任意）" rows={2} style={{ ...field, resize: 'vertical' }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => doSubmit(orderGroups)} disabled={submitting} style={{ ...btnPrimary, flex: 1 }}>{submitting ? '送信中…' : '送信'}</button>
            <button type="button" onClick={() => setOrderGroups(null)} style={btnSecondary}>キャンセル</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20, boxShadow: 'var(--noxa-glow-soft)' }}>{children}</div>
    </div>
  );
}

const field: React.CSSProperties = { width: '100%', minHeight: 42, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 14 };
const btnPrimary: React.CSSProperties = { minHeight: 46, padding: '0 22px', borderRadius: 12, cursor: 'pointer', background: 'var(--noxa-accent-primary)', color: '#fff', border: 'none', fontSize: 15, fontWeight: 600 };
const btnSecondary: React.CSSProperties = { minHeight: 46, padding: '0 18px', borderRadius: 12, cursor: 'pointer', background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)', fontSize: 14 };

export default FirstVisitClient;
