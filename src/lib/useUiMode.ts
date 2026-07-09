'use client';

/**
 * UIモード：かんたん（既定）/ プロ。
 * ネットに不慣れな夜職スタッフ向けに「かんたん」を既定とし、文字・タップ領域を大きく、
 * 装飾を減らす。上級者/オーナーは「プロ」で密度の高い従来UIに切替。
 * <html data-ui="pro"> の有無で CSS を出し分ける（未設定＝かんたん）。
 */
import { useEffect, useSyncExternalStore } from 'react';

export const UIMODE_KEY = 'noxa_uimode';
export type UiMode = 'easy' | 'pro';

/** 同一タブ内の切替通知（storage イベントは他タブにしか飛ばない） */
const UIMODE_EVENT = 'noxa-uimode-change';

export function getUiMode(): UiMode {
  if (typeof window === 'undefined') return 'easy';
  return localStorage.getItem(UIMODE_KEY) === 'pro' ? 'pro' : 'easy';
}

export function applyUiMode(mode: UiMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.ui = mode;
}

export function setUiMode(mode: UiMode) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(UIMODE_KEY, mode);
    window.dispatchEvent(new Event(UIMODE_EVENT)); // 同一タブの useUiMode 全購読者へ通知
  }
  applyUiMode(mode);
}

function subscribeUiMode(cb: () => void): () => void {
  window.addEventListener('storage', cb);
  window.addEventListener(UIMODE_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(UIMODE_EVENT, cb);
  };
}

/**
 * localStorage を外部ストアとして購読（useSyncExternalStore）。
 * SSR/hydration は 'easy' 固定 → クライアントで実値に一致（旧実装の effect+setState
 * は react-hooks/set-state-in-effect 違反で、切替が他コンポーネントへ伝播もしなかった）。
 */
export function useUiMode(): UiMode {
  const mode = useSyncExternalStore(subscribeUiMode, getUiMode, () => 'easy' as UiMode);
  useEffect(() => { applyUiMode(mode); }, [mode]);
  return mode;
}
