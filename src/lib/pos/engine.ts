/**
 * 伝票計算エンジン（純ロジック・React 非依存）。
 * host-club-calculator の hooks/useCalculator.ts から移植。
 * React の useReducer ラッパーは持たず、reducer と計算関数のみを公開する。
 * 状態は NOXA 側（PosClient / Firestore）が保持する。
 */
import type { StoreConfig } from './types';
import { createDefaultStoreConfig } from './defaultConfig';

export type CustomerType = 'initial' | 'r_within' | 'r_after' | 'regular';

export interface OrderItem {
  id: string;
  name: string;
  baseName: string;
  price: number;
  originalPrice: number;
  count: number;
  isTaxIncluded?: boolean;
  isPinned?: boolean;
  canHalfOff?: boolean;
  isHalfOff?: boolean;
}

export interface CalculatorState {
  customerType: CustomerType;
  initialSetPrice: number;
  entryTime: string;
  currentTime: string;
  dohan: boolean;
  isSetHalfOff: boolean;
  isGirlsParty: boolean;
  isAppreciationDay: boolean;
  isSevenLuck: boolean;
  isGoldTicket: boolean;
  additionalNominationCount: number;
  isDebugMode: boolean;
  orders: OrderItem[];
}

export interface BreakdownItem {
  label: string;
  amount: number;
  note?: string;
  isTotal?: boolean;
}

export interface PriceScheduleItem {
  timeLimit: string;
  totalPrice: number;
  breakdown: BreakdownItem[];
}

export interface CalculationResult {
  currentTotal: number;
  breakdown: BreakdownItem[];
  previousTotal: number | null;
  previousBreakdown: BreakdownItem[] | null;
  schedule: PriceScheduleItem[];
  taxRate: number;
  isOutOfHours: boolean;
}

// POS の伝票（1卓に複数枚）。卓ドキュメント（seating_tables）に inline 保存し
// 席回しと同一の卓データを共有する（完全同期）。
export interface PosSlip {
  id: string;
  name: string;
  state: CalculatorState;
  castName?: string;      // 担当キャスト名（伝票作成時に選択）
  castUid?: string;       // 担当キャストのアカウント uid（個人売上の帰属用）
  castId?: string;        // 担当キャストの seating_cast id（席回し卓への反映用）
  customerName?: string;  // 顧客名（伝票作成時に選択/入力）
  customerId?: string;    // 既存顧客の id（選択時）
}

// config からピン留めオーダーを生成
export function createPinnedOrders(config: StoreConfig, customerType: CustomerType = 'regular'): OrderItem[] {
  // ショット半額は新規のみ（イベントフラグは作成時には考慮しない）
  const shouldShotHalf = customerType === 'initial';
  const shotName = config.pinnedOrders[2]?.name ?? 'ショット系';

  return config.pinnedOrders.map((p, i) => {
    const isHalf = (p.name === shotName && p.canHalfOff)
      ? (p.defaultIsHalfOff === true && shouldShotHalf)
      : (p.defaultIsHalfOff ?? false);
    const effectivePrice = isHalf ? calcHalfOffPrice(p.name, p.price, config) : p.price;
    return {
      id: `pinned_${i}`,
      name: isHalf ? `${p.name} (半額)` : p.name,
      baseName: p.name,
      price: effectivePrice,
      originalPrice: p.price,
      count: 0,
      isPinned: true,
      canHalfOff: p.canHalfOff,
      isHalfOff: isHalf,
    };
  });
}

// config から初期 state を生成
export function createInitialState(config: StoreConfig): CalculatorState {
  return {
    customerType: 'regular',
    initialSetPrice: config.initialPricing.set,
    entryTime: '20:00',
    currentTime: '20:00',
    dohan: false,
    isSetHalfOff: false,
    isGirlsParty: false,
    isAppreciationDay: false,
    isSevenLuck: false,
    isGoldTicket: false,
    additionalNominationCount: 0,
    isDebugMode: false,
    orders: createPinnedOrders(config, 'regular'),
  };
}

// 半額計算ヘルパー
function calcHalfOffPrice(baseName: string, originalPrice: number, config: StoreConfig): number {
  const specialPrice = config.halfOffRules.canSpecialPrice;
  // カンの半額は特殊価格（デフォルト700）
  const canName = config.pinnedOrders[0]?.name ?? 'カン';
  return baseName === canName && specialPrice ? specialPrice : Math.floor(originalPrice / 2);
}

// イベント・客層に応じて半額状態を同期
function syncHalfOffOrders(
  orders: OrderItem[],
  customerType: CustomerType,
  isGirlsParty: boolean,
  isAppreciationDay: boolean,
  isSevenLuck: boolean,
  config: StoreConfig,
): OrderItem[] {
  const { champagneNames, blueToGoldMinPrice, blueToGoldMaxPrice } = config.halfOffRules;
  const isInitialOrR = customerType === 'initial' || customerType === 'r_within' || customerType === 'r_after';
  const isGirlsOrSeven = isGirlsParty || isSevenLuck;

  const shouldCanHalf = isGirlsOrSeven || isAppreciationDay;
  const shouldShotHalf = customerType === 'initial' || isGirlsOrSeven || isAppreciationDay;

  // シャンパン統合→再分割
  const mergedOrders: OrderItem[] = [];
  const champagneMerged = new Map<string, { total: number; template: OrderItem }>();

  for (const o of orders) {
    if (champagneNames.includes(o.baseName) && o.canHalfOff && o.count > 0) {
      const existing = champagneMerged.get(o.baseName);
      if (existing) {
        existing.total += o.count;
      } else {
        champagneMerged.set(o.baseName, { total: o.count, template: o });
      }
    } else {
      mergedOrders.push(o);
    }
  }

  const champagneEntries = Array.from(champagneMerged.values())
    .sort((a, b) => b.template.originalPrice - a.template.originalPrice);

  let initialRHalfUsed = false;

  for (const entry of champagneEntries) {
    const { template, total } = entry;
    const price = template.originalPrice;
    const inBlueGoldRange = price >= blueToGoldMinPrice && price <= blueToGoldMaxPrice;

    if (isGirlsOrSeven && inBlueGoldRange) {
      mergedOrders.push({
        ...template, count: total, isHalfOff: true,
        price: calcHalfOffPrice(template.baseName, template.originalPrice, config),
        name: `${template.baseName} (半額)`,
      });
    } else if (isInitialOrR && !initialRHalfUsed && config.halfOffRules.initialROneBottleLimit) {
      initialRHalfUsed = true;
      mergedOrders.push({
        ...template, id: template.id, count: 1, isHalfOff: true,
        price: calcHalfOffPrice(template.baseName, template.originalPrice, config),
        name: `${template.baseName} (半額)`,
      });
      if (total > 1) {
        mergedOrders.push({
          ...template, id: template.id + '_full', count: total - 1,
          isHalfOff: false, price: template.originalPrice, name: template.baseName,
        });
      }
    } else {
      mergedOrders.push({
        ...template, count: total, isHalfOff: false,
        price: template.originalPrice, name: template.baseName,
      });
    }
  }

  const canName = config.pinnedOrders[0]?.name ?? 'カン';
  const shotName = config.pinnedOrders[2]?.name ?? 'ショット系';

  return mergedOrders.map(o => {
    if (o.baseName === canName && o.canHalfOff) {
      return {
        ...o, isHalfOff: shouldCanHalf,
        price: shouldCanHalf ? calcHalfOffPrice(o.baseName, o.originalPrice, config) : o.originalPrice,
        name: shouldCanHalf ? `${o.baseName} (半額)` : o.baseName,
      };
    }
    if (o.baseName === shotName && o.canHalfOff) {
      return {
        ...o, isHalfOff: shouldShotHalf,
        price: shouldShotHalf ? calcHalfOffPrice(o.baseName, o.originalPrice, config) : o.originalPrice,
        name: shouldShotHalf ? `${o.baseName} (半額)` : o.baseName,
      };
    }
    return o;
  });
}

export type Action =
  | { type: 'SET_CUSTOMER_TYPE'; payload: CustomerType }
  | { type: 'SET_ENTRY_TIME'; payload: string }
  | { type: 'SET_CURRENT_TIME'; payload: string }
  | { type: 'TOGGLE_DOHAN' }
  | { type: 'TOGGLE_SET_HALF_OFF' }
  | { type: 'TOGGLE_GIRLS_PARTY' }
  | { type: 'TOGGLE_APPRECIATION_DAY' }
  | { type: 'TOGGLE_SEVEN_LUCK' }
  | { type: 'TOGGLE_GOLD_TICKET' }
  | { type: 'SET_INITIAL_SET_PRICE'; payload: number }
  | { type: 'SET_ADDITIONAL_NOMINATION_COUNT'; payload: number }
  | { type: 'TOGGLE_DEBUG_MODE' }
  | { type: 'ADD_ORDER'; payload: { name: string; price: number; isTaxIncluded?: boolean; canHalfOff?: boolean; isHalfOff?: boolean } }
  | { type: 'UPDATE_ORDER_COUNT'; payload: { id: string; delta: number } }
  | { type: 'SET_ORDER_COUNT'; payload: { id: string; count: number } }
  | { type: 'TOGGLE_ORDER_HALF_OFF'; payload: string }
  | { type: 'REMOVE_ORDER'; payload: string }
  | { type: 'RESET' };

export function calculatorReducer(state: CalculatorState, action: Action, config: StoreConfig): CalculatorState {
  switch (action.type) {
    case 'SET_CUSTOMER_TYPE': {
      const nextType = action.payload;
      return {
        ...state, customerType: nextType,
        orders: syncHalfOffOrders(state.orders, nextType, state.isGirlsParty, state.isAppreciationDay, state.isSevenLuck, config),
      };
    }
    case 'SET_ENTRY_TIME':
      return { ...state, entryTime: action.payload };
    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.payload };
    case 'TOGGLE_DOHAN':
      return { ...state, dohan: !state.dohan };
    case 'TOGGLE_SET_HALF_OFF': {
      // 感謝デー中はセット半額がデフォルトで適用されるため、手動切替を禁止
      if (state.isAppreciationDay) return state;
      const nextSetHalfOff = !state.isSetHalfOff;
      // セット半額ONの時はゴールドカードを強制OFF（併用不可）
      return {
        ...state,
        isSetHalfOff: nextSetHalfOff,
        isGoldTicket: nextSetHalfOff ? false : state.isGoldTicket,
      };
    }
    case 'TOGGLE_GIRLS_PARTY':
    case 'TOGGLE_APPRECIATION_DAY':
    case 'TOGGLE_SEVEN_LUCK': {
      // 女子会デー / 感謝DAY は排他（同じ種類の割引なので併用不可）
      // セブンラックは両方と併用可能（半額ロジック側で二重割引防止済み）
      const nextGirls = action.type === 'TOGGLE_GIRLS_PARTY'
        ? !state.isGirlsParty
        : (action.type === 'TOGGLE_APPRECIATION_DAY' && !state.isAppreciationDay ? false : state.isGirlsParty);
      const nextAppreciation = action.type === 'TOGGLE_APPRECIATION_DAY'
        ? !state.isAppreciationDay
        : (action.type === 'TOGGLE_GIRLS_PARTY' && !state.isGirlsParty ? false : state.isAppreciationDay);
      const nextSeven = action.type === 'TOGGLE_SEVEN_LUCK' ? !state.isSevenLuck : state.isSevenLuck;
      return {
        ...state,
        isGirlsParty: nextGirls,
        isAppreciationDay: nextAppreciation,
        isSevenLuck: nextSeven,
        // 感謝DAY中は手動セット半額をリセット（感謝DAYで自動適用されるため）
        isSetHalfOff: nextAppreciation ? false : state.isSetHalfOff,
        orders: syncHalfOffOrders(state.orders, state.customerType, nextGirls, nextAppreciation, nextSeven, config),
      };
    }
    case 'TOGGLE_GOLD_TICKET': {
      const nextGold = !state.isGoldTicket;
      // ゴールドカードONの時はセット半額を強制OFF（併用不可）
      return {
        ...state,
        isGoldTicket: nextGold,
        isSetHalfOff: nextGold ? false : state.isSetHalfOff,
      };
    }
    case 'SET_INITIAL_SET_PRICE':
      return { ...state, initialSetPrice: action.payload };
    case 'SET_ADDITIONAL_NOMINATION_COUNT':
      return { ...state, additionalNominationCount: Math.max(0, action.payload) };
    case 'TOGGLE_DEBUG_MODE':
      return { ...state, isDebugMode: !state.isDebugMode };
    case 'ADD_ORDER': {
      const baseName = action.payload.name;
      const existing = state.orders.find(o => o.baseName === baseName);
      if (existing) {
        return { ...state, orders: state.orders.map(o => o.id === existing.id ? { ...o, count: o.count + 1 } : o) };
      }
      const isHalf = action.payload.isHalfOff || false;
      const originalPrice = action.payload.price;
      const effectivePrice = isHalf ? calcHalfOffPrice(baseName, originalPrice, config) : originalPrice;
      const displayName = isHalf ? `${baseName} (半額)` : baseName;

      const newOrder: OrderItem = {
        id: genId(), name: displayName, baseName,
        price: effectivePrice, originalPrice, count: 1,
        isTaxIncluded: action.payload.isTaxIncluded,
        canHalfOff: action.payload.canHalfOff, isHalfOff: isHalf,
      };
      return { ...state, orders: [...state.orders, newOrder] };
    }
    case 'UPDATE_ORDER_COUNT':
      return {
        ...state,
        orders: state.orders.map(o => {
          if (o.id === action.payload.id) return { ...o, count: Math.max(0, o.count + action.payload.delta) };
          return o;
        }).filter(o => o.count > 0 || o.isPinned)
      };
    case 'SET_ORDER_COUNT':
      return {
        ...state,
        orders: state.orders.map(o => {
          if (o.id === action.payload.id) return { ...o, count: Math.max(0, action.payload.count) };
          return o;
        }).filter(o => o.count > 0 || o.isPinned)
      };
    case 'TOGGLE_ORDER_HALF_OFF':
      return {
        ...state,
        orders: state.orders.map(o => {
          if (o.id === action.payload && o.canHalfOff) {
            const newHalfOff = !o.isHalfOff;
            const newPrice = newHalfOff ? calcHalfOffPrice(o.baseName, o.originalPrice, config) : o.originalPrice;
            return { ...o, isHalfOff: newHalfOff, price: newPrice, name: newHalfOff ? `${o.baseName} (半額)` : o.baseName };
          }
          return o;
        })
      };
    case 'REMOVE_ORDER':
      return { ...state, orders: state.orders.filter(o => o.id !== action.payload) };
    case 'RESET':
      return {
        ...createInitialState(config),
        currentTime: state.currentTime,
        isDebugMode: state.isDebugMode,
      };
    default:
      return state;
  }
}

export function calculateResult(state: CalculatorState, config: StoreConfig, options?: { loCapEnabled?: boolean }): CalculationResult {
  const { customerType, initialSetPrice, entryTime, currentTime, dohan, isSetHalfOff, orders, isAppreciationDay, isGoldTicket, additionalNominationCount } = state;

  const [entryH, entryM] = entryTime.split(':').map(Number);
  const normalizedEntryH = entryH < 18 ? entryH + 24 : entryH;

  const [currentH, currentM_raw] = currentTime.split(':').map(Number);
  const originalNormalizedCurrentH = currentH < 18 ? currentH + 24 : currentH;

  let normalizedCurrentH = originalNormalizedCurrentH;
  let currentM = currentM_raw;
  let isOutOfHours = false;

  if (originalNormalizedCurrentH < 20 || originalNormalizedCurrentH > config.closingHour || (originalNormalizedCurrentH === config.closingHour && currentM_raw > 0)) {
    normalizedCurrentH = normalizedEntryH + 1;
    currentM = entryM;
    isOutOfHours = true;
  }

  let baseSetPrice = 0;
  let extUnitCost = 0;
  let nomPrice = 0;
  let tcPrice = 0;

  if (customerType === 'regular') {
    const isEarly = normalizedEntryH < config.regularPricing.thresholdHour;
    baseSetPrice = isEarly ? config.regularPricing.earlySet : config.regularPricing.lateSet;
    extUnitCost = config.regularPricing.ext;
    nomPrice = config.regularPricing.nom;
    tcPrice = config.regularPricing.tc;
  } else if (customerType === 'initial') {
    baseSetPrice = initialSetPrice;
    extUnitCost = config.initialPricing.ext;
    nomPrice = config.initialPricing.nom;
    tcPrice = config.initialPricing.tc;
  } else if (customerType === 'r_within') {
    baseSetPrice = config.rWithinPricing.set;
    extUnitCost = config.rWithinPricing.ext;
    nomPrice = config.rWithinPricing.nom;
    tcPrice = config.rWithinPricing.tc;
  } else {
    baseSetPrice = config.rAfterPricing.set;
    extUnitCost = config.rAfterPricing.ext;
    nomPrice = config.rAfterPricing.nom;
    tcPrice = config.rAfterPricing.tc;
  }

  if (isGoldTicket) {
    baseSetPrice = config.goldTicket.setOverride;
    extUnitCost = config.goldTicket.extOverride;
  }

  let appliedSetHalfOff = false;
  // ゴールドカード使用時はセット半額を適用しない（併用不可）
  if ((isSetHalfOff || isAppreciationDay) && customerType === 'regular' && !isGoldTicket) {
    baseSetPrice = Math.floor(baseSetPrice / 2);
    extUnitCost = Math.floor(extUnitCost / 2);
    appliedSetHalfOff = true;
  }

  const nomTotal = nomPrice;
  const dohanTotal = (dohan && customerType !== 'initial') ? config.dohanFee : 0;
  const tcTotal = tcPrice;
  const additionalNominationTotal = additionalNominationCount * config.additionalNominationFee;

  const combinedNomAmount = nomTotal + dohanTotal;
  const nomLabel = dohanTotal > 0 ? '指名料+同伴料' : '指名料';

  const activeOrders = orders.filter(o => o.count > 0);
  const totalItemsCount = activeOrders.reduce((sum, item) => sum + item.count, 0);

  let taxRate = config.taxRate;
  if (customerType === 'initial' && totalItemsCount === 0) {
    taxRate = config.initialNoOrderTaxRate;
  }

  const ordersPreTaxTotal = activeOrders.reduce((sum, item) => {
    if (item.isTaxIncluded) return sum + ((item.price * item.count) / (1 + taxRate));
    return sum + (item.price * item.count);
  }, 0);

  const buildBreakdown = (durationHours: number): { breakdown: BreakdownItem[]; finalTotal: number } => {
    const initialSetHours = (isGoldTicket || customerType === 'r_within' || customerType === 'r_after') ? 2 : 1;
    const extensionCount = Math.max(0, durationHours - initialSetHours);
    const setAndExtTotal = baseSetPrice + (extensionCount * extUnitCost);

    const subTotal = setAndExtTotal + combinedNomAmount + tcTotal + additionalNominationTotal + ordersPreTaxTotal;
    const taxAmountRaw = subTotal * taxRate;
    const totalRaw = subTotal + taxAmountRaw;
    const finalTotal = Math.ceil(totalRaw / 100) * 100;

    const breakdown: BreakdownItem[] = [
      { label: `セット料金${appliedSetHalfOff ? '(半額)' : ''} (延長込)`, amount: setAndExtTotal },
      ...activeOrders.map(o => {
        const itemSubTotal = o.isTaxIncluded ? (o.price * o.count) / (1 + taxRate) : (o.price * o.count);
        return { label: `${o.name} x${o.count}`, amount: Math.round(itemSubTotal) };
      }),
      { label: 'T.C', amount: tcTotal },
      { label: nomLabel, amount: combinedNomAmount },
      { label: `複数指名料 (${additionalNominationCount}人)`, amount: additionalNominationTotal },
      { label: '小計 (課税対象)', amount: Math.round(subTotal), isTotal: true },
      { label: `TAX/SVC (${(taxRate * 100).toFixed(0)}%)`, amount: Math.ceil(taxAmountRaw), note: '(十の位以下切り上げ)' }
    ];
    return { breakdown, finalTotal };
  };

  const schedule: PriceScheduleItem[] = [];
  let loopTimeH = normalizedEntryH + 1;
  const loopTimeM = entryM;

  const entryTotalMins = normalizedEntryH * 60 + entryM;
  const loCapEnabled = options?.loCapEnabled ?? false;
  const loCapDurationSets = loCapEnabled
    ? Math.ceil(Math.max(0, config.loCapNormalizedMins - entryTotalMins) / 60)
    : Infinity;

  while (loopTimeH < config.closingHour) {
    const duration = loopTimeH - normalizedEntryH;
    const loopTotalMins = loopTimeH * 60 + loopTimeM;
    const effectiveDuration = (loCapEnabled && loopTotalMins > config.loCapNormalizedMins)
      ? Math.min(duration, loCapDurationSets) : duration;
    const { finalTotal, breakdown: schBreakdown } = buildBreakdown(effectiveDuration);

    const displayH = loopTimeH >= 24 ? loopTimeH - 24 : loopTimeH;
    const displayM = loopTimeM.toString().padStart(2, '0');
    schedule.push({ timeLimit: `${displayH}:${displayM}`, totalPrice: finalTotal, breakdown: schBreakdown });
    loopTimeH++;
  }

  const closingTotalMins = config.closingHour * 60;
  const durationMins = closingTotalMins - entryTotalMins;
  const durationSets = Math.ceil(durationMins / 60);
  const closingEffectiveSets = loCapEnabled ? Math.min(durationSets, loCapDurationSets) : durationSets;
  const { finalTotal: closingTotal, breakdown: closingBreakdown } = buildBreakdown(closingEffectiveSets);

  const closingDisplayH = config.closingHour >= 24 ? config.closingHour - 24 : config.closingHour;
  schedule.push({ timeLimit: `${String(closingDisplayH).padStart(2, '0')}:00`, totalPrice: closingTotal, breakdown: closingBreakdown });

  let currentDurationSets = 1;
  const currentTotalMins = normalizedCurrentH * 60 + currentM;
  const diffMins = currentTotalMins - entryTotalMins;
  if (diffMins > 0) currentDurationSets = Math.ceil(diffMins / 60);

  const { breakdown: currentBreakdown, finalTotal: currentFinalTotal } = buildBreakdown(currentDurationSets);

  // ワンセット前の料金（延長が1回以上ある場合のみ）
  let previousTotal: number | null = null;
  let previousBreakdown: BreakdownItem[] | null = null;
  if (currentDurationSets > 1) {
    const prev = buildBreakdown(currentDurationSets - 1);
    previousTotal = prev.finalTotal;
    previousBreakdown = prev.breakdown;
  }

  return { currentTotal: currentFinalTotal, breakdown: currentBreakdown, previousTotal, previousBreakdown, schedule, taxRate, isOutOfHours };
}

// 一意 ID 生成（Date.now ではなくカウンタ＋乱数で衝突回避）
let __idSeq = 0;
function genId(): string {
  __idSeq += 1;
  return `o_${__idSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

// 既定 config を使った計算（呼び出し側が config を持たない場面の保険）
export function calculateWithDefault(state: CalculatorState): CalculationResult {
  return calculateResult(state, createDefaultStoreConfig());
}
