/**
 * 会計時の売上帰属の解決（純ロジック・単体テスト対象）。
 *
 * 旧実装の問題: checkoutSlip が `slip.castUid ?? operatorUid` で帰属していたため、
 * 伝票に castId/castName はあるのに castUid が無い（伝票作成後にアカウント連携した等）
 * ケースで、担当キャストではなく「会計操作をした人」の個人売上に誤帰属していた。
 * ここで castId → castName の順に名簿から uid を解決し、誤帰属を防ぐ。
 *
 * あわせて個人売上台帳（personal_sales / 担当台帳ログ）に必要な区分
 * （本指名/場内/フリー・同伴）を会計時点で確定する。転記自体は既存の
 * Cloud Functions `syncShopSaleToPersonal` が sales doc から冪等に投影する
 * （他人の personal_sales へのクライアント直接書込は rules の isSelf モデルを
 * 崩すため行わない）。
 */
import type { PosSlip } from './engine';
import {
  DEFAULT_NOMINATION_RULE, resolveNominationKind, type NominationRule,
} from '@/lib/lexicon/nomination-rule';

/** 指名区分: main=本指名 / inTable=場内（担当指定あり） / free=担当なし */
export type NominationKind = 'main' | 'inTable' | 'free';

export type CastLike = { id: string; name: string; uid?: string | null };

export type SaleAttribution = {
  /** 個人売上の帰属先 uid（解決不能時は操作者=従来挙動を維持） */
  castUid: string;
  castId: string | null;
  castName: string | null;
  nomination: NominationKind;
  dohan: boolean;
};

export function resolveSaleAttribution(opts: {
  /** 店舗設定 salesAttribution（operator=常に操作者へ付ける） */
  mode: 'mainCast' | 'operator';
  operatorUid: string;
  slip: Pick<PosSlip, 'castUid' | 'castId' | 'castName' | 'state' | 'customerId'>;
  casts: CastLike[];
  /** 会計フォームで担当名を上書きした場合（castName 手入力） */
  overrideCastName?: string;
  /** 卓の本指名（指名区分の判定用） */
  mainHostIds?: string[];
  /**
   * 本指名の判定規則（店舗設定・Day126）。省略時は従来どおり「卓の本指名リスト」基準。
   * 旧実装はこの 1 つの定義を全店に強制しており、「前回から同じ担当なら本指名」で
   * 回している店では指名料もバックも静かに間違っていた。
   */
  nominationRule?: NominationRule;
  /** 伝票に紐付いた顧客カルテの担当（規則が customerMainCast のときに使う） */
  customerMainCastId?: string | null;
}): SaleAttribution {
  const { mode, operatorUid, slip, casts, overrideCastName, mainHostIds } = opts;

  // 担当キャストの実体解決: castId 優先、無ければ名前一致（上書き名 > 伝票名）
  const nameCandidate = (overrideCastName?.trim() || slip.castName || '').trim();
  const byId = slip.castId ? casts.find((c) => c.id === slip.castId) : undefined;
  // 会計時に担当名を書き換えた場合は、名前一致を castId より優先する（上書きの意図を尊重）
  const byName = nameCandidate ? casts.find((c) => c.name === nameCandidate) : undefined;
  const overridden = !!overrideCastName?.trim() && overrideCastName.trim() !== (slip.castName ?? '');
  // 上書き時は名簿一致のみ採用（旧担当の uid を使うと「表示名と帰属がズレる」ため）
  const cast = overridden ? byName : (byId ?? byName);

  // 上書き名が名簿に無い場合、旧 castId を残すと名前と区分判定がズレるため null にする
  const castId = cast?.id ?? (overridden ? null : slip.castId ?? null);
  const castName = cast?.name ?? (nameCandidate || null);

  // 帰属 uid: operator モードは常に操作者。mainCast モードは
  // 伝票の castUid > 名簿解決 uid > 操作者（従来のフォールバックを維持＝機能退化なし）
  const resolvedUid = overridden
    ? (cast?.uid ?? null)
    : (slip.castUid ?? cast?.uid ?? null);
  const castUid = mode === 'operator' ? operatorUid : (resolvedUid ?? operatorUid);

  const nomination: NominationKind = resolveNominationKind(
    opts.nominationRule ?? DEFAULT_NOMINATION_RULE,
    {
      castId,
      mainHostIds,
      customerMainCastId: opts.customerMainCastId,
      hasCustomer: !!slip.customerId,
    },
  );

  return { castUid, castId, castName, nomination, dohan: !!slip.state.dohan };
}
