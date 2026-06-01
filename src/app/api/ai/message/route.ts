import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { resolveWorkspaceContext, composePlaybookAndSelf } from '@/lib/ai-knowledge/prompt-helpers';
import { getGlobalSuccessPatterns, getAggregateHint } from '@/lib/ai-knowledge/global-patterns';
import { AI_CONFIG } from '@/lib/ai-knowledge/constants';

// 顧客データ + 最新ログを取得してコンテキスト文字列を生成
async function getCustomerContext(workspaceId: string, customerId: string): Promise<string> {
  try {
    const db = getAdminDb();

    // 顧客基本データ取得
    const snap = await db.doc(`shop_shops/${workspaceId}/customers/${customerId}`).get();
    if (!snap.exists) return '顧客データなし';
    const d = snap.data()!;

    // 最新5件のログを取得
    const logsSnap = await db
      .collection(`shop_shops/${workspaceId}/customers/${customerId}/logs`)
      .orderBy('datetime', 'desc')
      .limit(5)
      .get();

    const recentLogs = logsSnap.docs.map((doc) => {
      const ld = doc.data();
      const dt = ld.datetime?.toDate?.();
      return {
        type: ld.type || 'other',
        visitType: ld.visitType || null,
        memo: ld.memo || '',
        place: ld.place || '',
        date: dt ? dt.toISOString().split('T')[0] : '不明',
        salesAmount: ld.salesAmount || 0,
      };
    });

    // lastContactAtの整形
    const lastContactDate = d.lastContactAt?.toDate?.();
    const lastContactStr = lastContactDate
      ? lastContactDate.toISOString().split('T')[0]
      : null;

    const context = {
      name: d.name || '不明',
      birthday: d.birthday || null,
      likes: d.likesNote || '',
      dislikes: d.dislikesNote || '',
      importantMemo: d.importantMemo || '',
      ngNote: d.ngNote || '',
      tags: d.tags || [],
      rank: d.rank || null,
      totalSales: d.totalSales || 0,
      visitCount: d.visitCount || recentLogs.length,
      lastContactAt: lastContactStr,
      recentLogs,
      // 手入力 AI 学習プロファイル
      mbti: d.mbti || null,
      personalityTraits: d.personalityTraits || [],
      interests: d.interests || [],
      triggerPositive: d.triggerPositive || [],
      triggerNegative: d.triggerNegative || [],
      communicationStyle: d.communicationStyle || '',
    };

    let contextStr = JSON.stringify(context, null, 2);

    // MBTI 別接客ヒント
    const mbtiHintTable: Record<string, string> = {
      INTJ: '論理的・効率重視。感情的営業より合理性訴求',
      INTP: '知的好奇心をくすぐる話題。軽いユーモア',
      ENTJ: '成果・数字・ステータスに反応',
      ENTP: '議論・新しさ。定型句より意外性',
      INFJ: '価値観・物語重視。共感的で丁寧',
      INFP: '感情表現に繊細。受容的な文体',
      ENFJ: '褒め・承認欲求を大切に',
      ENFP: '新鮮さ・感情の盛り上がり。絵文字 OK',
      ISTJ: '安定・約束・丁寧さ重視',
      ISFJ: '気配り。負担の少ない誘い方',
      ESTJ: '結論から・実務的',
      ESFJ: '関係性・気遣い。近況確認が効く',
      ISTP: '短文・実用的',
      ISFP: '感性・美的要素。押し付け NG',
      ESTP: 'ノリ・即レス。カジュアル',
      ESFP: 'テンション・場の楽しさ。絵文字多め',
    };
    if (context.mbti && mbtiHintTable[context.mbti]) {
      contextStr += `\nMBTI接客ヒント: ${context.mbti} — ${mbtiHintTable[context.mbti]}`;
    }

    // チャット解析データがあればコンテキストに追加
    const customerPersonality = d.customerPersonality || '';
    const myMessageStyle = d.myMessageStyle || '';
    const chatHistory: { sender: string; text: string }[] = d.chatHistory || [];

    if (customerPersonality) {
      contextStr += `\n相手の性格: ${customerPersonality}`;
    }
    if (myMessageStyle) {
      contextStr += `\n自分の文体の特徴（これを再現すること）: ${myMessageStyle}`;
    }
    if (chatHistory.length > 0) {
      const recentChat = chatHistory.slice(-20);
      contextStr += `\n過去のやり取り:\n${recentChat.map((m) =>
        `${m.sender === 'me' ? '自分' : '相手'}: ${m.text}`
      ).join('\n')}`;
    }

    return contextStr;
  } catch (e) {
    console.error('getCustomerContext error:', e);
    return '顧客データ取得エラー';
  }
}

// 目的ごとのプロンプト指示
const PURPOSE_PROMPTS: Record<string, string> = {
  thank_you: '来店のお礼メッセージ。また来たいと思わせる内容で。前回の会話内容や一緒に楽しんだことを自然に盛り込んで。',
  birthday: '誕生日のお祝いメッセージ。温かみと特別感のある内容で。ささやかなサプライズの提案も入れて。',
  follow_up: '久しぶりの連絡メッセージ。自然で押し付けがましくない内容で。最近の出来事や季節の話題を入れて。',
  invitation: '来店を促すメッセージ。イベントや特別感を出して。限定感のある誘い文句を入れて。',
  comeback: '最近来店が減った顧客への再来店促進メッセージ。寂しいという気持ちと会いたい気持ちを素直に伝えて。',
  event: 'イベント告知メッセージ。日時・内容を具体的に。特別感と限定感を出して。',
  after_gift: 'プレゼントや差し入れを頂いた後のお礼メッセージ。感動と感謝を具体的に伝えて。',
  seasonal: '季節の挨拶メッセージ。季節感を出しつつ来店に繋げる。今の時期ならではの話題を入れて。',
};

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { wid, customerId, purpose, customPrompt } = await request.json();

    if (!wid || !customerId) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, wid);

    const customerContext = await getCustomerContext(wid, customerId);
    const purposePrompt = PURPOSE_PROMPTS[purpose] || '';

    // 文章量に応じてクレジットを計算（最終 prompt サイズ + 想定出力 1000 tok）
    const estimatedInput = customerContext + (customPrompt ?? '') + purposePrompt;
    const messageCost = estimateAiCost({
      inputText: estimatedInput,
      expectedOutputTokens: 1000,
      featureMultiplier: 1.2, // メッセージ生成は単価やや高め
    });
    const reserved = await reserveAiCredit(uid, messageCost);
    if (!reserved.ok) {
      return NextResponse.json({ error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: messageCost }, { status: 429 });
    }

    // purpose → scene マッピング（プレイブックのシーン別ヒントを流用）
    const purposeToScene: Record<string, string> = {
      thank_you: 'first_contact',
      birthday: 'check_in',
      follow_up: 'check_in',
      invitation: 'invite_again',
      comeback: 'comeback_silent',
      event: 'invite_again',
      after_gift: 'check_in',
      seasonal: 'check_in',
    };
    const scene = purposeToScene[purpose] || null;

    // ワークスペースのコンテキスト（storeType + selfData + 店舗プロファイル）を一括解決
    const db = getAdminDb();
    const { storeType, selfData, storeProfile } = await resolveWorkspaceContext(ctx);
    const { playbookBlock, selfBlock: selfBaseBlock, storeBlock } = composePlaybookAndSelf({
      storeType,
      scene,
      compact: false,
      selfData,
      storeProfile,
    });

    // 過去の 👍👎 フィードバック + 匿名化グローバルパターン + 集計ヒントを並列取得
    const [fbSnap, globalPatterns, aggregateHint] = await Promise.all([
      db.collection(`shop_shops/${wid}/customers/${customerId}/ai_feedback`)
        .orderBy('createdAt', 'desc')
        .limit(AI_CONFIG.recentFeedbackLimit)
        .get(),
      getGlobalSuccessPatterns({
        source: 'message',
        scene: scene || null,
        storeType,
        limit: AI_CONFIG.globalPatternLimit,
      }),
      getAggregateHint({
        source: 'message',
        scene: scene || null,
        storeType,
      }),
    ]);
    const goodFb: string[] = [];
    const badFb: string[] = [];
    fbSnap.forEach((doc) => {
      const d = doc.data();
      const out = d.output as string;
      if (!out) return;
      if (d.rating > 0) goodFb.push(out);
      else if (d.rating < 0) badFb.push(out);
    });
    let feedbackBlock = '';
    if (goodFb.length > 0) {
      feedbackBlock += `\n\n## 過去に好評だった返信例（近い文体で書く）\n${goodFb.slice(0, AI_CONFIG.feedbackShowSlice).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
    if (badFb.length > 0) {
      feedbackBlock += `\n\n## 過去に不評だった返信例（この文体・切り口は避ける）\n${badFb.slice(0, AI_CONFIG.feedbackShowSlice).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
    let globalBlock = '';
    if (globalPatterns.length > 0) {
      globalBlock += `\n\n## 他ワークスペースから集約された成功パターン（匿名化済、参考）\n※ [NAME] / [PLACE] / [MONEY] 等は伏字化済み。文体・流れのみ参考にし伏字はそのまま使わない。\n${globalPatterns.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
    if (aggregateHint) {
      globalBlock += `\n\n## 集計ヒント\n${aggregateHint}`;
    }

    // ユーザーの追加指示があれば目的プロンプトに追加
    const requestPrompt = customPrompt
      ? `${purposePrompt}\n\n追加の指示: ${customPrompt}`
      : purposePrompt;

    let result: string;
    try {
      result = await generateText(
        `顧客データ:\n${customerContext}${selfBaseBlock}${feedbackBlock}${globalBlock}\n\nメッセージの目的: ${requestPrompt}`,
      {
        systemInstruction: `あなたはナイトワーク（ホスト・ホステス・キャバ嬢）専門のLINEメッセージ作成AIです。
お客様との関係構築・来店促進・リピート率向上を目的としたメッセージを作成します。
以下の業界プレイブックを最優先で遵守してください。

${playbookBlock}${storeBlock}


## メッセージ作成のコツ
- 相手の名前を入れて特別感を出す
- 前回の来店内容や会話を自然に盛り込む（ログデータを参照）
- 押し付けがましくない、さりげない営業
- 相手の好みや趣味に触れて親近感を出す
- NG項目（ngNote）には絶対に触れない
- お客様のランクや来店頻度に合わせたトーンで
- 常連客にはより親密に、新規客には丁寧めに
- MBTI・性格トレイト・コミュ特徴がある場合は必ず反映
- 刺さる話題（triggerPositive）を1つ自然に混ぜる
- 避けたい話題（triggerNegative）・dislikes・NG項目には一切触れない

## ルール
- 文字数は相手の温度感・目的・顧客プロファイルの avgLength を参考に柔軟に（150〜300 字目安）
- 絵文字頻度は顧客のコミュ特徴・自分のベース文体に合わせる（指定なしなら 2-3 個）
- メッセージ本文のみ出力（説明や注釈は不要）
- 3 パターンのメッセージを生成
- それぞれトーンや切り口を変える（甘め / カジュアル / 丁寧めなど）
- 必ず改行を入れて読みやすく（1 メッセージあたり 2-4 回の改行目安、ベタ一文禁止）

## 文体チェック（送信前に必ず見直す）
- 改行が入っているか、1 文 30-50 字か、読点が 1 文で 2 個以内か
- 括弧書きで心の声・補足が残ってないか（残ってたら削除）
- 禁止クリシェ（胸が締め付けられる / 言葉にならない / かけがえのない / 受け止めました / 向き合って / 救われて 等）を使ってないか
- 20-30 代の夜職スタッフがほんまに書く文面になっているか。教科書口調・文学口調は崩す

## 出力形式
JSON配列で3つのメッセージを出力:
["メッセージ1", "メッセージ2", "メッセージ3"]`,
          maxOutputTokens: 1500,
          temperature: 0.8,
          responseMimeType: 'application/json',
        }
      );
    } catch (err) {
      await refundAiCredit(uid, messageCost);
      throw err;
    }

    // JSON配列をパース
    let messages: string[] = [];
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        messages = parsed.filter((m: unknown) => typeof m === 'string' && m.trim());
      }
    } catch {
      // パース失敗時は単一メッセージとして扱う
      if (result && result.trim()) {
        messages = [result.trim()];
      }
    }

    // 空の場合はエラー（クレジットは返却）
    if (messages.length === 0) {
      await refundAiCredit(uid, messageCost);
      return NextResponse.json({ error: 'メッセージ生成に失敗しました' }, { status: 500 });
    }
    void logAiLedger(uid, 'message', messageCost);

    return NextResponse.json({
      messages,
      creditsRemaining: reserved.remaining,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI message error:', error);
    return NextResponse.json({ error: 'メッセージ生成失敗' }, { status: 500 });
  }
}
