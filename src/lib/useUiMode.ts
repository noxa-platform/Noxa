'use client';

/**
 * UIモード：かんたん（既定）/ プロ。
 * ネットに不慣れな夜職スタッフ向けに「かんたん」を既定とし、文字・タップ領域を大きく、
 * 装飾を減らす。上級者/オーナーは「プロ」で密度の高い従来UIに切替。
 * <html data-ui="pro"> の有無で CSS を出し分ける（未設定＝かんたん）。
 */
import { useEffect, useState } from 'react';

export const UIMODE_KEY = 'noxa_uimode';
export type UiMode = 'easy' | 'pro';

export function getUiMode(): UiMode {
  if (typeof window === 'undefined') return 'easy';
  return localStorage.getItem(UIMODE_KEY) === 'pro' ? 'pro' : 'easy';
}

export function applyUiMode(mode: UiMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.ui = mode;
}

export function setUiMode(mode: UiMode) {
  if (typeof window !== 'undefined') localStorage.setItem(UIMODE_KEY, mode);
  applyUiMode(mode);
}

export function useUiMode(): UiMode {
  const [mode, setMode] = useState<UiMode>('easy');
  useEffect(() => { const m = getUiMode(); setMode(m); applyUiMode(m); }, []);
  return mode;
}
