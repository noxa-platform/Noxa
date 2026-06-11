'use client';

import { useEffect, useState } from 'react';
import { getUiMode, setUiMode, type UiMode } from '@/lib/useUiMode';

/** かんたん / プロ の切替。プロフィール設定に置く。 */
export function ProModeSwitcher() {
  const [mode, setMode] = useState<UiMode>('easy');
  useEffect(() => { setMode(getUiMode()); }, []);

  const choose = (m: UiMode) => { setMode(m); setUiMode(m); };

  const opts: { value: UiMode; title: string; desc: string }[] = [
    { value: 'easy', title: 'かんたん', desc: '文字・ボタン大きめ。迷わない表示（おすすめ）' },
    { value: 'pro', title: 'プロ', desc: '情報量多め・コンパクト。慣れた人向け' },
  ];

  return (
    <div>
      <label className="noxa-label">画面モード</label>
      <div style={{ display: 'flex', gap: 10 }}>
        {opts.map((o) => {
          const on = mode === o.value;
          return (
            <button key={o.value} type="button" onClick={() => choose(o.value)}
              style={{
                flex: 1, textAlign: 'left', padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                background: on ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)',
                color: on ? '#fff' : 'var(--noxa-text-primary)',
                border: `1px solid ${on ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
              }}>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--noxa-font-display-jp)' }}>{o.title}</div>
              <div style={{ fontSize: 12, marginTop: 4, color: on ? 'rgba(255,255,255,0.85)' : 'var(--noxa-text-muted)', lineHeight: 1.5 }}>{o.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ProModeSwitcher;
