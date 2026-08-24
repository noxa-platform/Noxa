// AI 料金設定ビルダー（P129・NOXA 初の生成系 AI）。
//
// 日本語で「初回は3000円、延長は30分3000円、指名は2000円」と書くと、
// 料金設定の**提案パッチ**を返す。返すだけで、サーバは Firestore に一切書かない。
// 保存は従来どおり人の操作（POS 設定画面の保存ボタン）で、途中に
// テスト伝票プレビューの差額確認（Day127-2 の `diffPreview`）が挟まる。
//
// 生成系をここに載せる前提として P129 で 3 つ縛りを入れている:
//   1. AI が書けるのは **テスト伝票プレビューに金額として現れる項目だけ**
//      （`WRITABLE_FIELDS`）。確かめる手段の無い数字を書かせない。
//   2. 全 Config ではなく**パッチ**として受ける（言及されなかった項目を消さない）。
//   3. モデルの出力は必ず `validateConfigPatch` を通す。捨てた項目は理由つきで返す。
//
// PII: 入力はユーザーが貼り付けた自由文（料金表の写しや店長のメモ）。顧客の
// フリーテキストを載せる経路ではないが、**貼り付けテキストである以上マスクを通す**
// （Day127＝「書込み側だから免除」という分類の前提が実態と違っていた件の再発防止）。
// 料金設定に連絡先は不要なので、マスクしても機能は落ちない。
import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse } from '@/app/api/lib/ai-kill-switch';
import { logAiUsage } from '@/app/api/lib/credits';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { generateText } from '../ai-provider';
import { withReservedCredits } from '../with-credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { maskContactInfo } from '@/lib/ai-privacy';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { safeParseJson } from '@/lib/ai-knowledge/safe-json';
import { validateConfigPatch, WRITABLE_FIELDS, describeField } from '@/lib/pos/config-schema';
import type { StoreConfig } from '@/lib/pos/types';

/** 貼り付け想定の自由文。料金表 1 枚分を超える入力は要約させずに弾く */
const MAX_TEXT = 4000;

interface PosConfigRequestBody {
  workspaceId: string;
  /** 日本語の要望・料金表の貼り付け */
  requestText: string;
  /** 現行設定（クライアントが購読済みのものを渡す。サーバは書かない＝提案の土台にのみ使う） */
  current: StoreConfig;
}

const SYSTEM_INSTRUCTION = withInjectionGuard(`あなたはナイトワーク店舗の料金設定を組み立てる担当者です。
店長の日本語の要望から、POS の料金設定の**変更したい項目だけ**を JSON で返してください。

厳守:
- **変更する項目だけ**を返す。要望に出てこない項目は返さない（返すと現状のまま上書きされ、無意味な差分になる）
- 金額は税別・円の整数。範囲は 0〜1000000
- 税/サービス料は小数（10% なら 0.1）。0〜0.5
- 時刻は 24h+ 表記の整数（翌1時は 25）
- 推測で埋めない。要望から読み取れない項目は**返さない**
- 説明・前置き・マークダウンを書かない。JSON のみ

書ける項目（これ以外は返しても捨てられます）:
${WRITABLE_FIELDS.join(', ')}

意味:
- initialPricing = 初回のお客様、rWithinPricing = R内（再来店・時間内）、rAfterPricing = R後（再来店・時間外）
- 各組の set=セット料金 / ext=延長料金 / nom=指名料 / tc=テーブルチャージ
- regularPricing = 通常のお客様。earlySet=早い時間のセット / lateSet=遅い時間のセット / thresholdHour=早遅の境界時刻
- dohanFee=同伴料 / additionalNominationFee=複数指名の1人あたり / closingHour=閉店時刻
- taxRate=税・サービス料 / initialNoOrderTaxRate=初回で追加注文が無いときの税率

出力例:
{"initialPricing":{"set":3000,"nom":2000},"regularPricing":{"ext":3000}}`);

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // AI 緊急停止（2026-08-25）。**クレジット予約より手前**で弾く
    // （予約→拒否→返金の往復を作らない）。停止中は 503 + 日本語文言を返し、
    // iOS の APIError.serverError がその文字列をそのまま画面に出す。
    // ⚠️ 429 は使わない（iOS が insufficientCredits として残高表示を書き換えるため）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;
    const body = (await request.json().catch(() => ({}))) as PosConfigRequestBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const text = typeof body.requestText === 'string' ? body.requestText.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'どんな料金にしたいかを書いてください' }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json({ error: `文章が長すぎます（${MAX_TEXT} 文字まで）` }, { status: 400 });
    }
    if (!body.current || typeof body.current !== 'object') {
      return NextResponse.json({ error: '現在の料金設定が必要です' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, body.workspaceId);
    // 料金設定はオーナー専用（POS 設定画面と同じ境界）。
    // ここを member まで広げると、キャストが自店の料金改定案を作れてしまう
    if (ctx.kind !== 'shop' || ctx.role !== 'owner') {
      return NextResponse.json({ error: '料金設定の変更はオーナー専用です' }, { status: 403 });
    }

    // 貼り付けテキストをマスクしてから送る（Day127）。料金設定に連絡先は要らない
    const maskedText = maskContactInfo(text);
    const current = body.current;
    // 現行値は「変更点だけ返させる」ための参照。書ける項目だけを渡す
    // （メニュー全件や卓名を送っても提案には使えず、入力トークンと原価が増えるだけ）
    const currentDigest = JSON.stringify({
      initialPricing: current.initialPricing,
      rWithinPricing: current.rWithinPricing,
      rAfterPricing: current.rAfterPricing,
      regularPricing: current.regularPricing,
      taxRate: current.taxRate,
      initialNoOrderTaxRate: current.initialNoOrderTaxRate,
      dohanFee: current.dohanFee,
      additionalNominationFee: current.additionalNominationFee,
      closingHour: current.closingHour,
    });
    // 要望文は店長が書く想定だが、料金表の写しや他店資料の貼り付けが混ざる。
    // 出力先が**伝票の金額**である以上、指示として読ませない（P130）
    const userPrompt = `# 現在の料金設定\n${currentDigest}\n\n${wrapUntrustedInput(maskedText, '店長の要望')}\n\n上記の要望で**変更する項目だけ**を JSON で返してください。`;

    const cost = estimateAiCost({
      inputText: userPrompt,
      expectedOutputTokens: 500,
      featureMultiplier: 1,
      maxCap: 5,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      // 生成系は有料方針だが、価格の確定は人間ゲート。原価の記録だけは先に通す（Day126）
      void logAiUsage(uid, 'pos-config');
      const raw = await generateText(userPrompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 500,
        temperature: 0.2, // 料金は創造性が不要。ぶれを最小にする
        responseMimeType: 'application/json',
      });

      const parsed = safeParseJson<unknown>(raw);
      if (parsed === null) {
        // 生成物を残す（Day116-PM）。ack せず return して予約分を返金させる
        console.error('[api/ai/pos-config] 生成物が JSON として読めず 500。raw head:', (raw ?? '').slice(0, 200));
        return NextResponse.json({ error: '料金設定の生成に失敗しました' }, { status: 500 });
      }

      const validated = validateConfigPatch(parsed, current);
      if (validated.accepted.length === 0) {
        // **提案ゼロを成功として返さない**。「AI が反映した」と思わせたまま
        // 何も変わっていない状態が一番危ない。何を捨てたかを添えて 200 で返し、
        // 消費は確定させない（生成は走ったが使える提案が出ていない）
        return NextResponse.json({
          patch: {}, accepted: [], rejected: validated.rejected,
          message: '要望から変更できる項目を読み取れませんでした。金額や項目名を具体的に書くと通りやすくなります。',
          creditsRemaining: remaining,
        });
      }

      ack(); // 使える提案が出た＝消費確定
      return NextResponse.json({
        patch: validated.patch,
        accepted: validated.accepted,
        acceptedLabels: validated.accepted.map(describeField),
        rejected: validated.rejected,
        creditsRemaining: remaining,
      });
    }, 'pos-config');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('pos-config failed:', error);
    return NextResponse.json({ error: '料金設定の生成に失敗しました' }, { status: 500 });
  }
}
