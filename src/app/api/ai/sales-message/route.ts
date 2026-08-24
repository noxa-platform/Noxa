// LINE 連続送信用の営業メッセージ生成 API。
//
// iOS `AIService.salesMessage` から呼ばれる薄いラッパーで、
// LineContinuousSendView の一括ドラフト生成が顧客ごとに 1 リクエスト走る。
// `/api/ai/message` と違って顧客 ID を必要とせず、name + context + hint だけで
// 営業文面のバリエーション 3 件を生成する（軽量・短時間応答を優先）。
//
// クレジットは `estimateAiCost` でメッセージ生成相当（featureMultiplier 1.0）を引当。
//
// PII（Day103）: `context` は**クライアントが保存済み顧客データから組み立てて送る**フィールドで、
// iOS の `AIService.salesMessage` は context 未指定時に `customer.importantMemo`（Day12 が
// マスク対象と定めた顧客フリーテキストそのもの）を既定で詰める。サーバ側で顧客 doc を読まない
// ため Day99 の静的網羅ガードにも引っかからず、**電話番号・メールが生のまま AI プロバイダへ
// 出る経路が残っていた**（ポリシー表も「送信内容に連絡先なし」と誤記していた）。
// クライアントの実装に依存せずサーバで伏字化する。
import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { maskContactInfo } from '@/lib/ai-privacy';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';

interface SalesMessageBody {
  customerName?: string;
  context?: string;
  hint?: string | null;
}

// 顧客の保存済みフリーテキスト（メモ・好み・NG）と、learn-from-text が相手の LINE 履歴から
// 機械抽出して書き戻した値を読む。**攻撃者が書いた文字列が 1 ホップ挟んで届く経路**なので
// System 側でデータ境界を宣言する（P130）
const SYSTEM_INSTRUCTION = withInjectionGuard(`あなたはナイトワーク（ホスト・ホステス・キャバ嬢）専門の LINE 営業メッセージ作成 AI です。
お客様への営業（来店促進・関係構築）を目的とした自然で押し付けがましくないメッセージを 3 パターン作成します。

## ルール
- 文字数は 150〜300 字程度
- 絵文字は 2〜3 個
- 押し付けがましくない、さりげない営業
- 相手の名前を必ず入れる
- メッセージ本文のみ出力（説明や注釈は不要）
- 3 パターンそれぞれトーンや切り口を変える（甘め / カジュアル / 丁寧めなど）
- 必ず改行を入れて読みやすく（1 メッセージあたり 2-4 回の改行目安）

## 文体チェック
- 改行が入っているか、1 文 30-50 字か、読点が 1 文で 2 個以内か
- 括弧書きで心の声・補足が残ってないか
- 禁止クリシェ（胸が締め付けられる / 言葉にならない / かけがえのない / 受け止めました 等）を使ってないか
- 20-30 代の夜職スタッフがほんまに書く文面になっているか

## 出力形式
JSON 配列で 3 つのメッセージを出力:
["メッセージ1", "メッセージ2", "メッセージ3"]`);

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as SalesMessageBody;
    const customerName = body.customerName?.trim();
    if (!customerName) {
      return NextResponse.json({ error: 'customerName が必要です' }, { status: 400 });
    }

    // context は保存済み顧客メモ由来（上記コメント）＝Day12 ポリシーのマスク対象。
    // hint はユーザーがその場で打つ指示（方針5 の「ユーザー明示入力」）なので素通しでよいが、
    // 顧客名と同じプロンプトに載る以上、連絡先だけは同じ基準で伏せておく。
    const context = maskContactInfo(body.context?.trim() ?? '');
    const hint = maskContactInfo(body.hint?.trim() ?? '');

    const promptParts = [
      // 氏名自体は送る方針（ポリシー方針4・源氏名運用を推奨）だが、名前欄に連絡先を
      // 書き込む運用者がいるため sibling（ai/message）と同じくマスクを通す。
      // 顧客名・背景は iOS が customer.importantMemo を詰めて送る経路（Day103）＝
      // 相手の文面の書き写しが入る。hint は操作者本人の指示なので囲いの外（P130）
      wrapUntrustedInput(maskContactInfo(customerName), '顧客名'),
      context ? wrapUntrustedInput(context, '背景') : '',
      hint ? `追加の指示: ${hint}` : '',
      '上記をもとに営業 LINE メッセージを 3 パターン生成してください。',
    ].filter(Boolean);
    const prompt = promptParts.join('\n\n');

    // クレジット引当（軽量メッセージ生成、出力 800 tok 想定）
    const cost = estimateAiCost({
      inputText: prompt,
      expectedOutputTokens: 800,
      featureMultiplier: 1.0,
    });
    const reserved = await reserveAiCredit(uid, cost);
    if (!reserved.ok) {
      return NextResponse.json(
        {
          error: 'AIクレジット不足',
          creditsRemaining: reserved.remaining,
          requiredCredits: cost,
        },
        { status: 429 },
      );
    }

    let result: string;
    try {
      result = await generateText(prompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 1200,
        temperature: 0.85,
        responseMimeType: 'application/json',
      });
    } catch (err) {
      await refundAiCredit(uid, cost, reserved);
      throw err;
    }

    let drafts: string[] = [];
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        drafts = parsed.filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0);
      }
    } catch {
      if (result?.trim()) drafts = [result.trim()];
    }

    if (drafts.length === 0) {
      // Day116 で ai/briefing にだけ入れた「生成物を残す」を同型のここにも適用（Day116-PM）。
      // 500 だけ返しても、モデルが何を返したのかが消えるので再現も改善もできない
      console.error('[api/ai/sales-message] 生成物から下書きを取り出せず 500。raw head:', (result ?? '').slice(0, 200));
      await refundAiCredit(uid, cost, reserved);
      return NextResponse.json({ error: 'メッセージ生成に失敗しました' }, { status: 500 });
    }
    void logAiLedger(uid, 'sales-message', cost);

    // iOS AIService.DraftResponse は `drafts` または `message` を期待する
    return NextResponse.json({ drafts, creditsRemaining: reserved.remaining });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('POST /api/ai/sales-message failed:', error);
    return NextResponse.json({ error: 'メッセージ生成失敗' }, { status: 500 });
  }
}
