// AI リクエストの実行者と「どう通されたか」を、同一リクエストの非同期チェーン内で共有する。
//
// なぜ要るか: キルスイッチの安全網は `openrouter.ts` の fetch 直前に置いてある
// （chat が ai-provider を経由しないため）。しかしそこには uid が届かない。
// 審査用デモアカウントだけ通す、といった **uid 依存の判定**を安全網側でも行うには、
// リクエスト単位で uid を持ち回る必要がある。
//
// グローバル変数に持つと、同一インスタンスで並行処理された別リクエストに
// 漏れる（＝関係ないユーザーが除外扱いになり止血に穴が開く）。
// AsyncLocalStorage は非同期コンテキストごとに分離されるのでその事故が起きない。
//
// `enterWith` を使うのは、ルートの入口で uid が判った時点から
// **そのリクエストの残り全体**に効かせたいため（run() はコールバック内しか包めない）。
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 停止中にこのリクエストを通した理由（P147）。
 *
 * 入口（`aiKillSwitchResponse`）と安全網（`assertAiEnabled`）で判定が食い違うと、
 * **入口を通ったのにプロバイダ直前で落ちる**。実際に購入クレジット保持者がこの形で
 * 500 になっていた（入口は `allowPurchasedCredits` を見るが、安全網は除外 uid しか見ない）。
 * 入口が下した結論をここに記録し、安全網はそれを尊重する。
 *
 * **安全網が Firestore を読み直す形にはしない**——AI 呼び出しのたびに追加の読み取りが増える。
 * かつ、**入口を通っていないリクエストには印が付かない**ので fail-closed のままになる。
 */
export type AiAllowReason = 'exempt' | 'purchased';

interface AiRequestState {
  uid: string;
  /** 停止中に入口が通した理由。停止していない場合や未判定なら undefined */
  allowedBy?: AiAllowReason;
}

const storage = new AsyncLocalStorage<AiRequestState>();

/** ルートの入口で 1 回だけ呼ぶ。以降このリクエスト内では currentAiUid() で読める */
export function enterAiRequest(uid: string): void {
  if (uid) storage.enterWith({ uid });
}

/** 実行者の uid。取れないときは undefined（＝除外判定は必ず false 側に倒れる） */
export function currentAiUid(): string | undefined {
  return storage.getStore()?.uid;
}

/**
 * 停止中に入口がこのリクエストを通したことを記録する。
 * **文脈が無いときは何もしない**（記録できないなら通さない、が正しい側）。
 */
export function markAiAllowedBy(reason: AiAllowReason): void {
  const store = storage.getStore();
  if (store) store.allowedBy = reason;
}

/** 入口が通した理由。undefined なら「入口で通されていない」＝安全網は止める */
export function currentAiAllowReason(): AiAllowReason | undefined {
  return storage.getStore()?.allowedBy;
}
