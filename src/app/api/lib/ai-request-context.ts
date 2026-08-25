// AI リクエストの実行者を、同一リクエストの非同期チェーン内で共有する。
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

const storage = new AsyncLocalStorage<{ uid: string }>();

/** ルートの入口で 1 回だけ呼ぶ。以降このリクエスト内では currentAiUid() で読める */
export function enterAiRequest(uid: string): void {
  if (uid) storage.enterWith({ uid });
}

/** 実行者の uid。取れないときは undefined（＝除外判定は必ず false 側に倒れる） */
export function currentAiUid(): string | undefined {
  return storage.getStore()?.uid;
}
