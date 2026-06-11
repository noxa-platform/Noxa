'use client';

import { useEffect, useState } from 'react';
import { THEME_KEY, applyTheme } from '@/lib/useTheme';

const OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'auto', label: 'おまかせ', hint: '店舗の業種に合わせる' },
  { value: 'noxa', label: 'ノクサ（ダーク）', hint: '夜・高級トーン' },
  { value: 'concafe', label: 'コンカフェ（ピンク）', hint: '明るい・ポップ' },
];

export function ThemeSwitcher() {
  const [val, setVal] = useState('auto');
  useEffect(() => { setVal(localStorage.getItem(THEME_KEY) || 'auto'); }, []);

  const choose = (v: string) => {
    setVal(v);
    localStorage.setItem(THEME_KEY, v);
    if (v === 'concafe') applyTheme('concafe');
    else if (v === 'noxa') applyTheme('');
    else applyTheme(''); // auto: 既定に戻す（店舗業態は次回読み込みで解決）
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)', marginBottom: 8 }}>外観テーマ</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OPTIONS.map((o) => {
          const active = val === o.value;
          return (
            <button key={o.value} type="button" onClick={() => choose(o.value)}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: 'pointer', minWidth: 150, background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: active ? '#fff' : 'var(--noxa-text-primary)', border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{o.label}</div>
              <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.85)' : 'var(--noxa-text-faint)' }}>{o.hint}</div>
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>※「おまかせ」は店舗の業種（例：コンカフェ）で自動切替。手動選択が優先されます。</p>
    </div>
  );
}

export default ThemeSwitcher;
