// 「会話前ブリーフィング」API。
//
// 顧客一人を 30 秒で再把握するための AI 生成サマリ。
// 顧客プロファイル + 直近 10 件のログをモデル（lite tier）に投げて、
// 「今日の話題候補 / 避けるべき / 直近の出来事 / 関係ステージ」を JSON で返す。
//
// クレジット消費: estimateAiCost で動的算出（featureMultiplier 1.2）
import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse, aiDisabledResponse } from '@/app/api/lib/ai-kill-switch';
import { logAiUsage } from '@/app/api/lib/credits';
import { generateText } from '../ai-provider';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../with-credits';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathCustomer, pathCustomerLogs, type AccessContext } from '../../lib/access-context';
import { maskDeep } from '@/lib/ai-privacy';

/**
 * 顧客コンテキストの取得結果（P162 で 3 状態に分けた）。
 *
 * 🔴 直す前は **「読めなかった」も「顧客が居ない」も `'{}'`** で、
 * `if (!customerSnap.exists) return '{}'` と catch の `return '{}'` が**バイト単位で同一**だった。
 * `console.error` はサーバログにしか出ないので、**利用者には正常な応答が返り**、
 * モデルが「特筆すべき情報が無い」と自然文で**言い切る**。
 * ＝ 表示側の「不明として出す」（P159 / P160）が**構造的に届かない**経路。
 *
 * ⚠️ 失敗の文字列を差し替えるだけでは足りない。**本当に 0 件のとき**に
 * 「取得に失敗しました」と言えば逆向きの嘘になる。だから 3 つに分ける:
 *   - `blocked` … 顧客本体が読めない／居ない ＝ **モデルへ送らない**（クレジットも消費しない）
 *   - `partial` … 一部だけ読めた ＝ **送るが、読めなかった項目を名指しで断る**
 *                 （ここで止めると記録が 1 件でも欠けた顧客で AI が死ぬ）
 *   - `ready`   … 本当に 0 件 ＝ **そのまま送る**（止めると新規顧客の初回操作が塞がる）
 *
 * 判別可能ユニオンなので、`state` を見ずに `json` を触るとコンパイルが通らない。
 * ⚠️ ただし**この強制は関数の戻り値にしか効かない**。HTTP 境界（`await res.json()`）は
 * `as` で名乗るだけなので、応答側は `incomplete` を **0 件でも必ず配列**で返して補う
 * （`record-engine/apply` の `trimmed` と同じ契約。`member-stats` の optional 版はここより弱い）。
 */
type CustomerContext =
  | { state: 'blocked'; reason: 'unavailable' | 'notFound' }
  | { state: 'partial'; json: string; incomplete: string[] }
  | { state: 'ready'; json: string };

async function getCustomerContext(ctx: AccessContext, customerId: string): Promise<CustomerContext> {
  try {
    const db = getAdminDb();
    // ⚠️ `Promise.all` は**片方の失敗で両方失う**（顧客は読めているのに blocked へ倒れる）。
    // 「一部だけ読めた」を作れるようにするため allSettled で分ける。
    const [customerRes, logsRes] = await Promise.allSettled([
      db.doc(pathCustomer(ctx, customerId)).get(),
      db.collection(pathCustomerLogs(ctx, customerId))
        .orderBy('datetime', 'desc')
        .limit(10)
        .get(),
    ]);

    if (customerRes.status === 'rejected') {
      console.error('[api/ai/briefing] 顧客 doc の取得に失敗:', customerRes.reason);
      return { state: 'blocked', reason: 'unavailable' };
    }
    if (!customerRes.value.exists) {
      // 「読めなかった」ではなく「居ない」。**同じ値に畳まない**のがこの pass の本題
      return { state: 'blocked', reason: 'notFound' };
    }

    const incomplete: string[] = [];
    if (logsRes.status === 'rejected') {
      console.error('[api/ai/briefing] 直近ログの取得に失敗:', logsRes.reason);
      incomplete.push('直近ログ');
    }

    const customer = customerRes.value.data() ?? {};
    const logs = logsRes.status === 'fulfilled'
      ? logsRes.value.docs.map((d) => {
        const data = d.data();
        return {
          type: data.type,
          datetime: data.datetime?.toDate?.()?.toISOString?.() ?? null,
          memo: data.memo,
          place: data.place,
          salesAmount: data.salesAmount,
          reaction: data.reaction,
          nextAction: data.nextAction,
          // ⚠️ 同伴・アフターは `type` に出ない（来店ログのサブアクション）。
          // 落とすと利用者が入れた場所と金額が AI に届かない（P153-PM17）。
          // 記録が無いときはキーごと出さない（プロンプトを 1 文字も増やさない）
          ...(data.withDouhan ? { douhan: { place: data.douhanPlace, amount: data.douhanAmount, memo: data.douhanMemo } } : {}),
          ...(data.withAfter ? { after: { place: data.afterPlace, amount: data.afterAmount, memo: data.afterMemo } } : {}),
        };
      })
      : [];

    // 顧客のフリーテキスト（likesNote / importantMemo / tags 等）とログの memo/place には
    // 電話番号・メールが普通に書かれる。AI プロバイダへ送る前にマスクする
    // （Day12 の PII ガード。chat/message には効いていたが本 route は素通しだった）。
    const json = JSON.stringify(maskDeep({
      customer: {
        name: customer.name,
        nameKana: customer.nameKana,
        rank: customer.rank,
        tags: customer.tags,
        mbti: customer.mbti,
        likesNote: customer.likesNote,
        importantMemo: customer.importantMemo,
        customerPersonality: customer.customerPersonality,
        communicationStyle: customer.communicationStyle,
        likes: customer.likes,
        dislikes: customer.dislikes,
        personalityTraits: customer.personalityTraits,
        interests: customer.interests,
        triggerPositive: customer.triggerPositive,
        triggerNegative: customer.triggerNegative,
        totalSales: customer.totalSales,
        lastContactAt: customer.lastContactAt?.toDate?.()?.toISOString?.() ?? null,
        birthday: customer.birthday,
        nextAction: customer.nextAction,
      },
      recentLogs: logs,
    }));
    return incomplete.length > 0
      ? { state: 'partial', json, incomplete }
      : { state: 'ready', json };
  } catch (e) {
    console.error('getCustomerContext error:', e);
    return { state: 'blocked', reason: 'unavailable' };
  }
}

// 顧客の保存済みフリーテキスト（メモ・好み・NG）と、learn-from-text が相手の LINE 履歴から
// 機械抽出して書き戻した値を読む。**攻撃者が書いた文字列が 1 ホップ挟んで届く経路**なので
// System 側でデータ境界を宣言する（P130）
const SYSTEM_INSTRUCTION = withInjectionGuard(`あなたは Noxa の AI ブリーフィング担当です。
顧客一人を 30 秒で再把握できるサマリを作ります。

ルール:
- 提供データの事実のみに基づき、推測で埋めない（不明は省く）
- 顧客の名前や個人情報を本文に書きすぎない（プライバシー配慮）
- 営業押し付け表現を使わない
- 「今日の話題候補」は 3 個、相手の興味 / 直近の出来事から具体的に
- 「避けるべき」は地雷話題 / 機嫌悪い兆候から 1-3 個
- 「関係ステージ」は S1-S5 で判定: S1初回 / S2育成 / S3常連 / S4休眠 / S5離反懸念
- 「直近サマリ」は最終接触からの経過と最近の出来事を 60 字以内

JSON 出力形式（必ず厳密 JSON のみ、説明文不要）:
{
  "stage": "S1" | "S2" | "S3" | "S4" | "S5",
  "stageReason": "判定理由を 40 字以内",
  "recentSummary": "直近サマリ 60 字以内",
  "topicCandidates": ["話題1", "話題2", "話題3"],
  "avoidTopics": ["避けるべき1", ...],
  "tipForToday": "今日の接客アドバイス 50 字以内"
}`);

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // AI 緊急停止（2026-08-25）。**クレジット予約より手前**で弾く
    // （予約→拒否→返金の往復を作らない）。停止中は 503 + 日本語文言を返し、
    // iOS の APIError.serverError がその文字列をそのまま画面に出す。
    // ⚠️ 429 は使わない（iOS が insufficientCredits として残高表示を書き換えるため）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;
    const { workspaceId, customerId } = await request.json().catch(() => ({}));

    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    const context = await getCustomerContext(ctx, customerId);

    // ①取得失敗 ＝ **モデルへ送らない**（P162）。'{}' を渡すとモデルが
    // 「特筆すべき情報が無い」と言い切り、利用者にはそれが答えとして見える。
    // クレジットを予約する前に返すので、失敗した回の消費も起きない。
    if (context.state === 'blocked') {
      if (context.reason === 'notFound') {
        return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
      }
      // 🔴 **503 を使わない**（P162-PM）。iOS は「ai/ のパス・503・本文を復号できた」の
      // 3 条件で **AI 全体の停止**を判定しており、`code` の有無を見ない版が端末に残っている。
      // ＝ 503 にすると**顧客 1 人が読めなかっただけでアプリ全体の AI ボタンが無効**になり、
      // 別の AI 呼び出しが成功するまで解除されない。⚠️ **`code` を足しても旧版には効かない**
      // （旧版は status だけで倒れる）ので、status の側で外す。
      // ✅ 500 は新旧どちらの版でも停止扱いにならないことを yorulog が 3 通りで実測
      //（判定ロジックの全履歴 / 既存テストの `testOtherStatusesAreNotStopped` / 5xx の全走査）。
      // ⚠️ 500 では **`error` の文言がそのまま利用者に出る**ので、この文面を変えないこと。
      // ⚠️ この `console.error` は **5xx を返す直前に置く**（`api-silent-failure` の
      // 「catch の外で返す 5xx も理由をログに残す」は**直前 6 行**しか見ない）。
      console.error('[api/ai/briefing] 顧客コンテキストが取得できないため、モデルへ送らず 500 を返す', { customerId });
      return NextResponse.json(
        { error: '顧客データを取得できませんでした。時間をおいて再度お試しください。' },
        { status: 500 },
      );
    }

    // ②一部だけ読めた ＝ 送るが**読めなかった項目を名指しで断らせる**。
    // ⚠️ System 側は「不明は省く」なので、黙って送ると欠けたことが出力から消える。
    // ここだけは「省かずに書け」と上書きする（断り文は**信頼側**＝ wrapUntrustedInput の外に置く）。
    const incomplete = context.state === 'partial' ? context.incomplete : [];
    const incompleteNotice = incomplete.length > 0
      ? `\n\n【重要】次の項目は取得できませんでした: ${incomplete.join(' / ')}。`
        + 'これらは「不明」ではなく「取得できなかった」と recentSummary の冒頭に明記し、'
        + '欠けた項目に基づく推測は書かないでください（0 件として扱わないこと）。'
      : '';

    const cost = estimateAiCost({
      inputText: context.json + incompleteNotice,
      expectedOutputTokens: 600,
      featureMultiplier: 1.2,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      // 無料機能でも AI 原価はかかる。課金せず利用だけ記録する（Day126）
      void logAiUsage(uid, 'briefing');
      const raw = await generateText(
        `${wrapUntrustedInput(context.json, '顧客情報')}${incompleteNotice}\n\n上記の顧客について、今日の会話前ブリーフィングを JSON で出力してください。`,
        {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 600,
          temperature: 0.4,
          responseMimeType: 'application/json',
          modelTier: 'lite',
        },
      );

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // 生成物が壊れた原因（モデルの応答）を残さないと再現も改善もできない（Day116）
        console.error('[api/ai/briefing] JSON parse failed:', e, 'raw head:', raw.slice(0, 200));
        return NextResponse.json({ error: 'ブリーフィング生成に失敗しました' }, { status: 500 });
      }

      ack();
      return NextResponse.json({
        briefing: parsed,
        creditsRemaining: remaining,
        // ⚠️ **0 件でも必ず配列**（`record-engine/apply` の `trimmed` と同じ契約）。
        // `...(len > 0 ? { incomplete } : {})` にすると「読めなかった項目ゼロ」と
        // 「そもそも報告していない古い版」が呼出側から同じに見える（member-stats の弱い版）。
        incomplete,
      });
    }, 'briefing');
  } catch (error) {
    // 入口を通った後に停止へ切り替わると安全網が throw する。裸の 500 にせず
    // `code: AI_DISABLED` を必ず載せる（P154）
    const aiStopped = aiDisabledResponse(error);
    if (aiStopped) return aiStopped;
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI briefing error:', error);
    return NextResponse.json({ error: 'ブリーフィング生成失敗' }, { status: 500 });
  }
}
