'use client';

/**
 * 店舗カスタム設定レイヤー（DBは固定・設定だけ shop_shops/{id}/config/settings に集約）。
 * 各モジュールはハードコードをやめてここを読む：
 *   - terminology … 用語辞書（キャスト/指名/卓 等の呼称・上書き）
 *   - roles       … 役職＋既定時給（キャストrankのハードコード解消）
 *   - modules     … モジュールの有効/並び/表示名
 *   - salesAttribution … 売上の付け方（担当キャスト or 操作者）
 * 料金/税/メニュー/卓名は既存の pos_config（POS設定）で編集（卓は seating_tables 単一の正）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import { describeFirestoreError } from '@/lib/firestore-error';
import { valueForScope, type ScopedSnapshot } from '@/lib/scoped-snapshot';
import { CONCEPT_DEFAULT_TERMS, type ConceptId } from '@/lib/lexicon/concepts';
import {
  DEFAULT_NOMINATION_RULE, normalizeNominationRule, type NominationRule,
} from '@/lib/lexicon/nomination-rule';

/** 業種が未取得・別店舗のときの空値（前の店の業種を持ち越さない） */
const EMPTY_INDUSTRY: { industry?: string; error: string | null } = { industry: undefined, error: null };

export type ModuleCfg = { key: string; enabled: boolean; label?: string };
export type RoleWage = { name: string; wage: number };
export type SalesAttribution = 'mainCast' | 'operator';
/** 店舗が編集できる選択肢（id は保存値・既存データ互換のため不変、label は表示名） */
export type ChoiceItem = { id: string; label: string; color?: string };

export type ShopConfig = {
  terminology: Record<string, string>;
  /**
   * 「本指名」を何をもって本指名とするか（Day126）。呼び名（terminology）と違い、
   * これは**金額とバックが変わる意味の設定**なので別に持つ。
   */
  nominationRule: NominationRule;
  roles: RoleWage[];
  modules: ModuleCfg[];
  salesAttribution: SalesAttribution;
  setTimeLength: number;       // 席回し: 1セット長（分）既定
  rotationTimeLength: number;  // 席回し: 卓内ローテ間隔（分）既定
  transportTypes: ChoiceItem[];      // 送迎タイプ（店舗で追加・改名可）
  inventoryCategories: ChoiceItem[]; // 在庫カテゴリ（店舗で追加・改名可）
};

/** モジュール既定（key は route の slug。NAV_STORE と一致させる） */
export const DEFAULT_MODULES: { key: string; label: string }[] = [
  { key: 'pos', label: 'POS' },
  { key: 'seating', label: '席回し' },
  { key: 'attendance', label: '勤怠' },
  { key: 'payroll', label: '給与' },
  { key: 'first-visit', label: '初回案内' },
  { key: 'transport', label: '送迎' },
  { key: 'inventory', label: '在庫' },
  { key: 'trial', label: '体験入店' },
  { key: 'reservation', label: '予約' },
  { key: 'unpaid', label: '売掛管理' },
  { key: 'risk', label: 'リスク客共有' },
];

/** 既定で表示するコアモジュール（実証済み＋夜職で標準的に使う）。それ以外は既定OFF＝店舗設定でONに。 */
export const CORE_MODULE_KEYS = new Set(['seating', 'pos', 'attendance', 'payroll', 'first-visit']);

export const DEFAULT_ROLES: RoleWage[] = [
  { name: 'BOSS', wage: 10000 },
  { name: '役職', wage: 8000 },
  { name: '非役職', wage: 5000 },
  { name: '新人', wage: 3000 },
];

/** 用語キーの既定（概念 ID ベース・lexicon/concepts.ts が正本） */
export const DEFAULT_TERMS: Record<string, string> = CONCEPT_DEFAULT_TERMS;

/**
 * 業種プリセット（storeTypeName → 呼び名の上書き）。
 *
 * ⚠ 旧実装はホストクラブで `nomination: '本指名'` としていたが、これは**概念の取り違え**。
 * `nomination` は指名の総称（初回案内の「指名を選ぶ」等で使う）で、本指名は
 * `nominationPrimary` という別概念。総称に本指名を入れると、場内指名の客にも
 * 「本指名を選んでください」と出る。概念を分けたうえで呼び名を当てる（Day126）。
 */
export const INDUSTRY_TERMS: Record<string, Record<string, string>> = {
  ホストクラブ: { cast: 'ホスト', nominationPrimary: '本指名', nominationInhouse: '場内', closingRound: '締め' },
  キャバクラ: { cast: 'キャスト', nominationPrimary: '本指名', nominationInhouse: '場内指名' },
  ラウンジ: { cast: 'キャスト', nominationPrimary: '指名', nominationInhouse: '場内' },
  コンカフェ: { cast: 'キャスト', nomination: '推し', nominationPrimary: '本推し', displayName: 'キャラ名', table: '席', checkout: 'お会計' },
  ガールズバー: { cast: 'キャスト', table: '席', nominationPrimary: '指名' },
  スナック: { cast: 'ママ・キャスト', table: '席' },
};

/** 送迎タイプ既定（従来ハードコードの2種。id は保存値なので変更しないこと） */
export const DEFAULT_TRANSPORT_TYPES: ChoiceItem[] = [
  { id: 'companion_pickup', label: '同伴PU', color: 'var(--noxa-accent-primary-ink)' },
  { id: 'after_work', label: '退勤', color: 'var(--noxa-status-info)' },
];

/** 在庫カテゴリ既定（従来ハードコードの3種。id は保存値なので変更しないこと） */
export const DEFAULT_INVENTORY_CATEGORIES: ChoiceItem[] = [
  { id: 'bottle', label: 'ボトル' },
  { id: 'food', label: '食材' },
  { id: 'supply', label: '消耗品' },
];

export const DEFAULT_CONFIG: ShopConfig = {
  terminology: {},
  nominationRule: DEFAULT_NOMINATION_RULE,
  roles: DEFAULT_ROLES,
  modules: DEFAULT_MODULES.map((m) => ({ key: m.key, enabled: CORE_MODULE_KEYS.has(m.key) })),
  salesAttribution: 'mainCast',
  setTimeLength: 60,
  rotationTimeLength: 15,
  transportTypes: DEFAULT_TRANSPORT_TYPES,
  inventoryCategories: DEFAULT_INVENTORY_CATEGORIES,
};

/**
 * 店舗 doc から業種を取り出す（2026-08-26・P153-PM20）。
 *
 * ⚠️ **正本は `storeTypeName`。`businessCategory` は読み手ゼロのフィールドだった。**
 * iOS の新規お店チュートリアルは業種を**必須で聞いて `businessCategory` に保存**しており
 * （yorulog `d20cf02` で `storeTypeName` へ是正済み）、**そこに入れた値は業種プリセットにも
 * テーマにも AI の店舗ヒントにも一度も効いていなかった**。
 * ⚠️ **配布済みの古い iOS ビルド（v1.0 / v1.1 は `READY_FOR_SALE`）は今も
 * `businessCategory` にしか書かない**ので、読み側で拾う。書き戻しはしない
 * （ユーザーの保存操作を待たずに読みで解決する方が安全）。
 * ⚠️ **前後の空白は落とす**。`resolveStoreHintKey` は `trim().toLowerCase()` で緩く見るのに
 * `INDUSTRY_TERMS` と `industryToTheme` は完全一致なので、「ホストクラブ 」のような値で
 * **AI のヒントは効くのに呼び名とテーマは効かない**という割れ方をしていた。
 *
 * 本番実測（2026-08-26・`shop_shops` 全 4 件）: `storeTypeName` のみ 1 件（ホストクラブ）、
 * どちらも無し 3 件、**`businessCategory` だけの店は 0 件**。＝ 現時点の実害はゼロで、
 * ここは**古いクライアントが今後作る店**への備え。
 */
export function resolveIndustry(shopData: { storeTypeName?: unknown; businessCategory?: unknown } | null | undefined): string | undefined {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return pick(shopData?.storeTypeName) ?? pick(shopData?.businessCategory);
}

/**
 * 用語解決: 店舗上書き → 業種プリセット → 既定 → key（key は概念 ID・concepts.ts）。
 *
 * ⚠️ **空文字・空白だけ・文字列でない上書きは「無い」として次の段へ落とす**（P153-PM16）。
 * 旧実装は `??` で繋いでいたため、`''` は nullish ではなく**そのまま返っていた**——
 * 設定画面は入力欄を空にしたまま保存でき（`store/settings` は空値を落とさない）、
 * その店では**ラベルが消えた画面**になる。呼び名が消えるのは「呼び名が空である」ことを
 * 意味しない（＝「無い・分からない」を値として混ぜない、今週の原則の語彙版）。
 * 型違いも同じ扱い。Firestore は文字列以外でも保存できてしまうため。
 */
function usableTerm(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export function resolveTerm(config: ShopConfig | null, industry: string | undefined, key: ConceptId | string): string {
  return usableTerm(config?.terminology?.[key])
    ?? usableTerm(industry ? INDUSTRY_TERMS[industry]?.[key] : undefined)
    ?? usableTerm(DEFAULT_TERMS[key])
    ?? key;
}

/** モジュール構成を既定とマージ（未知/新規モジュールは末尾に有効で補完） */
export function mergeModules(cfg: ModuleCfg[] | undefined): ModuleCfg[] {
  const out: ModuleCfg[] = [];
  const seen = new Set<string>();
  for (const m of cfg ?? []) {
    // 既知モジュールのみ採用。重複キー（保存データの破損等）は先勝ちで1つに畳む
    // （dedup しないと設定 UI に同一モジュールが二重表示され enabled も不整合になる）。
    if (!seen.has(m.key) && DEFAULT_MODULES.some((d) => d.key === m.key)) { out.push(m); seen.add(m.key); }
  }
  for (const d of DEFAULT_MODULES) if (!seen.has(d.key)) out.push({ key: d.key, enabled: CORE_MODULE_KEYS.has(d.key) });
  return out;
}

export type UseShopConfig = {
  loading: boolean;
  shopId: string | null;
  canManage: boolean;
  /** 店舗の確認に失敗した理由（useShopId から素通し。null なら shopId は確定値・Day109） */
  shopError: string | null;
  /**
   * 店舗設定そのものの**読み取りに失敗**した理由（Day110）。
   * 失敗時も表示は既定値で続くが、`config` は**その店舗の設定ではない**。
   * とくに設定画面はこの値がある間フォームを出してはいけない——既定値で初期化された
   * フォームをそのまま保存すると、用語・モジュール構成・ロール時給・送迎タイプ・
   * 在庫カテゴリが**既定値で上書き**されて消える。
   */
  configError: string | null;
  industry: string | undefined;
  config: ShopConfig;
  /** 用語解決（店舗上書き → 業種プリセット → 既定） */
  t: (key: string) => string;
  save: (patch: Partial<ShopConfig>) => Promise<void>;
};

export function useShopConfig(user: User): UseShopConfig {
  const shop = useShopId(user);
  // 出所（shopId）つきスナップショットから config/loading を導出（set-state-in-effect 返済・Day19）
  const [cfgSnap, setCfgSnap] = useState<{ shopId: string; config: ShopConfig; error?: string } | null>(null);
  /**
   * 業種は用語プリセットの土台。config は出所つきなのに**業種だけ出所無しの state** だったため、
   * 店舗を切り替えた直後は「config は既定に戻ったのに用語だけ前の店の業種のまま」という
   * ちぐはぐな表示になっていた（Day123 バグハント）。同じ規則で出所つきにする。
   */
  const [industrySnap, setIndustrySnap] = useState<ScopedSnapshot<{ industry?: string; error: string | null }> | null>(null);
  const { industry, error: industryError } = valueForScope(industrySnap, shop.shopId, EMPTY_INDUSTRY);
  const config = useMemo(
    () => (shop.shopId && cfgSnap?.shopId === shop.shopId ? cfgSnap.config : DEFAULT_CONFIG),
    [cfgSnap, shop.shopId],
  );

  // 業種の取得。読めないと用語が既定へ戻るため、失敗は握り潰さず error に載せる
  useEffect(() => {
    const sid = shop.shopId;
    if (!sid) return;
    getDoc(doc(db, `shop_shops/${sid}`)).then((s) => {
      setIndustrySnap({ scope: sid, value: { industry: resolveIndustry(s.data()), error: null } });
    }).catch((e) => {
      setIndustrySnap({ scope: sid, value: { industry: undefined, error: describeFirestoreError(e, '店舗情報の読み込み') } });
    });
  }, [shop.shopId]);

  useEffect(() => {
    const sid = shop.shopId;
    if (shop.loading || !sid) return;
    const ref = doc(db, `shop_shops/${sid}/config/settings`);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.exists() ? (snap.data() as Partial<ShopConfig>) : {};
      setCfgSnap({ shopId: sid, error: undefined, config: {
        terminology: d.terminology ?? {},
        nominationRule: normalizeNominationRule(d.nominationRule),
        roles: d.roles?.length ? d.roles : DEFAULT_ROLES,
        modules: mergeModules(d.modules),
        salesAttribution: d.salesAttribution ?? 'mainCast',
        setTimeLength: typeof d.setTimeLength === 'number' && d.setTimeLength > 0 ? d.setTimeLength : 60,
        rotationTimeLength: typeof d.rotationTimeLength === 'number' && d.rotationTimeLength > 0 ? d.rotationTimeLength : 15,
        transportTypes: d.transportTypes?.length ? d.transportTypes : DEFAULT_TRANSPORT_TYPES,
        inventoryCategories: d.inventoryCategories?.length ? d.inventoryCategories : DEFAULT_INVENTORY_CATEGORIES,
      } });
    }, (e) => {
      // エラーでも既定で確定し loading は解く（画面は動かす）。ただし「既定＝店舗の設定」ではないので
      // 理由を残す。設定画面はこれを見て編集を止める（既定値での上書き保存の防止・Day110）
      setCfgSnap({ shopId: sid, config: DEFAULT_CONFIG, error: describeFirestoreError(e, '店舗設定の読み込み') });
    });
    return () => unsub();
  }, [shop.loading, shop.shopId]);

  const save = useCallback(async (patch: Partial<ShopConfig>) => {
    if (!shop.shopId) return;
    await setDoc(doc(db, `shop_shops/${shop.shopId}/config/settings`), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  }, [shop.shopId]);

  const t = useCallback((key: string) => resolveTerm(config, industry, key), [config, industry]);

  const configError = shop.shopId && cfgSnap?.shopId === shop.shopId ? (cfgSnap.error ?? industryError) : industryError;

  return { loading: shop.loading || (!!shop.shopId && cfgSnap?.shopId !== shop.shopId), shopId: shop.shopId, canManage: shop.canManage, shopError: shop.shopError, configError, industry, config, t, save };
}
