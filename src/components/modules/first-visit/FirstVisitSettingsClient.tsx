'use client';

/**
 * 初回案内 設定 — メニュー/指名タブレットのデータ設定UI（host-menu-app admin.js を移植）。
 * パネル（キャスト/情報カード）の CRUD・画像・並べ替え・表示/選択トグル、指名履歴、
 * 端末ログインPIN（panel プロファイル）発行、表示設定。オーナー専用。
 */

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { useMenuStore } from '@/lib/menu/store';
import { compressImage } from '@/lib/menu/imageCompress';
import { COLOR_HEX, COLOR_LABEL, DEFAULT_MENU_CONFIG, type MenuConfig, type MenuPanel } from '@/lib/menu/types';
import { Shell, Section, Empty, Eyebrow, lbl, field, chip } from '@/components/modules/schedule/ScheduleClient';

const mono = 'var(--noxa-font-mono)';

type EditState = {
  mode: 'cast' | 'info'; id: string | null;
  name: string; ruby: string; title: string; label: string; isNewFace: boolean;
  imgX: number; imgY: number; imgScale: number; image: string | null; imageDirty: boolean;
};

const blankEdit = (mode: 'cast' | 'info'): EditState => ({ mode, id: null, name: '', ruby: '', title: '', label: '', isNewFace: false, imgX: 50, imgY: 50, imgScale: 100, image: null, imageDirty: false });

export function FirstVisitSettingsClient({ user }: { user: User }) {
  const store = useMenuStore(user);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  const [cfg, setCfg] = useState<MenuConfig>(DEFAULT_MENU_CONFIG);

  useEffect(() => { setCfg(store.config); }, [store.config]);

  if (store.loading) return <Shell title="初回案内 設定" eyebrow="Noxa OS · First Visit" crumb="first-visit/settings"><Eyebrow>読み込み中…</Eyebrow></Shell>;
  if (!store.shopId) return <Shell title="初回案内 設定" eyebrow="Noxa OS · First Visit" crumb="first-visit/settings"><Section label="設定"><Empty>所属店舗が見つかりません。</Empty></Section></Shell>;
  if (!store.canManage) return <Shell title="初回案内 設定" eyebrow="Noxa OS · First Visit" crumb="first-visit/settings"><Section label="設定"><Empty>この設定はオーナー専用です。</Empty></Section></Shell>;

  const openEdit = (p?: MenuPanel) => {
    if (!p) { setEdit(blankEdit('cast')); return; }
    setEdit({ mode: p.kind, id: p.id, name: p.name, ruby: p.ruby, title: p.title, label: p.label, isNewFace: p.isNewFace, imgX: p.imgX, imgY: p.imgY, imgScale: p.imgScale, image: p.image || null, imageDirty: false });
  };

  const onFile = async (file: File) => {
    if (!edit) return;
    try { const dataUrl = await compressImage(file); setEdit({ ...edit, image: dataUrl, imageDirty: true }); }
    catch { /* skip */ }
  };

  const saveEdit = async () => {
    if (!edit || busy) return;
    setBusy(true);
    try {
      let id = edit.id;
      if (!id) {
        id = edit.mode === 'cast' ? await store.addCastPanel({ name: edit.name, ruby: edit.ruby, title: edit.title }) : await store.addInfoCard(edit.label);
      }
      const meta: Record<string, unknown> = { imgX: edit.imgX, imgY: edit.imgY, imgScale: edit.imgScale };
      if (edit.mode === 'cast') { meta.name = edit.name; meta.ruby = edit.ruby; meta.title = edit.title; meta.isNewFace = edit.isNewFace; }
      else { meta.label = edit.label; }
      await store.savePanelMeta(id, meta);
      if (edit.imageDirty && edit.image) await store.setPanelImage(id, edit.image);
      setEdit(null);
    } finally { setBusy(false); }
  };

  const savePin = async () => {
    if (pin.length < 4) { setPinMsg('4桁以上で設定してください'); return; }
    setBusy(true);
    try { await store.setPanelPin(pin); setPinMsg('パスワードを設定しました'); setPin(''); }
    catch { setPinMsg('設定に失敗しました'); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="初回案内 設定" eyebrow="Noxa OS · First Visit" crumb="first-visit/settings" badge="オーナー設定">
      {/* パネル管理 */}
      <Section label={`パネル（${store.panels.length}）`}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => openEdit()} style={chip(true)}>＋ キャスト追加</button>
          <button type="button" onClick={() => setEdit(blankEdit('info'))} style={chip(false)}>＋ 情報カード</button>
        </div>
        {store.panels.length === 0 ? <Empty>パネルがありません。キャストを追加してください。</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {store.panels.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', opacity: p.visible ? 1 : 0.5 }}>
                <div style={{ width: 40, height: 52, borderRadius: 6, overflow: 'hidden', flex: 'none', background: 'var(--noxa-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.image ? <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${p.imgX}% ${p.imgY}%` }} /> : <span style={{ color: 'var(--noxa-text-faint)' }}>♠</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name || p.label || '（無題）'}{p.title && <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>{p.title}</span>}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    {p.kind === 'info' && <Tag>情報</Tag>}
                    {p.isNewFace && <Tag c="var(--noxa-accent-primary)">NEW</Tag>}
                    {!p.visible && <Tag>非表示</Tag>}
                    {p.kind === 'cast' && !p.selectable && <Tag>選択不可</Tag>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <IconBtn title="上へ" disabled={i === 0} onClick={() => store.reorderPanel(p.id, -1)}>↑</IconBtn>
                  <IconBtn title="下へ" disabled={i === store.panels.length - 1} onClick={() => store.reorderPanel(p.id, 1)}>↓</IconBtn>
                  <IconBtn title={p.visible ? '非表示にする' : '表示する'} onClick={() => store.savePanelMeta(p.id, { menuVisible: !p.visible })}>{p.visible ? '👁' : '🚫'}</IconBtn>
                  {p.kind === 'cast' && <IconBtn title={p.selectable ? '選択不可にする' : '選択可にする'} onClick={() => store.savePanelMeta(p.id, { selectable: !p.selectable })}>{p.selectable ? '✓' : '−'}</IconBtn>}
                  <IconBtn title="編集" onClick={() => openEdit(p)}>✎</IconBtn>
                  <IconBtn title="削除" onClick={() => { if (window.confirm('削除しますか？')) store.removePanel(p.id); }}>🗑</IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 指名履歴 */}
      <Section label={`指名履歴（${store.orders.length}）`}>
        {store.orders.length === 0 ? <Empty>まだ指名はありません。</Empty> : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {store.orders.slice(0, 40).map((o) => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: `1px solid ${COLOR_HEX[o.color]}` }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: COLOR_HEX[o.color], flex: 'none' }} title={COLOR_LABEL[o.color]} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{o.seat && <b>{o.seat}</b>} {o.customerName && <span>· {o.customerName}</span>} <span style={{ color: 'var(--noxa-text-muted)' }}>{o.casts.map((c) => c.name).join('、')}</span></div>
                    {o.memo && <div style={{ fontSize: 11, color: 'var(--noxa-text-faint)' }}>{o.memo}</div>}
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>{o.createdAtMs ? new Date(o.createdAtMs).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <IconBtn title="削除" onClick={() => store.deleteOrder(o.id)}>×</IconBtn>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => { if (window.confirm('指名履歴を全て削除しますか？')) store.clearOrders(); }} style={{ ...chip(false), color: 'var(--noxa-status-error)' }}>履歴を全削除</button>
          </>
        )}
      </Section>

      {/* 端末ログイン（PIN） */}
      <Section label="初回案内端末のログイン">
        <p style={{ fontSize: 12, color: 'var(--noxa-text-muted)', margin: '0 0 10px', lineHeight: 1.6 }}>
          タブレットは <b>店舗デバイスログイン</b>（<a href="/store-login" style={{ color: 'var(--noxa-accent-primary-ink)' }}>/store-login</a>）で「初回案内パネル」を選び、下記のパスワードでログインします。<br />
          店舗ID: <code style={{ fontFamily: mono, fontSize: 12, background: 'var(--noxa-surface-muted)', padding: '2px 6px', borderRadius: 4 }}>{store.shopId}</code> / プロファイル: <code style={{ fontFamily: mono }}>panel</code>
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={lbl}>端末パスワード（4桁以上）</span>
            <input value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setPinMsg(''); }} inputMode="numeric" placeholder="• • • •" style={{ ...field, width: 160, fontFamily: mono, letterSpacing: '0.3em', textAlign: 'center' }} />
          </label>
          <button type="button" onClick={savePin} disabled={busy} style={chip(true)}>パスワードを設定</button>
          {pinMsg && <span style={{ fontSize: 12, color: 'var(--noxa-status-info)' }}>{pinMsg}</span>}
        </div>
      </Section>

      {/* 表示設定 */}
      <Section label="表示設定">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
          {([['nameFontSize', '名前サイズ'], ['titleFontSize', '役職サイズ'], ['fsNameFontSize', '全画面 名前'], ['fsTitleFontSize', '全画面 役職']] as const).map(([k, label]) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={lbl}>{label}</span>
              <input type="number" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} style={field} />
            </label>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.skipOrderInput} onChange={(e) => setCfg({ ...cfg, skipOrderInput: e.target.checked })} />
          確定時に入力モーダルを出さず即送信する（席はヘッダで選択した卓を使用）
        </label>
        <div style={{ marginTop: 12 }}><button type="button" onClick={() => store.saveConfig(cfg)} style={chip(true)}>表示設定を保存</button></div>
      </Section>

      {/* 編集モーダル */}
      {edit && (
        <div onClick={() => setEdit(null)} style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto', background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--noxa-font-display-jp)' }}>{edit.id ? '編集' : edit.mode === 'cast' ? 'キャスト追加' : '情報カード追加'}</h3>
            {/* 画像 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ width: 90, height: 120, borderRadius: 8, overflow: 'hidden', flex: 'none', background: 'var(--noxa-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {edit.image ? <img src={edit.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${edit.imgX}% ${edit.imgY}%`, transform: `scale(${edit.imgScale / 100})` }} /> : <span style={{ fontSize: 32, color: 'var(--noxa-text-faint)' }}>♠</span>}
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...chip(false), display: 'inline-block', cursor: 'pointer' }}>画像を選択
                  <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} style={{ display: 'none' }} />
                </label>
                {edit.image && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([['imgX', '左右'], ['imgY', '上下'], ['imgScale', '拡大']] as const).map(([k, label]) => (
                      <label key={k} style={{ fontSize: 11, color: 'var(--noxa-text-muted)' }}>{label}
                        <input type="range" min={k === 'imgScale' ? 100 : 0} max={k === 'imgScale' ? 250 : 100} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} style={{ width: '100%' }} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* テキスト */}
            {edit.mode === 'cast' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="源氏名" style={field} />
                <input value={edit.ruby} onChange={(e) => setEdit({ ...edit, ruby: e.target.value })} placeholder="ふりがな（任意）" style={field} />
                <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="役職（任意・例：取締役）" style={field} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={edit.isNewFace} onChange={(e) => setEdit({ ...edit, isNewFace: e.target.checked })} />NEW（新人バッジ）</label>
              </div>
            ) : (
              <input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="ラベル（例：本日のおすすめ）" style={field} />
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={saveEdit} disabled={busy || (edit.mode === 'cast' ? !edit.name.trim() : !edit.label.trim())} style={{ ...chip(true), flex: 1, minHeight: 44 }}>{busy ? '保存中…' : '保存'}</button>
              <button type="button" onClick={() => setEdit(null)} style={{ ...chip(false), minHeight: 44 }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Tag({ children, c }: { children: React.ReactNode; c?: string }) {
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: c ?? 'var(--noxa-surface-muted)', color: c ? '#fff' : 'var(--noxa-text-faint)' }}>{children}</span>;
}
function IconBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return <button type="button" title={title} onClick={onClick} disabled={disabled} style={{ width: 30, height: 30, borderRadius: 7, cursor: disabled ? 'default' : 'pointer', background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 13, opacity: disabled ? 0.4 : 1 }}>{children}</button>;
}

export default FirstVisitSettingsClient;
