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
import { getAdminDb, getAdminAuth } from './firebase-admin';
import { enterAiRequest, currentAiUid } from './ai-request-context';

const DOC_PATH = 'global_settings/ai_kill_switch';

/** キャッシュ期間。AI 呼び出しのたびに Firestore を読まないための短い保持 */
const CACHE_MS = 30_000;

/** 既定文言。ユーザーが読む唯一のものになるので、状況と次にどうなるかを書く */
// 「AI 以外は使える」を必ず添える。iOS ではこの文言が**ユーザーが読む唯一の説明**になるため、
// AI が止まっただけなのに「アプリが壊れた」と受け取られるのが一番まずい（yorulog の指摘）。
// Noxa は CRM として AI 抜きで完結するので、一言添えるだけで印象が変わる。
const DEFAULT_MESSAGE =
  'AI 機能は現在一時停止しています。ご不便をおかけして申し訳ありません。再開までしばらくお待ちください。'
  + '\nAI 以外の機能（顧客管理・売上記録・集計・目標）は通常どおりご利用いただけます。';

/** 購入済みクレジットを持つ人向けの文言（allowPurchasedCredits が false のとき） */
const DEFAULT_PURCHASED_MESSAGE =
  'AI 機能は現在一時停止しています。ご購入いただいたクレジットは残高として保持されており、再開後にそのままお使いいただけます。'
  + '\nAI 以外の機能（顧客管理・売上記録・集計・目標）は通常どおりご利用いただけます。';

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
  /** 停止中でも通す uid（App Store 審査用のデモアカウント等）。完全一致のみ */
  exemptUids: string[];
  /** 同上をメールで指定（uid が判らない運用向け）。Admin Auth で解決する */
  exemptEmails: string[];
}

/** 除外リストの上限。長大なリストで実質的に停止が無効化されるのを防ぐ */
const MAX_EXEMPT = 10;

/** 除外リストの正規化。**壊れていたら空にする**（緩い側に倒さない） */
function parseExemptList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= MAX_EXEMPT) break;
  }
  return out;
}

/**
 * doc が無い / 読めないときの既定。
 *
 * `disabled: true`（止める）が基本方針だが、**購入者だけは通す**（ユーザー決定 2026-08-25・案 a）。
 * 「お金を払ったのに使えない」は返金要求や Apple への苦情につながる一番まずい形なので、
 * 設定 doc を作り忘れてもその状態にならないよう、決定内容を既定側に埋めておく。
 * 無料枠の配布は止めたままにする。
 */
const FAIL_CLOSED: AiKillSwitchState = {
  disabled: true,
  message: DEFAULT_MESSAGE,
  allowPurchasedCredits: true,
  purchasedMessage: DEFAULT_PURCHASED_MESSAGE,
  stopFreeCreditGrants: true,
  // 既定は除外なし。doc が読めないときに誰かが素通りする形にはしない
  exemptUids: [],
  exemptEmails: [],
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
    // 既定は true（購入者は通す・ユーザー決定 案 a）。明示的に false のときだけ全員止める
    allowPurchasedCredits: data.allowPurchasedCredits !== false,
    purchasedMessage: str(data.purchasedMessage, DEFAULT_PURCHASED_MESSAGE),
    // 無料配布の停止は既定 true（停止側）。明示的に false のときだけ配る
    stopFreeCreditGrants: data.stopFreeCreditGrants !== false,
    exemptUids: parseExemptList(data.exemptUids),
    exemptEmails: parseExemptList(data.exemptEmails).map((e) => e.toLowerCase()),
  };
}

/** テスト用。キャッシュを捨てる */
export function resetAiKillSwitchCache(): void {
  cached = null;
}

const ENABLED_BY_ENV: AiKillSwitchState = {
  ...FAIL_CLOSED, disabled: false, stopFreeCreditGrants: false, exemptUids: [], exemptEmails: [],
};

/** uid → email の解決結果。Auth 参照を毎リクエスト行わないための短い保持 */
const emailCache = new Map<string, { at: number; email: string | null }>();
const EMAIL_CACHE_MS = 5 * 60_000;

/**
 * 停止中でも通す uid か。
 *
 * App Store 審査でデモアカウントが AI を試せないと Guideline 2.1（App Completeness）で
 * 弾かれ得るため、審査用アカウントだけ通す口を用意する。
 * **緩いと止血に穴が開く**ので、完全一致のみ・件数上限あり・判定できなければ通さない。
 */
async function isExemptUid(state: AiKillSwitchState, uid: string | undefined): Promise<boolean> {
  if (!uid) return false;
  if (state.exemptUids.includes(uid)) return true;
  if (state.exemptEmails.length === 0) return false;

  const now = Date.now();
  const hit = emailCache.get(uid);
  let email = hit && now - hit.at < EMAIL_CACHE_MS ? hit.email : undefined;
  if (email === undefined) {
    try {
      const rec = await getAdminAuth().getUser(uid);
      email = rec.email ? rec.email.toLowerCase() : null;
    } catch (e) {
      // 解決できなければ**通さない**（止血が目的）
      console.error('[ai-kill-switch] 除外判定のためのメール解決に失敗', e);
      return false;
    }
    emailCache.set(uid, { at: now, email });
  }
  return email !== null && state.exemptEmails.includes(email);
}

/** テスト用。メール解決のキャッシュも捨てる */
export function resetAiExemptionCache(): void {
  emailCache.clear();
}

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
  // 以降の非同期チェーン（openrouter.ts の安全網まで）で実行者が判るようにする。
  // 停止していない場合も登録しておく（安全網が uid を必要とするのは停止中だけだが、
  // 「入口を通った＝uid が判っている」状態を一貫させる）
  if (uid) enterAiRequest(uid);

  const state = await getAiKillSwitch();
  if (!state.disabled) return null;

  // 審査用デモアカウント等は通す
  if (await isExemptUid(state, uid)) return null;

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
  if (!state.disabled) return;
  // ルート入口で登録された実行者を見る。取れなければ除外は成立しない（＝止まる）
  if (await isExemptUid(state, currentAiUid())) return;
  throw new AiDisabledError(state.message);
}
