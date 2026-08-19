/**
 * 料金設定の「テスト伝票プレビュー」（Day127・純関数）。
 *
 * 目的は 2 つある。
 *   1. 設定画面で数字をいじった人が、**保存前に「この設定だといくらになるか」を見られる**こと。
 *      料金設定は入力欄の羅列で、保存して初めて会計に効く。間違いは翌日の会計で初めて分かる。
 *   2. **AI に料金設定を書かせる前提**を整えること。AI が Config を生成しても、
 *      人が承認する材料が無ければ「もっともらしい設定」がそのまま本番の伝票に流れる。
 *      Day115 / 123 / 124 で潰したのは全部「間違った料金設定のまま伝票が作られる」事故だった。
 *      **プレビューが先、AI 生成は後**。順序を逆にすると事故の作り込みになる。
 *
 * 実際の会計と同じ `calculateResult` を通すこと（別計算を作らない）。プレビューと本番で
 * 計算が分かれた瞬間、プレビューは「もっともらしい嘘」になる。
 */
import type { StoreConfig } from './types';
import {
  calculateResult, createInitialState, createPinnedOrders,
  type CalculationResult, type CalculatorState, type CustomerType,
} from './engine';

export type PreviewScenario = {
  id: string;
  /** 現場の言葉で「どの客か」（例: 初回のお客様が 60 分） */
  label: string;
  /** 何を確かめる例か（設定のどの項目に効くか） */
  note: string;
  state: CalculatorState;
};

export type PreviewResult = PreviewScenario & { result: CalculationResult };

/** 入店 20:00 を基準に、経過分から現在時刻を作る（跨ぎも扱えるよう 24h 表記で正規化） */
function timeAfter(minutes: number): string {
  const base = 20 * 60;
  const t = base + minutes;
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function scenarioState(config: StoreConfig, customerType: CustomerType, minutes: number, over: Partial<CalculatorState> = {}): CalculatorState {
  const base = createInitialState(config);
  return {
    ...base,
    customerType,
    orders: createPinnedOrders(config, customerType),
    entryTime: '20:00',
    currentTime: timeAfter(minutes),
    ...over,
  };
}

/**
 * 代表的な会計パターン。**店舗設定の主要項目が 1 つ以上効くもの**だけを並べる
 * （網羅ではなく、間違いに気づける最小のセット）。
 */
export function buildPreviewScenarios(config: StoreConfig): PreviewScenario[] {
  return [
    {
      id: 'initial-60',
      label: '初回のお客様・60分',
      note: '初回料金とセット時間の設定が効きます',
      state: scenarioState(config, 'initial', 60),
    },
    {
      id: 'regular-60',
      label: '通常のお客様・60分',
      note: '通常料金とサービス料・税の設定が効きます',
      state: scenarioState(config, 'regular', 60),
    },
    {
      id: 'regular-90',
      label: '通常のお客様・90分（延長あり）',
      note: '延長料金と延長単位の設定が効きます',
      state: scenarioState(config, 'regular', 90),
    },
    {
      id: 'regular-nomination',
      label: '通常のお客様・60分・指名あり',
      note: '指名料の設定が効きます',
      state: scenarioState(config, 'regular', 60, { additionalNominationCount: 1 }),
    },
    {
      id: 'dohan-60',
      label: '同伴・60分',
      note: '同伴料金の設定が効きます',
      state: scenarioState(config, 'regular', 60, { dohan: true }),
    },
  ];
}

/**
 * プレビューを計算する。**本番の会計と同じ関数**を通す。
 * `isDebugMode` は現在時刻の上書きを止める内部フラグなので、プレビューでは常に true
 * （プレビューが実時間で動くと、同じ設定でも見るたびに金額が変わる）。
 */
export function previewConfig(config: StoreConfig): PreviewResult[] {
  return buildPreviewScenarios(config).map((s) => ({
    ...s,
    result: calculateResult({ ...s.state, isDebugMode: true }, config),
  }));
}

/**
 * 2 つの設定でプレビューを取り、**金額が変わる項目だけ**を返す（保存前の差分確認・AI 生成の承認材料）。
 * 「何を変えたか」ではなく「**いくら変わるか**」で見せるのが要点——現場が判断できるのは金額の方。
 */
export function diffPreview(before: StoreConfig, after: StoreConfig): { id: string; label: string; before: number; after: number; delta: number }[] {
  const a = previewConfig(before);
  const b = previewConfig(after);
  const out: { id: string; label: string; before: number; after: number; delta: number }[] = [];
  for (const cur of b) {
    const prev = a.find((x) => x.id === cur.id);
    if (!prev) continue;
    const delta = cur.result.currentTotal - prev.result.currentTotal;
    if (delta !== 0) {
      out.push({ id: cur.id, label: cur.label, before: prev.result.currentTotal, after: cur.result.currentTotal, delta });
    }
  }
  return out;
}
