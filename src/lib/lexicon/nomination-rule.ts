/**
 * 「本指名」の判定規則（Day126・純関数）。
 *
 * 旧実装は `resolveSaleAttribution` に **1 つの定義が直書き**されていた——
 * 「卓の本指名リストに担当が居れば本指名」。これは A 店の定義であって、
 * 「前回から同じ担当なら本指名」で回している店に使わせると、**指名料もバックも静かに間違う**。
 * 数字は出るので誰も気づけない（今週ずっと直してきた「もっともらしい誤り」の設定版）。
 *
 * 規則は**自由記述にせず選択肢＋パラメータに閉じる**。こうすると
 * AI には Config を書かせるだけで済み、規則を実行するのはコードのままにできる
 * （AI に判定ロジックを書かせると、店ごとに検証もテストもできない実装が増える）。
 */
import type { NominationKind } from '@/lib/pos/attribution';

/** 本指名の判定基準 */
export type NominationBasis =
  /** 卓の本指名リストに担当が居れば本指名（従来の唯一の実装＝既定） */
  | 'tableMainHost'
  /** 顧客カルテの担当と一致すれば本指名（＝前回から継続している客） */
  | 'customerMainCast'
  /** 上のどちらかを満たせば本指名 */
  | 'either';

export type NominationRule = {
  basis: NominationBasis;
  /**
   * 顧客カルテが無い（＝初回来店で担当が特定できない）ときの扱い。
   * 「不明だから本指名」に倒すと売上が過大に、「フリー」に倒すと担当の実績が消える。
   * どちらへ倒すかは店舗の運用なので**設定として明示させる**（既定は場内）。
   */
  firstVisitAs: 'inhouse' | 'primary';
};

export const DEFAULT_NOMINATION_RULE: NominationRule = {
  basis: 'tableMainHost',
  firstVisitAs: 'inhouse',
};

/** 判定に使う事実（呼び出し側が集める。無いものは undefined で渡す） */
export type NominationContext = {
  /** 会計時に確定した担当（null＝担当なし） */
  castId: string | null;
  /** 卓の本指名リスト */
  mainHostIds?: string[];
  /** 顧客カルテの担当。顧客が紐付いていない・カルテが無い場合は undefined */
  customerMainCastId?: string | null;
  /** 顧客が伝票に紐付いているか（紐付いていなければ「初回扱い」の判断もできない） */
  hasCustomer?: boolean;
};

/** 保存値を規則へ正規化（未知の値・古いデータは既定へ倒す。型が壊れても落ちない） */
export function normalizeNominationRule(raw: unknown): NominationRule {
  const r = (raw ?? {}) as Partial<NominationRule>;
  const basis: NominationBasis =
    r.basis === 'customerMainCast' || r.basis === 'either' || r.basis === 'tableMainHost'
      ? r.basis
      : DEFAULT_NOMINATION_RULE.basis;
  const firstVisitAs = r.firstVisitAs === 'primary' ? 'primary' : DEFAULT_NOMINATION_RULE.firstVisitAs;
  return { basis, firstVisitAs };
}

/**
 * 指名区分を判定する。
 *
 * 担当が居なければ必ずフリー（これは店舗設定に依らない）。
 * `customerMainCast` / `either` で**顧客が紐付いていない**場合は「継続かどうかを確かめられない」
 * ので、確かめられないことを本指名と断定せず `firstVisitAs` の指定に従う。
 */
export function resolveNominationKind(rule: NominationRule, ctx: NominationContext): NominationKind {
  if (!ctx.castId) return 'free';
  const byTable = (ctx.mainHostIds ?? []).includes(ctx.castId);
  if (rule.basis === 'tableMainHost') return byTable ? 'main' : 'inTable';

  // 顧客カルテを見る規則。カルテが引けない＝判定不能なので設定に従う（推測しない）
  const known = ctx.hasCustomer === true && ctx.customerMainCastId !== undefined;
  const byCustomer = known && !!ctx.customerMainCastId && ctx.customerMainCastId === ctx.castId;

  if (rule.basis === 'either') {
    if (byTable || byCustomer) return 'main';
    return known ? 'inTable' : (rule.firstVisitAs === 'primary' ? 'main' : 'inTable');
  }
  // basis === 'customerMainCast'
  if (byCustomer) return 'main';
  if (known) return 'inTable';
  return rule.firstVisitAs === 'primary' ? 'main' : 'inTable';
}
