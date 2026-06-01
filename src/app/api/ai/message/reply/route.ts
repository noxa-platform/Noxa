import { NextRequest, NextResponse } from 'next/server';
import { analyzeImages } from '../../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../../lib/firebase-admin';
import { resolveAccessContext, pathCustomer, pathCustomerSubcollection } from '../../../lib/access-context';
import { resolveWorkspaceContext, composePlaybookAndSelf, buildSelfBaseBlock } from '@/lib/ai-knowledge/prompt-helpers';
import { getGlobalSuccessPatterns, getAggregateHint } from '@/lib/ai-knowledge/global-patterns';
import { AI_CONFIG } from '@/lib/ai-knowledge/constants';

// この顧客の過去フィードバック（直近）を取得し good/bad に分ける
async function getRecentFeedback(ctx: import('../../../lib/access-context').AccessContext, customerId: string, limit = 10) {
  const db = getAdminDb();
  const snap = await db
    .collection(pathCustomerSubcollection(ctx, customerId, 'ai_feedback'))
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  const good: string[] = [];
  const bad: string[] = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const out = d.output as string;
    if (!out) return;
    if (d.rating > 0) good.push(out);
    else if (d.rating < 0) bad.push(out);
  });
  return { good, bad };
}

// 顧客コンテキストを構築
async function getCustomerContextForReply(ctx: import('../../../lib/access-context').AccessContext, customerId: string) {
  const db = getAdminDb();
  const snap = await db.doc(pathCustomer(ctx, customerId)).get();
  if (!snap.exists) return null;
  const d = snap.data()!;

  return {
    name: d.name || '不明',
    tags: d.tags || [],
    likes: d.likesNote || '',
    dislikes: d.dislikesNote || '',
    ngNote: d.ngNote || '',
    chatHistory: d.chatHistory || [],
    customerPersonality: d.customerPersonality || '',
    myMessageStyle: d.myMessageStyle || '',
    // 手入力の AI 学習プロファイル
    mbti: d.mbti || '',
    personalityTraits: (d.personalityTraits as string[]) || [],
    interests: (d.interests as string[]) || [],
    triggerPositive: (d.triggerPositive as string[]) || [],
    triggerNegative: (d.triggerNegative as string[]) || [],
    communicationStyle: d.communicationStyle || '',
    myStyleForCustomer: d.myStyleForCustomer || null,
  };
}

// シーン別の専用プロンプト（空文字=通常モード）
const SCENE_PROMPTS: Record<string, string> = {
  after_angry:
    '相手が怒っている / 冷たい反応をしている状況。\n- 言い訳・反論せず、まず共感と謝意\n- 関係修復を優先し、自分の非を認めるトーン\n- 押し付けがましい誘いはしない（すぐ会いたいと言わない）\n- 相手の気持ちを受け止める言葉を先頭に',
  nego_price:
    '金額・値下げ・特別扱いを求められている状況。\n- 即答で「無理」と言わず、気持ちを受け止めた上で柔らかく現実を伝える\n- 代替案（別日のサービス、次回特典など）を1つ提示\n- 関係性を壊さないトーン、売上より長期関係を優先',
  comeback_silent:
    '既読スルー明け / 長期間返信がなかった相手からの久々の連絡。\n- 重すぎず、「久しぶり！」的な軽さ\n- 「寂しかった」等のプレッシャーNG\n- 近況を軽く共有し、相手が返しやすい話題で終える',
  rival_mention:
    '他のキャスト / 店員 / 元カレ・元カノ等の名前が出た状況。\n- 比較や嫉妬を表に出さない\n- 相手の楽しい時間を肯定しつつ、自分の強みを自然に示す\n- 深掘りしすぎない、軽く流す',
  first_contact:
    '初回の来店後・初接触での最初のメッセージ。\n- 印象に残すため固有名（飲んだお酒・話した話題）を必ず1つ入れる\n- 敬語ベース、軽すぎない\n- 長くなりすぎない（相手が返信しやすい長さ）',
  apology:
    'こちら側のミスや遅刻等で謝る必要がある状況。\n- 言い訳せず、事実と謝意を最初に\n- 補償 / 埋め合わせを具体的に1つ提示\n- 絵文字は控えめ、誠実なトーン',
  invite_again:
    '同伴・アフター・次回来店の誘い。\n- 押し付けず、相手が断りやすい余地を残す\n- 具体的な日時を仮提示（「〇日の夜なら空いてる？」）\n- 相手の予定を優先するトーン',
  check_in:
    '特に用件なしの安否確認・近況伺い。\n- 営業色を消し、雑談として自然に\n- 相手が返しやすい短めの問いかけで終える\n- 絵文字は相手の普段のレベルに合わせる',
};

// MBTI から簡易な接客ヒントを返す（プロンプト膨張を避けるため短く）
function mbtiHint(mbti: string): string {
  const table: Record<string, string> = {
    INTJ: '論理的・効率重視。感情的な営業より合理性訴求',
    INTP: '知的好奇心をくすぐる話題。軽いユーモアも刺さる',
    ENTJ: '成果・数字・ステータスに反応。褒めるより尊敬示す',
    ENTP: '議論・新しさを好む。定型句より意外性のある返し',
    INFJ: '価値観・物語を重視。共感的で丁寧な返答が刺さる',
    INFP: '感情表現に繊細。急かさず、受容的な文体',
    ENFJ: '褒め・承認欲求を大切に。相手を立てる言葉を多めに',
    ENFP: '新鮮さ・感情の盛り上がり重視。絵文字・感嘆多め OK',
    ISTJ: '安定・約束・丁寧さ重視。軽すぎる文体は避ける',
    ISFJ: '気配り・細やかさに反応。負担の少ない誘い方',
    ESTJ: '結論から・実務的。段取りを明示すると好反応',
    ESFJ: '関係性・気遣いを好む。近況確認が効く',
    ISTP: '短文・実用的。ダラダラしたメッセージは嫌がる',
    ISFP: '感性・美的要素に反応。押し付けがましさ NG',
    ESTP: 'ノリ・即レス重視。堅苦しさを避けカジュアルに',
    ESFP: 'テンション・場の楽しさに反応。絵文字・誘いに前向き',
  };
  return table[mbti] || '';
}

// スクリーンショットから返信案を3パターン生成
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // FormDataから画像・パラメータを取得
    const formData = await request.formData();
    const workspaceId = formData.get('workspaceId') as string;
    const customerId = formData.get('customerId') as string;
    const customPrompt = (formData.get('customPrompt') as string) || '';
    const scene = (formData.get('scene') as string) || '';

    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'workspaceIdとcustomerIdは必須です' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // 画像ファイルを収集（最大3枚）
    const imageFiles: File[] = [];
    const entries = formData.getAll('images');
    for (const entry of entries) {
      if (entry instanceof File) {
        if (entry.size > 5 * 1024 * 1024) {
          return NextResponse.json(
            { error: `画像サイズが5MBを超えています: ${entry.name}` },
            { status: 400 }
          );
        }
        imageFiles.push(entry);
      }
    }

    if (imageFiles.length === 0) {
      return NextResponse.json({ error: '画像が1枚以上必要です' }, { status: 400 });
    }
    if (imageFiles.length > 3) {
      return NextResponse.json({ error: '画像は最大3枚までです' }, { status: 400 });
    }

    // 画像枚数 + 追加指示の長さでクレジット見積もり
    const replyCost = estimateAiCost({
      inputText: (customPrompt ?? '') + (scene ?? ''),
      imageCount: imageFiles.length,
      expectedOutputTokens: 1500, // 3 案 ×500
      featureMultiplier: 1.2,
    });
    const reserved = await reserveAiCredit(uid, replyCost);
    if (!reserved.ok) {
      return NextResponse.json({ error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: replyCost }, { status: 429 });
    }

    // 画像をbase64エンコード
    const images = await Promise.all(
      imageFiles.map(async (file) => {
        const buffer = await file.arrayBuffer();
        const data = Buffer.from(buffer).toString('base64');
        return { data, mimeType: file.type || 'image/png' };
      })
    );

    // 顧客データ取得
    const customerData = await getCustomerContextForReply(ctx, customerId);
    if (!customerData) {
      return NextResponse.json({ error: '顧客データが見つかりません' }, { status: 404 });
    }

    // ワークスペースのコンテキスト（storeType + selfBase + 店舗プロファイル）を一括解決
    const { storeType, selfData: selfBase, storeProfile } = await resolveWorkspaceContext(ctx);

    // 過去の 👍👎 フィードバック + グローバル成功パターン + 集計ヒント 並列取得
    const [feedback, globalPatterns, aggregateHint] = await Promise.all([
      getRecentFeedback(ctx, customerId, AI_CONFIG.recentFeedbackLimit),
      getGlobalSuccessPatterns({
        source: 'reply',
        scene: scene || null,
        storeType,
        limit: AI_CONFIG.globalPatternLimit,
      }),
      getAggregateHint({
        source: 'reply',
        scene: scene || null,
        storeType,
      }),
    ]);

    // 過去のやり取り（直近20件）
    const recentChat = customerData.chatHistory.slice(-20);
    const chatHistoryText =
      recentChat.length > 0
        ? recentChat
            .map((m: { sender: string; text: string }) =>
              `${m.sender === 'me' ? '自分' : '相手'}: ${m.text}`
            )
            .join('\n')
        : 'なし';

    // 顧客情報テキスト
    const customerInfo = [
      `名前: ${customerData.name}`,
      customerData.tags.length > 0 ? `タグ: ${customerData.tags.join(', ')}` : '',
      customerData.likes ? `好きなもの: ${customerData.likes}` : '',
      customerData.dislikes ? `嫌いなもの: ${customerData.dislikes}` : '',
      customerData.ngNote ? `NG事項: ${customerData.ngNote}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    // プロンプト構築
    let prompt = `上記のスクリーンショットは直近のやり取りです。
この会話の流れを読み取り、次の返信メッセージを3パターン生成してください。

## ルール
- 自分の文体の癖を再現する（口調、絵文字の使い方、言い回し）
- 相手の性格・温度感・タメ口/敬語に合わせる
- 営業的すぎず、自然な返信
- 文字数は相手の文字数に合わせて柔軟に（短文客には短く、長文相談なら 200-400 字もあり）
- 必ず改行を入れて読みやすく（1 返信あたり 2〜4 回の改行が目安、ベタ一文禁止）
- NG項目には絶対触れない

## 文体チェック（送信前に必ず見直す）
- 改行が入っているか、1 文が 30-50 字か、読点が 1 文で 2 個以内か
- 括弧書きで心の声・補足が残ってないか
- 禁止クリシェ（胸が締め付けられる / 言葉にならない / かけがえのない / 受け止めました / 向き合って / 救われて 等）を使ってないか
- 20-30 代の夜職スタッフがほんまに書く文面になっているか。教科書口調・文学口調は崩す

## 出力形式
JSON配列で3つの返信案:
["返信案1", "返信案2", "返信案3"]`;

    if (scene && SCENE_PROMPTS[scene]) {
      prompt += `\n\n## シーン指定\n${SCENE_PROMPTS[scene]}`;
    }

    if (customPrompt) {
      prompt += `\n\n## 追加の指示\n${customPrompt}`;
    }

    // システムインストラクション構築。プレイブックは composePlaybookAndSelf で統一
    const { playbookBlock, storeBlock } = composePlaybookAndSelf({ storeType, scene, compact: false, selfData: null, storeProfile });
    const systemParts = [
      'あなたはナイトワーク（ホスト・ホステス・キャバ嬢）専門のLINE返信アドバイザーです。',
      '以下の業界プレイブックを最優先で遵守してください。',
      '',
      playbookBlock,
      storeBlock,
      '',
      '## 顧客情報',
      customerInfo,
    ];

    // 手入力の AI 学習プロファイル
    if (customerData.mbti) {
      const hint = mbtiHint(customerData.mbti);
      systemParts.push('', `## MBTI\n${customerData.mbti}${hint ? ` — ${hint}` : ''}`);
    }
    if (customerData.personalityTraits.length > 0) {
      systemParts.push('', `## 性格トレイト\n${customerData.personalityTraits.join('、')}`);
    }
    if (customerData.interests.length > 0) {
      systemParts.push('', `## 興味・関心\n${customerData.interests.join('、')}`);
    }
    if (customerData.triggerPositive.length > 0) {
      systemParts.push('', `## 刺さる話題（積極的に触れてよい）\n${customerData.triggerPositive.join('、')}`);
    }
    if (customerData.triggerNegative.length > 0) {
      systemParts.push('', `## 避けたい話題（触れない）\n${customerData.triggerNegative.join('、')}`);
    }
    if (customerData.communicationStyle) {
      systemParts.push('', `## コミュニケーション特徴\n${customerData.communicationStyle}`);
    }

    // スクショ解析で学習済みの情報
    if (customerData.customerPersonality) {
      systemParts.push('', '## 相手の性格（スクショ解析）', customerData.customerPersonality);
    }
    if (customerData.myMessageStyle) {
      systemParts.push('', '## 自分の文体の特徴（この人向け）', customerData.myMessageStyle);
    }

    // 顧客ごとの自分の使い分け（手入力 or 将来 AI 学習）
    if (customerData.myStyleForCustomer) {
      const s = customerData.myStyleForCustomer as {
        tone?: string;
        emojiLevel?: string;
        avgLength?: number;
        signaturePhrases?: string[];
        notes?: string;
      };
      const parts = [
        s.tone ? `トーン: ${s.tone}` : '',
        s.emojiLevel ? `絵文字頻度: ${s.emojiLevel}` : '',
        s.avgLength ? `平均文字数: ${s.avgLength}` : '',
        s.signaturePhrases?.length ? `よく使う言い回し: ${s.signaturePhrases.join('、')}` : '',
        s.notes || '',
      ].filter(Boolean);
      if (parts.length > 0) {
        systemParts.push('', '## この人向けの自分の文体設定', parts.join('\n'));
      }
    }

    // 自分のベース文体（顧客固有より優先度低）
    // selfBase は resolveWorkspaceContext で取得済み。buildSelfBaseBlock で共通生成
    const selfBlockText = buildSelfBaseBlock(selfBase, '## 自分のベース文体（この人向け文体がなければこれを使う）');
    if (selfBlockText) {
      systemParts.push(selfBlockText);
    }

    if (recentChat.length > 0) {
      systemParts.push('', '## 過去のやり取り（参考）', chatHistoryText);
    }

    // 過去の 👍👎 フィードバック
    if (feedback.good.length > 0) {
      systemParts.push(
        '',
        '## 過去に好評だった返信例（近い文体で書く）',
        feedback.good.slice(0, AI_CONFIG.feedbackShowSlice).map((s, i) => `${i + 1}. ${s}`).join('\n')
      );
    }
    if (feedback.bad.length > 0) {
      systemParts.push(
        '',
        '## 過去に不評だった返信例（この文体・切り口は避ける）',
        feedback.bad.slice(0, AI_CONFIG.feedbackShowSlice).map((s, i) => `${i + 1}. ${s}`).join('\n')
      );
    }

    // 他ワークスペースから集約された匿名化成功パターン（固有名詞は伏字化済）
    if (globalPatterns.length > 0) {
      systemParts.push(
        '',
        '## 他ワークスペースから集約された成功パターン（匿名化済、参考として）',
        '※ [NAME] / [PLACE] / [MONEY] / [DATE] 等は伏字化されています。文体・構成・流れのみ参考にし、伏字をそのまま使わないこと。',
        globalPatterns.map((s, i) => `${i + 1}. ${s}`).join('\n')
      );
    }
    if (aggregateHint) {
      systemParts.push('', `## 集計ヒント\n${aggregateHint}`);
    }

    let result: string;
    try {
      result = await analyzeImages(images, prompt, {
        systemInstruction: systemParts.join('\n'),
        maxOutputTokens: 1500,
        temperature: 0.8,
        responseMimeType: 'application/json',
      });
    } catch (err) {
      await refundAiCredit(uid, replyCost);
      throw err;
    }

    // JSON配列をパース
    let replies: string[] = [];
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        replies = parsed.filter((m: unknown) => typeof m === 'string' && m.trim());
      }
    } catch {
      // パース失敗時は単一メッセージとして扱う
      if (result && result.trim()) {
        replies = [result.trim()];
      }
    }

    if (replies.length === 0) {
      await refundAiCredit(uid, replyCost);
      return NextResponse.json({ error: '返信案の生成に失敗しました' }, { status: 500 });
    }
    void logAiLedger(uid, 'message-reply', replyCost);

    return NextResponse.json({
      replies,
      creditsRemaining: reserved.remaining,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('Reply suggestion error:', error);
    return NextResponse.json({ error: '返信提案の生成に失敗しました' }, { status: 500 });
  }
}
