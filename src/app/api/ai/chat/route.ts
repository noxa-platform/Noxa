import { NextRequest, NextResponse } from 'next/server';
import { generateChatStream, analyzeImages, type ChatHistoryEntry } from '../ai-provider';
import { generateOpenRouterStream, type OpenRouterChatMessage } from '../openrouter';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { computeChatCost } from '@/lib/ai-cost';
import { resolveWorkspaceContext, composePlaybookAndSelf } from '@/lib/ai-knowledge/prompt-helpers';
import { AI_CONFIG } from '@/lib/ai-knowledge/constants';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathCustomers, pathStandaloneSales, pathAiThread, type AccessContext } from '../../lib/access-context';

// 会話履歴の最大メッセージ数
const MAX_HISTORY_MESSAGES = AI_CONFIG.maxHistoryMessages;

// 顧客データの部分送信閾値
const FULL_DATA_THRESHOLD = AI_CONFIG.fullDataThreshold;

// 顧客紐付けなしの「日売」（standalone_sales）を直近 60 日分取得して
// AI コンテキストに含めるための要約文を返す。
// 例: 「フリー客」「ヘルプ売上」「店舗一括売上」など顧客 doc を作らない記録。
// 月次集計の sales-service ではちゃんと加算されているが、
// /api/ai/chat の getCustomerContext がこれを見ていない → AI が「顧客なし日売」
// を読み取れない問題への対応。
async function getStandaloneSalesContext(ctx: AccessContext): Promise<string> {
  try {
    const db = getAdminDb();
    // 直近 60 日分。月跨ぎの「先月どうだった」質問にも対応するため余裕を持たせる。
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const snap = await db
      .collection(pathStandaloneSales(ctx))
      .where('datetime', '>=', sixtyDaysAgo)
      .orderBy('datetime', 'desc')
      .limit(200)
      .get();

    if (snap.empty) return '';

    // 月別 / 当月のサマリーと、個別エントリを軽く併記する
    const items = snap.docs.map((doc) => {
      const d = doc.data();
      const ts = d.datetime;
      const date = ts && typeof ts.toDate === 'function' ? (ts.toDate() as Date) : null;
      return {
        date: date ? date.toISOString().slice(0, 10) : null,
        salesAmount: d.salesAmount || 0,
        groupCount: d.groupCount || null,
        place: d.place || null,
        memo: d.memo || null,
      };
    });

    // 当月合算
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = items.filter((i) => i.date?.startsWith(monthKey));
    const thisMonthTotal = thisMonth.reduce((sum, i) => sum + i.salesAmount, 0);
    const thisMonthGroups = thisMonth.reduce((sum, i) => sum + (i.groupCount || 0), 0);

    let context = '## 顧客なし日売（顧客に紐付かないフリー客・ヘルプ売上等）\n';
    context += `直近 60 日のエントリ数: ${items.length} 件\n`;
    context += `今月 (${monthKey}) の合計: ${thisMonthTotal.toLocaleString()}円 / 組数 ${thisMonthGroups} 組\n\n`;
    context += '個別エントリ（新しい順、最大 50 件）:\n';
    context += JSON.stringify(items.slice(0, 50), null, 2);
    return context;
  } catch (e) {
    console.error('getStandaloneSalesContext error:', e);
    return '';
  }
}

// 顧客データをコンテキストとして取得（部分送信対応）
async function getCustomerContext(
  ctx: AccessContext,
  mentionedNames: string[]
): Promise<string> {
  try {
    const db = getAdminDb();
    const snap = await db.collection(pathCustomers(ctx)).get();
    if (snap.empty) return '現在登録されている顧客はいません。';

    const customerCount = snap.docs.length;

    // 50人以下：全データ送信
    if (customerCount <= FULL_DATA_THRESHOLD) {
      const customers = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          name: d.name || '不明',
          tags: d.tags || [],
          totalSales: d.totalSales || 0,
          birthday: d.birthday || null,
          likes: d.likesNote || '',
          dislikes: d.dislikesNote || '',
          ngNote: d.ngNote || '',
          importantMemo: d.importantMemo || '',
          rank: d.rank || null,
          mbti: d.mbti || null,
          personalityTraits: d.personalityTraits || [],
          interests: d.interests || [],
          triggerPositive: d.triggerPositive || [],
          triggerNegative: d.triggerNegative || [],
          communicationStyle: d.communicationStyle || '',
          customerPersonality: d.customerPersonality || '',
          myMessageStyle: d.myMessageStyle || '',
        };
      });
      return JSON.stringify(customers, null, 2);
    }

    // 50人超：サマリー + 言及された顧客の詳細
    const summaries: { name: string; tags: string[]; rank: string | null; totalSales: number }[] = [];
    const detailedCustomers: Record<string, unknown>[] = [];

    for (const doc of snap.docs) {
      const d = doc.data();
      const name = d.name || '不明';

      // メッセージで言及された顧客は詳細データを含める
      const isMentioned = mentionedNames.some(
        (n) => name.includes(n) || n.includes(name)
      );

      if (isMentioned) {
        detailedCustomers.push({
          name,
          tags: d.tags || [],
          totalSales: d.totalSales || 0,
          birthday: d.birthday || null,
          likes: d.likesNote || '',
          dislikes: d.dislikesNote || '',
          ngNote: d.ngNote || '',
          importantMemo: d.importantMemo || '',
          rank: d.rank || null,
          mbti: d.mbti || null,
          personalityTraits: d.personalityTraits || [],
          interests: d.interests || [],
          triggerPositive: d.triggerPositive || [],
          triggerNegative: d.triggerNegative || [],
          communicationStyle: d.communicationStyle || '',
          customerPersonality: d.customerPersonality || '',
          myMessageStyle: d.myMessageStyle || '',
        });
      } else {
        summaries.push({
          name,
          tags: d.tags || [],
          rank: d.rank || null,
          totalSales: d.totalSales || 0,
        });
      }
    }

    let context = `顧客数: ${customerCount}人\n\n`;

    if (detailedCustomers.length > 0) {
      context += `## 言及された顧客の詳細:\n${JSON.stringify(detailedCustomers, null, 2)}\n\n`;
    }

    context += `## 全顧客サマリー（名前・タグ・ランク・売上のみ）:\n${JSON.stringify(summaries, null, 2)}`;

    return context;
  } catch (e) {
    console.error('getCustomerContext error:', e);
    return '顧客データの取得でエラーが発生しました。';
  }
}

// メッセージから顧客名の候補を抽出（簡易実装: 「〇〇さん」「〇〇の」等のパターン）
function extractMentionedNames(message: string, history?: { role: string; content: string }[]): string[] {
  const names: string[] = [];

  // 現在のメッセージと履歴から名前パターンを抽出
  const allTexts = [message];
  if (history) {
    // 直近5メッセージのみ確認
    const recent = history.slice(-5);
    for (const h of recent) {
      allTexts.push(h.content);
    }
  }

  for (const text of allTexts) {
    // 「〇〇さん」「〇〇くん」「〇〇ちゃん」「〇〇様」パターン
    const patterns = text.match(/([一-龠ぁ-んァ-ヶA-Za-zＡ-Ｚａ-ｚ]{2,10})(さん|くん|ちゃん|様|の)/g);
    if (patterns) {
      for (const p of patterns) {
        const name = p.replace(/(さん|くん|ちゃん|様|の)$/, '');
        if (name.length >= 2) names.push(name);
      }
    }
  }

  return [...new Set(names)];
}

// システムプロンプト
const SYSTEM_PROMPT = `あなたは Noxa の AI アシスタント。20-35 歳のナイトワーカー（キャバ / ホスト / ラウンジ / バー / 風俗 / パパ活 / ギャラ飲み）の現場をよく知る同業の先輩としてアドバイスする。上司や評論家ではない。

## やること
顧客データ（好み・NG・来店履歴・売上・プレゼント）に基づく接客アドバイス／データ分析／LINE スクショの読解と返信案提示。

## データソース
コンテキストには 2 種類の売上データが入る:
1. 顧客データ（name / totalSales / tags 等）— 顧客に紐付く売上の合算
2. 「顧客なし日売」セクション — フリー客・ヘルプ・店舗一括売上など顧客 doc を作らない記録
   今月合計や個別エントリが「## 顧客なし日売」見出しで来る
売上総額・組数を聞かれたら必ず両方を合算する。「顧客なし日売」が空欄でも誤って「顧客がいない」「売上 0」と返さない。

## レスポンス形式（必ず JSON）
{"reply": "...", "actions": [{"type": "add_log|add_reminder|add_sales", "label": "...", "data": {...}}]}
アクション不要なら {"reply": "..."} だけ。

### actions（ユーザーが操作を依頼したとき返す）
- add_log: data に customerName / logType / date(YYYY-MM-DD、不明なら省略) / memo / salesAmount / reaction(任意)
- add_reminder: data に customerName / reminderText / reminderDate
- add_sales: data に customerName / salesAmount / date / logType（指定なければ "visit"）

logType: visit(売上) / douhan(同伴) / outside(外出) / call(電話) / message(メッセージ) / after(アフター) / other

## スクショが来たとき
- 「返信して / 何て返す？」→ 返信案 3 つ
- 「分析して」→ 性格や好みを端的に
- 指示なし → 会話要約 + 返信案 3 つ

## 出力ルール（絶対）
- 日本語のみ、アスタリスク（** や *）禁止。区切りは改行か ◆ ● ■
- 数字あるなら数字交えて、長文分析は箇条書き
- 角括弧プレースホルダ（[intro:...] など）をそのまま出さない

## 返信案フォーマット（提示するとき必ず厳守）
1 案でも必ず「返信案1:」マーカー付き。デフォルトは 3 案。本文は「」で囲む。

例:
状況の短いコメント（50字以内）

返信案1:
「本文 ...」

返信案2:
「本文 ...」

返信案3:
「本文 ...」

- マーカー無しの返信案は絶対 NG（フロントが検知できない）
- 「以下に提案します」だけで本文省略は絶対 NG
- 文字数は相手に合わせる。短文客には短く。上限目安 500 字
- 相手のタメ口・絵文字頻度に合わせる
- ユーザーが返信案を求めていなければこの形式不要

## 文体チェック
- 改行 2〜4 回、1 文 30-50 字、読点 1 文 2 個以内
- 禁止クリシェ: 胸が締め付けられる / 言葉にならない / かけがえのない / 受け止めました / 向き合って / 救われて
- 固い文語・ビジネスメール口調は全部崩す`;

// raw JSON（{"reply":"...","actions":[...]}）を parse して reply 本文と actions を返す。
// 途切れた JSON にもフォールバックで対応。画像経路 / テキスト経路の両方から呼ぶ共通ヘルパー。
function parseRawReply(rawReply: string): { reply: string; actions: unknown[] | undefined } {
  try {
    const parsed = JSON.parse(rawReply);
    return {
      reply: parsed.reply || '',
      actions: Array.isArray(parsed.actions) && parsed.actions.length > 0 ? parsed.actions : undefined,
    };
  } catch {
    const m = rawReply.match(/"reply"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|$)/);
    if (m) {
      return {
        reply: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        actions: undefined,
      };
    }
    return {
      reply: rawReply
        .replace(/^\s*\{\s*"reply"\s*:\s*"?/, '')
        .replace(/"?\s*\}\s*$/, '')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"'),
      actions: undefined,
    };
  }
}

// チャット履歴を Firestore に永続化（直近 100 件まで保持）。
// 全クライアントが /api/ai/threads 経由でスレッド管理に移行済みのため threadId 必須。
// タイトルが既定（「新しいトーク」）かつ初投稿なら user メッセージ先頭 30 文字でリネーム。
//
// 旧 ai_sessions/{uid} への書き込みは廃止（マイグレーションのソースとして読み取りのみ残置）。
async function persistChatHistory(opts: {
  ctx: AccessContext;
  uid: string;
  threadId: string;
  message: string;
  reply: string;
}) {
  const { ctx, uid, threadId, message, reply } = opts;
  const db = getAdminDb();
  const now = Date.now();
  const newPair = [
    { role: 'user', content: message, ts: now },
    { role: 'assistant', content: reply, ts: now + 1 },
  ];

  const threadRef = db.doc(pathAiThread(ctx, threadId));
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists || threadSnap.data()?.ownerUid !== uid) {
    throw new Error('thread not found or forbidden');
  }
  const existingMessages: { role: string; content: string; ts: number }[] =
    threadSnap.data()?.messages || [];
  const updated = [...existingMessages, ...newPair];
  const trimmed = updated.length > 100 ? updated.slice(updated.length - 100) : updated;

  const currentTitle: string = threadSnap.data()?.title || '新しいトーク';
  const shouldDeriveTitle = currentTitle === '新しいトーク' && existingMessages.length === 0;
  const derivedTitle = (() => {
    const flat = message.replace(/\s+/g, ' ').trim();
    if (!flat) return currentTitle;
    return flat.length <= 30 ? flat : flat.slice(0, 30) + '…';
  })();

  await threadRef.update({
    messages: trimmed,
    messageCount: trimmed.length,
    updatedAt: now,
    ...(shouldDeriveTitle ? { title: derivedTitle } : {}),
  });
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // Content-Typeに応じてパース方法を切り替え
    const contentType = request.headers.get('content-type') || '';
    let workspaceId: string;
    let threadId: string | undefined;
    let message: string;
    let history: { role: string; content: string }[] | undefined;
    let modelMode: 'fast' | 'think' = 'fast';
    // 運営者がデフォルトモデルを差し替えるための「環境変数経由スイッチ」。
    // 一般ユーザーには UI 露出しない。運営者が OPENROUTER_API_KEY と
    // AI_PRIMARY_MODEL_FAST / AI_PRIMARY_MODEL_THINK を Vercel 環境変数で設定すると、
    // それぞれの modelMode で OpenRouter 経由のモデルが使われる。
    // 値は "openrouter:provider/model" 形式（例: "openrouter:anthropic/claude-sonnet-4.5"）。
    // 値が無い / "openrouter:" 接頭辞でないときは Gemini 直叩きを継続。
    // クライアント送信の overrideModel は admin 限定（後段で email チェック）。
    let overrideModel: string | null = null;
    const imageDataList: { data: string; mimeType: string }[] = [];

    if (contentType.includes('multipart/form-data')) {
      // FormData（画像付き）
      const formData = await request.formData();
      workspaceId = formData.get('workspaceId') as string;
      threadId = (formData.get('threadId') as string) || undefined;
      message = formData.get('message') as string;
      const modeStr = formData.get('modelMode') as string;
      if (modeStr === 'think') modelMode = 'think';
      const overrideStr = formData.get('overrideModel') as string | null;
      if (overrideStr && overrideStr.startsWith('openrouter:')) overrideModel = overrideStr.slice('openrouter:'.length);
      const historyStr = formData.get('history') as string;
      history = historyStr ? JSON.parse(historyStr) : undefined;

      // 画像をbase64に変換
      const imageFiles = formData.getAll('images') as File[];
      for (const file of imageFiles) {
        if (file.size > 5 * 1024 * 1024) continue; // 5MB超はスキップ
        const buffer = await file.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        imageDataList.push({ data: base64, mimeType: file.type || 'image/jpeg' });
      }
    } else {
      // JSON（テキストのみ）
      const body = await request.json();
      workspaceId = body.workspaceId;
      threadId = body.threadId;
      message = body.message;
      history = body.history;
      if (body.modelMode === 'think') modelMode = 'think';
      if (typeof body.overrideModel === 'string' && body.overrideModel.startsWith('openrouter:')) {
        overrideModel = body.overrideModel.slice('openrouter:'.length);
      }
    }

    // modelMode 確定後に環境変数からデフォルト override を解決。
    // クライアントから明示的に送られた overrideModel が無いときだけ env を使う。
    if (!overrideModel) {
      const envOverride =
        modelMode === 'think' ? process.env.AI_PRIMARY_MODEL_THINK : process.env.AI_PRIMARY_MODEL_FAST;
      if (envOverride && envOverride.startsWith('openrouter:')) {
        overrideModel = envOverride.slice('openrouter:'.length);
      }
    }

    // クライアント送信の overrideModel は admin（運営者）のみ受け付ける。
    // 一般ユーザーから飛んできても無視（env 経由の値があればそちらを使う）。
    // formData 受信した overrideModel は formData 段で既に書かれているため、
    // ここで admin 以外の値は env 値に戻す。
    if (overrideModel) {
      try {
        const { getAdminAuth } = await import('../../lib/firebase-admin');
        const { isAdmin } = await import('@/lib/admin');
        const userRecord = await getAdminAuth().getUser(uid);
        if (!isAdmin(userRecord.email)) {
          // クライアント送信を破棄して env のみ採用
          const envOverride =
            modelMode === 'think' ? process.env.AI_PRIMARY_MODEL_THINK : process.env.AI_PRIMARY_MODEL_FAST;
          overrideModel = envOverride && envOverride.startsWith('openrouter:')
            ? envOverride.slice('openrouter:'.length)
            : null;
        }
      } catch {
        // admin チェック失敗時は安全側で env のみ
        overrideModel = null;
      }
    }

    if (!workspaceId || !message) {
      return NextResponse.json({ error: 'パラメータが不足しています' }, { status: 400 });
    }
    if (!threadId) {
      // 全クライアントが /api/ai/threads でスレッドを確保してから送信する前提。
      // 旧クライアント救済の ai_sessions フォールバックは廃止済み。
      return NextResponse.json({ error: 'threadId は必須です' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // 動的クレジットコスト: 入力長 + 画像枚数 × モデル係数（FAST=1, THINK=3）
    // クライアント側 chat-input でも同じ値を計算して送信ボタンに表示する
    const chatCost = computeChatCost(message, imageDataList.length, modelMode);

    // クレジットを atomic に予約（race condition 防止）
    // Gemini 呼出に失敗したら refundAiCredit で巻き戻す
    const reserved = await reserveAiCredit(uid, chatCost);
    if (!reserved.ok) {
      return NextResponse.json({
        error: 'AIクレジットが不足しています。プランをアップグレードしてください。',
        creditsRemaining: reserved.remaining,
        requiredCredits: chatCost,
      }, { status: 429 });
    }

    // メッセージから顧客名を抽出
    const mentionedNames = extractMentionedNames(message, history);

    // 顧客データと顧客なし日売をコンテキストとして並列取得
    const [customerContext, standaloneSalesContext] = await Promise.all([
      getCustomerContext(ctx, mentionedNames),
      getStandaloneSalesContext(ctx),
    ]);

    // 今日の日付をコンテキストに含める（相対日付の解決用）
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];

    // プレイブック + 店舗プロファイル + 自分のベース文体を一括解決
    const { storeType, selfData, storeProfile } = await resolveWorkspaceContext(ctx);
    const { combined: playbookAndSelf } = composePlaybookAndSelf({
      storeType,
      compact: true,
      selfData,
      selfHeading: '## ユーザー（送信者）自身のプロファイル',
      storeProfile,
    });
    const fullSystemPrompt = `${SYSTEM_PROMPT}\n\n${playbookAndSelf}`;

    const standaloneSection = standaloneSalesContext
      ? `\n\n${standaloneSalesContext}`
      : '';
    const prompt = `今日は${today}（${dayOfWeek}曜日）です。\n\n以下は現在のワークスペースの顧客データです:\n${customerContext}${standaloneSection}\n\nユーザーの質問: ${message}`;

    // 画像経路: 従来どおりマルチモーダル一括レスポンス（ストリーミング非対応）
    if (imageDataList.length > 0) {
      let rawReply: string;
      try {
        rawReply = await analyzeImages(imageDataList, prompt, {
          systemInstruction: fullSystemPrompt,
          maxOutputTokens: 2048,
          temperature: 0.7,
          responseMimeType: 'application/json',
        });
      } catch (err) {
        await refundAiCredit(uid, chatCost);
        throw err;
      }

      const { reply, actions } = parseRawReply(rawReply);
      try {
        await persistChatHistory({
          ctx,
          uid,
          threadId,
          message,
          reply: reply || rawReply,
        });
      } catch (e) {
        console.error('chat history persist error:', e);
      }

      return NextResponse.json({
        reply: reply || '回答を生成できませんでした。',
        actions,
        model: overrideModel ?? 'openrouter',
        modelMode,
        creditsRemaining: reserved.remaining,
      });
    }

    // テキスト経路: SSE ストリーミング（chunk ごとに client へ流す）
    const geminiHistory: ChatHistoryEntry[] = [];
    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
      for (const h of recentHistory) {
        geminiHistory.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }],
        });
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let rawReply = '';
        try {
          if (overrideModel) {
            // OpenRouter 経由: Gemini 互換 history を OpenAI messages に変換
            const messages: OpenRouterChatMessage[] = [
              { role: 'system', content: fullSystemPrompt },
              ...geminiHistory.map((h) => ({
                role: (h.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user',
                content: h.parts.map((p) => p.text).join('\n'),
              })),
              { role: 'user', content: prompt },
            ];
            rawReply = await generateOpenRouterStream(
              {
                model: overrideModel,
                messages,
                temperature: 0.7,
                maxTokens: modelMode === 'think' ? 4096 : 2048,
                responseFormat: 'json_object',
              },
              (text) => {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'chunk', text })}\n\n`,
                ));
              },
            );
          } else {
          await generateChatStream(prompt, {
            systemInstruction: fullSystemPrompt,
            maxOutputTokens: modelMode === 'think' ? 4096 : 2048,
            temperature: 0.7,
            responseMimeType: 'application/json',
            history: geminiHistory,
            modelTier: modelMode === 'think' ? 'pro' : 'flash',
            onChunk: (text) => {
              rawReply += text;
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'chunk', text })}\n\n`,
              ));
            },
          });
          }

          const { reply, actions } = parseRawReply(rawReply);

          try {
            await persistChatHistory({
              ctx,
              uid,
              threadId,
              message,
              reply: reply || rawReply,
            });
          } catch (e) {
            console.error('chat history persist error:', e);
          }

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({
              type: 'meta',
              reply: reply || '回答を生成できませんでした。',
              actions,
              model: overrideModel ?? (modelMode === 'think' ? 'gemini-2.5-pro' : 'gemini-2.5-flash'),
              modelMode,
              creditsRemaining: reserved.remaining,
            })}\n\n`,
          ));
          void logAiLedger(uid, 'chat', chatCost);
          controller.close();
        } catch (err) {
          console.error('AI chat stream error:', err);
          await refundAiCredit(uid, chatCost);
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'AI応答の生成に失敗しました' })}\n\n`,
          ));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // Vercel/CDN のバッファリング無効化
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI chat error:', error);
    return NextResponse.json({ error: 'AI応答の生成に失敗しました' }, { status: 500 });
  }
}
