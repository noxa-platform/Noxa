// AI クレジット管理（reserve / refund / 月次計上）+ サブスクリプション読み書きヘルパ。
// Firebase Admin SDK でセキュリティルールをバイパス。
//
// 旧 `src/app/api/stripe/lib.ts` から Stripe 廃止に伴い移設（2026-05-18）。
// `account_subscriptions` collection 自体は IAP 経由の永続クレジット保管 + 履歴データのため残置。
import { getAdminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { PLAN_LIMITS } from '@/lib/types';
import type { PlanTier } from '@/lib/types';

/**
 * AI クレジット消費を Noxa 共通の v2 schema `account_credit_ledger` に記録。
 * 各 AI route が reserveAiCredit 成功後にこれを呼ぶことで、Noxa 課金画面で
 * 「いつ・どの機能で・どれだけ」消費したかが見えるようになる。
 *
 * v1 (crm_*) の usage 計上とは独立。fire-and-forget で失敗してもメイン処理は壊さない。
 */
export async function logAiLedger(
  uid: string,
  feature: string,
  amount: number,
): Promise<void> {
  return writeLedgerEntry(uid, feature, Math.max(1, Math.floor(amount)), true);
}

/**
 * **課金しない AI 利用の記録**（Day126）。
 *
 * 「補助機能は無料・生成系は有料」で配る方針だが、無料にしても**原価はかかる**。
 * 旧実装では 8 経路（briefing / customer-extract / parse / profile-extract /
 * insights-narrative / seating-suggest / customer-infer-profile / customer-context-extract）が
 * クレジット消費も台帳記録も無く LLM を呼んでおり、**1 店舗あたりの AI 原価が
 * 一切見えない**状態だった。無料配布は原価が見えて初めて上限を決められる。
 *
 * 課金は行わず、`charged: false` / `amount: 0` で「使われた事実」だけを残す。
 * 合計は amount の和なので、既存の請求集計には影響しない。
 */
export async function logAiUsage(uid: string, feature: string): Promise<void> {
  return writeLedgerEntry(uid, feature, 0, false);
}

async function writeLedgerEntry(uid: string, feature: string, amount: number, charged: boolean): Promise<void> {
  try {
    const db = getAdminDb();
    const ref = db.collection(`account_credit_ledger/${uid}/entries`).doc();
    await ref.set({
      service: 'noxa',
      feature,
      amount,
      charged,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('logAiLedger error: uid:', uid, 'feature:', feature, error);
  }
}

/**
 * uid からサブスクリプションを取得（Admin SDK）。
 *
 * Stripe 廃止後の現行スキーマ:
 *   - planTier: 'free' | 'pro' | 'business'（IAP では基本 free、Web デスクトップ拡張用に保持）
 *   - status: 'active' | 'canceled' | ...
 *   - seatBlocks: Business 用席数（IAP 段階では 0、将来再導入）
 *   - purchasedCredits: IAP 経由の永続クレジット残（iOS StoreKit / Android Play Billing 共通）
 */
export async function getSubscriptionDoc(uid: string) {
  try {
    const db = getAdminDb();
    const snap = await db.doc(`account_subscriptions/${uid}`).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    return {
      planTier: d.planTier || 'free',
      status: d.status || 'active',
      seatBlocks: d.seatBlocks || 0,
      currentPeriodEnd: d.currentPeriodEnd?.toDate?.()?.toISOString() ?? d.currentPeriodEnd ?? null,
    };
  } catch (e) {
    console.error('getSubscriptionDoc error:', e);
    return null;
  }
}

// AI 利用回数を記録（FieldValue.increment で原子的に更新）
// 引数 cost で機能別に重み付け（chat 1, screenshot 3, insights 2 等）
export async function incrementAiUsage(uid: string, cost: number = 1): Promise<void> {
  try {
    const db = getAdminDb();
    const month = getCurrentMonth();
    const ref = db.doc(`account_ai_usage/${uid}/monthly/${month}`);

    // 整数かつ 1 以上に正規化
    const amount = Math.max(1, Math.floor(cost));

    await ref.set({
      count: FieldValue.increment(amount),
      lastUsedAt: new Date(),
    }, { merge: true });
  } catch (error) {
    console.error('incrementAiUsage error: uid:', uid, error);
    throw error;
  }
}

/**
 * AI クレジットを「予約」（reserve）する。Firestore transaction で原子化することで、
 * 並行リクエストによる二重消費（race condition）を防ぐ。
 *
 * 動作:
 *   - 上限チェック + cost 分の消費を 1 つのトランザクションで実行
 *   - 上限到達なら ok: false を返す（呼び出し側で 429 を返す）
 *   - 成功なら ok: true、AI 呼出後にエラーが起きたら refundAiCredit() でロールバック
 *
 * 使い方:
 *   const cost = estimateAiCost({ inputText: ..., ... });
 *   const r = await reserveAiCredit(uid, cost);
 *   if (!r.ok) return 429;
 *   try { await callAi(...); } catch (err) { await refundAiCredit(uid, cost); throw err; }
 *   // もしくは src/app/api/ai/with-credits.ts の withReservedCredits を使う
 */
export async function reserveAiCredit(
  uid: string,
  cost: number = 1,
): Promise<{ ok: boolean; remaining: number; total: number; consumedMonthly: number; consumedPurchased: number }> {
  const db = getAdminDb();
  const month = getCurrentMonth();
  const usageRef = db.doc(`account_ai_usage/${uid}/monthly/${month}`);
  const subRef = db.doc(`account_subscriptions/${uid}`);

  // プラン上限を取得（トランザクション外でOK、変更頻度が低いため）
  const sub = await getSubscriptionDoc(uid);
  const planTier = (sub?.planTier || 'free') as PlanTier;
  const monthlyTotal = PLAN_LIMITS[planTier]?.maxAiCredits ?? PLAN_LIMITS.free.maxAiCredits;
  const amount = Math.max(1, Math.floor(cost));

  try {
    const result = await db.runTransaction(async (tx) => {
      const usageSnap = await tx.get(usageRef);
      const subSnap = await tx.get(subRef);
      const monthlyUsed = usageSnap.exists ? (usageSnap.data()?.count || 0) : 0;
      const purchased = subSnap.exists ? Math.max(0, Number(subSnap.data()?.purchasedCredits || 0)) : 0;

      const monthlyRemaining = Math.max(0, monthlyTotal - monthlyUsed);

      // 月次枠で賄える場合は月次のみ消費
      if (monthlyRemaining >= amount) {
        tx.set(
          usageRef,
          { count: FieldValue.increment(amount), lastUsedAt: new Date() },
          { merge: true },
        );
        return {
          ok: true,
          monthlyRemaining: monthlyRemaining - amount,
          purchasedRemaining: purchased,
          consumedMonthly: amount,
          consumedPurchased: 0,
        };
      }

      // 不足分を購入クレジット（永続）から消費
      const shortage = amount - monthlyRemaining;
      if (purchased < shortage) {
        return { ok: false, monthlyRemaining, purchasedRemaining: purchased, consumedMonthly: 0, consumedPurchased: 0 };
      }

      // 月次枠は全消費 + 不足分を purchased から減算
      if (monthlyRemaining > 0) {
        tx.set(
          usageRef,
          { count: FieldValue.increment(monthlyRemaining), lastUsedAt: new Date() },
          { merge: true },
        );
      }
      tx.set(
        subRef,
        {
          purchasedCredits: FieldValue.increment(-shortage),
          lastPurchasedUsedAt: new Date(),
        },
        { merge: true },
      );
      return {
        ok: true,
        monthlyRemaining: 0,
        purchasedRemaining: purchased - shortage,
        // 内訳を返す: refund がこの通りに戻す（買ったクレジットを月次に化けさせない）
        consumedMonthly: monthlyRemaining,
        consumedPurchased: shortage,
      };
    });

    const total = monthlyTotal; // UI 互換: 月次プランの上限を返す
    const remaining = result.monthlyRemaining + result.purchasedRemaining;
    return { ok: result.ok, remaining, total, consumedMonthly: result.consumedMonthly, consumedPurchased: result.consumedPurchased };
  } catch (error) {
    console.error('reserveAiCredit error: uid:', uid, error);
    return { ok: false, remaining: 0, total: monthlyTotal, consumedMonthly: 0, consumedPurchased: 0 };
  }
}

/**
 * 予約済みの AI クレジットを払い戻す（Gemini 呼出失敗時など）。
 *
 * consumed（reserveAiCredit の戻り＝消費内訳）が渡されたら、**その内訳どおりに**戻す
 * （月次から取った分は月次へ、purchased から取った分は purchased へ）。これにより
 * 「月次不足で purchased から引いた予約」を refund すると買った永続クレジットが月次
 * （月末失効）に化ける過少払い戻しバグを防ぐ。
 *
 * consumed 未指定（旧直接呼び出し等）は従来ヒューリスティック（月次優先で最大 amount 減算）に
 * フォールバック＝挙動不変。
 */
export async function refundAiCredit(
  uid: string,
  cost: number = 1,
  consumed?: { consumedMonthly?: number; consumedPurchased?: number },
): Promise<void> {
  try {
    const db = getAdminDb();
    const month = getCurrentMonth();
    const usageRef = db.doc(`account_ai_usage/${uid}/monthly/${month}`);
    const subRef = db.doc(`account_subscriptions/${uid}`);
    const amount = Math.max(1, Math.floor(cost));

    // 内訳が渡されていれば reserve と対称に戻す（買ったクレジットを月次に化けさせない）
    const cm = Math.max(0, Math.floor(consumed?.consumedMonthly ?? 0));
    const cp = Math.max(0, Math.floor(consumed?.consumedPurchased ?? 0));
    const useSplit = !!consumed && cm + cp > 0;

    await db.runTransaction(async (tx) => {
      // reads を先に（Firestore の tx 制約）
      const usageSnap = await tx.get(usageRef);
      const monthlyUsed = usageSnap.exists ? (usageSnap.data()?.count || 0) : 0;

      const refundFromMonthly = useSplit ? Math.min(monthlyUsed, cm) : Math.min(monthlyUsed, amount);
      const refundFromPurchased = useSplit ? cp : amount - refundFromMonthly;

      if (refundFromMonthly > 0) {
        tx.set(
          usageRef,
          { count: monthlyUsed - refundFromMonthly, lastUsedAt: new Date() },
          { merge: true },
        );
      }
      if (refundFromPurchased > 0) {
        tx.set(
          subRef,
          { purchasedCredits: FieldValue.increment(refundFromPurchased) },
          { merge: true },
        );
      }
    });
  } catch (error) {
    console.error('refundAiCredit error: uid:', uid, error);
  }
}

// 機能別のクレジットコストは src/lib/ai-cost.ts の estimateAiCost に統一済。

/**
 * 報酬としてクレジットを「事実上付与」する（= 月次 used カウンタから減算）。
 * 月内残数を増やす扱いになる。負にはならない。
 */
export async function grantBonusCredits(uid: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const db = getAdminDb();
  const month = getCurrentMonth();
  const ref = db.doc(`account_ai_usage/${uid}/monthly/${month}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? (snap.data()?.count || 0) : 0;
    const next = Math.max(0, used - Math.floor(amount));
    tx.set(ref, { count: next, lastUsedAt: new Date() }, { merge: true });
  });
}

// AI 利用残数を取得。月次枠の残り + 永続購入クレジットを合算する。
export async function getAiCreditsRemaining(uid: string): Promise<{
  remaining: number;
  total: number;
  monthlyRemaining: number;
  monthlyTotal: number;
  purchasedCredits: number;
}> {
  const db = getAdminDb();
  const month = getCurrentMonth();

  const sub = await getSubscriptionDoc(uid);
  if (!sub) {
    console.warn('getAiCreditsRemaining: サブスクリプション未取得、Freeプランとして処理 uid:', uid);
  }
  const planTier = (sub?.planTier || 'free') as PlanTier;
  const monthlyTotal = PLAN_LIMITS[planTier]?.maxAiCredits ?? PLAN_LIMITS.free.maxAiCredits;

  let used = 0;
  let purchasedCredits = 0;
  try {
    const [usageSnap, subSnap] = await Promise.all([
      db.doc(`account_ai_usage/${uid}/monthly/${month}`).get(),
      db.doc(`account_subscriptions/${uid}`).get(),
    ]);
    if (usageSnap.exists) used = usageSnap.data()?.count || 0;
    if (subSnap.exists) purchasedCredits = Math.max(0, Number(subSnap.data()?.purchasedCredits || 0));
  } catch (e) {
    console.error('getAiCreditsRemaining usage fetch error:', e);
  }

  const monthlyRemaining = Math.max(0, monthlyTotal - used);
  return {
    remaining: monthlyRemaining + purchasedCredits,
    total: monthlyTotal + purchasedCredits,
    monthlyRemaining,
    monthlyTotal,
    purchasedCredits,
  };
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
