// AI 機能の緊急停止スイッチ（2026-08-25・予算逼迫による緊急対応）。
//
// 背景: 予算が尽きかけており、AI が使われ続けると本当にまずい状況。出回っている
// クライアント（iOS 1.0 / 1.1 / Web / nomishugy）は**コード変更が間に合わない**ため、
// 止められるのはサーバだけ。
//
// ## 設計方針
//
// 1. **Firestore の `global_settings/ai_kill_switch` で切り替える**。env だと Vercel の
//    再デプロイが要り「予算が増えたらオンに戻す」が重い操作になる。rules は
//    `global_settings` を `read: true` / 書込は admin のみにしているので、
//    管理者がドキュメントを 1 つ書き換えるだけで**再デプロイ無しに**戻せる。
// 2. **既定は停止（fail-closed）**。doc が無い / 読めないときは止める。予算の止血が
//    目的なので、迷ったら止める方に倒す。読み取り失敗で勝手に再開しない。
// 3. **429 は使わない**。iOS の APIClient は 429 を `insufficientCredits` として特別扱いし、
//    `creditsRemaining` を読んで `AICreditStore` を書き換える（残高表示が壊れる）。
//    **503** を返す。`{"error":"…"}` の文字列は iOS の `APIError.serverError` が
//    そのままユーザーに表示するので、これが実質の UI になる。
//
// ## 再開のしかた（管理者）
//   global_settings/ai_kill_switch を { disabled: false } にする。以上。
//   停止に戻すときは { disabled: true }。文言を変えるなら message も入れる。

import { NextResponse } from 'next/server';
import { getAdminDb } from './firebase-admin';

const DOC_PATH = 'global_settings/ai_kill_switch';

/** キャッシュ期間。AI 呼び出しのたびに Firestore を読まないための短い保持 */
const CACHE_MS = 30_000;

/** 既定文言。ユーザーが読む唯一のものになるので、状況と次にどうなるかを書く */
const DEFAULT_MESSAGE =
  'AI 機能は現在一時停止しています。ご不便をおかけして申し訳ありません。再開までしばらくお待ちください。';

/** 購入済みクレジットを持つ人向けの文言（allowPurchasedCredits が false のとき） */
const DEFAULT_PURCHASED_MESSAGE =
  'AI 機能は現在一時停止しています。ご購入いただいたクレジットは残高として保持されており、再開後にそのままお使いいただけます。';

export interface AiKillSwitchState {
  /** true なら AI を止める */
  disabled: boolean;
  /** 停止中に返す文言 */
  message: string;
  /** 購入済みクレジット保持者だけ通す（支払い済みの対価を履行する運用） */
  allowPurchasedCredits: boolean;
  /** 購入者向けの文言 */
  purchasedMessage: string;
  /** 無料クレジットの配布（ミッション報酬・紹介報酬）も止めるか */
  stopFreeCreditGrants: boolean;
}

const FAIL_CLOSED: AiKillSwitchState = {
  disabled: true,
  message: DEFAULT_MESSAGE,
  allowPurchasedCredits: false,
  purchasedMessage: DEFAULT_PURCHASED_MESSAGE,
  stopFreeCreditGrants: true,
};

let cached: { at: number; state: AiKillSwitchState } | null = null;

function parse(data: Record<string, unknown> | undefined): AiKillSwitchState {
  if (!data) return FAIL_CLOSED;
  const str = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback;
  return {
    // 明示的に false と書かれたときだけ有効化する（未設定＝停止）
    disabled: data.disabled !== false,
    message: str(data.message, DEFAULT_MESSAGE),
    allowPurchasedCredits: data.allowPurchasedCredits === true,
    purchasedMessage: str(data.purchasedMessage, DEFAULT_PURCHASED_MESSAGE),
    // 無料配布の停止は既定 true（停止側）。明示的に false のときだけ配る
    stopFreeCreditGrants: data.stopFreeCreditGrants !== false,
  };
}

/** テスト用。キャッシュを捨てる */
export function resetAiKillSwitchCache(): void {
  cached = null;
}

const ENABLED_BY_ENV: AiKillSwitchState = { ...FAIL_CLOSED, disabled: false, stopFreeCreditGrants: false };

export async function getAiKillSwitch(): Promise<AiKillSwitchState> {
  // env による明示指定を最優先で見る。Firestore を読まないので、
  // 「本番の設定に関係なく確実に止める / 動かす」用途に使える。
  //   AI_KILL_SWITCH=1 … 止める（Firestore を読まずに即停止）
  //   AI_KILL_SWITCH=0 … 動かす（テスト・ローカル開発用。**本番では設定しないこと**）
  // 未設定なら Firestore を見る（既定は停止＝fail-closed）。
  const envSwitch = process.env.AI_KILL_SWITCH;
  if (envSwitch === '1') return FAIL_CLOSED;
  if (envSwitch === '0') return ENABLED_BY_ENV;

  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.state;
  try {
    const snap = await getAdminDb().doc(DOC_PATH).get();
    const state = parse(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
    cached = { at: now, state };
    return state;
  } catch (e) {
    // 読めなかったときは**直前に読めた値**を使う（一時障害で勝手に再開/停止しない）。
    // 一度も読めていなければ停止側に倒す
    console.error('[ai-kill-switch] 設定の読み取りに失敗', e);
    if (cached) return cached.state;
    return FAIL_CLOSED;
  }
}

/**
 * AI ルートの入口で呼ぶ。停止中なら 503 の NextResponse を返す（呼び出し側はそのまま return）。
 * 通してよいときは null を返す。
 *
 * **クレジットの予約より手前で呼ぶこと。** 予約 → 拒否 → 返金の往復を作らないため。
 */
export async function aiKillSwitchResponse(uid?: string): Promise<NextResponse | null> {
  const state = await getAiKillSwitch();
  if (!state.disabled) return null;

  if (state.allowPurchasedCredits && uid) {
    // 支払い済みの対価は履行する運用。購入済み残高がある人だけ通す
    try {
      const snap = await getAdminDb().doc(`account_subscriptions/${uid}`).get();
      const purchased = Number(snap.data()?.purchasedCredits ?? 0);
      if (Number.isFinite(purchased) && purchased > 0) return null;
    } catch (e) {
      // 判定できないときは通さない（止血が目的）
      console.error('[ai-kill-switch] 購入済み残高の確認に失敗', e);
    }
    return NextResponse.json({ error: state.purchasedMessage }, { status: 503 });
  }

  return NextResponse.json({ error: state.message }, { status: 503 });
}

/** AI 機能を停止中に投げる型。プロバイダ層の最後の砦（課金が発生しないことの保証） */
export class AiDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiDisabledError';
  }
}

/**
 * プロバイダ呼び出しの手前で使う安全網。ルート側の入口チェックを足し忘れても、
 * ここで throw すれば**外部 API を叩かない＝原価が発生しない**。
 */
export async function assertAiEnabled(): Promise<void> {
  const state = await getAiKillSwitch();
  if (state.disabled) throw new AiDisabledError(state.message);
}
