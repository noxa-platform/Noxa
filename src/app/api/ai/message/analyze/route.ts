import { NextRequest, NextResponse } from 'next/server';
import { analyzeImages } from '../../ai-provider';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../../with-credits';
import { getAdminDb, verifyRequest, AuthError } from '../../../lib/firebase-admin';
import { resolveAccessContext } from '../../../lib/access-context';
import { FieldValue } from 'firebase-admin/firestore';

// スクリーンショットから会話を解析してFirestoreに保存
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // FormDataから画像を取得（先にパースしてから workspaceId 検証）
    const formData = await request.formData();
    const workspaceId = formData.get('workspaceId') as string;
    const customerId = formData.get('customerId') as string;

    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'workspaceIdとcustomerIdは必須です' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // 画像ファイルを収集（最大5枚、各5MB以下）
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
    if (imageFiles.length > 5) {
      return NextResponse.json({ error: '画像は最大5枚までです' }, { status: 400 });
    }

    // 画像枚数に応じて消費（スクショ解析は重い）
    const analyzeCost = estimateAiCost({
      inputText: '',
      imageCount: imageFiles.length,
      expectedOutputTokens: 1500,
      featureMultiplier: 1.5, // 解析は構造的解読が重い
    });

    return await withReservedCredits(uid, analyzeCost, async ({ ack, remaining }) => {
      // 画像をbase64エンコード
      const images = await Promise.all(
        imageFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const data = Buffer.from(buffer).toString('base64');
          return { data, mimeType: file.type || 'image/png' };
        })
      );

      // Geminiで会話テキスト抽出
      const prompt = `以下のLINE・DMのスクリーンショットを読み取り、会話内容を抽出してください。

## 出力形式（JSON）
{
  "messages": [
    {"sender": "me", "text": "メッセージ内容", "mood": "positive"},
    {"sender": "customer", "text": "メッセージ内容", "mood": "neutral"}
  ],
  "customerPersonality": "相手の性格・思考・好みの特徴を150文字程度で",
  "myStyle": "自分のメッセージの癖・文体・口調の特徴を150文字程度で"
}

## ルール
- senderは "me"（右側/緑の吹き出し/自分側）と "customer"（左側/白の吹き出し/相手側）で判定
- moodは positive/neutral/negative の3値で各発言のトーンを推定
- スタンプや画像は [スタンプ] [画像] と記載
- 時系列順に全メッセージを抽出
- 複数のスクリーンショットは一連の会話として統合
- 日本語で出力`;

      const result = await analyzeImages(images, prompt, {
        systemInstruction: 'LINEやDMのスクリーンショットから会話内容を正確に読み取る画像解析AIです。指定されたJSON形式で出力してください。',
        maxOutputTokens: 3000,
        temperature: 0.2,
        responseMimeType: 'application/json',
      });

      // レスポンスをパース
      let parsed: {
        messages: { sender: string; text: string; mood?: string }[];
        customerPersonality: string;
        myStyle: string;
      };

      try {
        parsed = JSON.parse(result);
      } catch {
        console.error('Gemini応答のパース失敗 (result length:', result.length, ')');
        return NextResponse.json({ error: '画像解析結果のパースに失敗しました' }, { status: 500 });
      }

      if (!parsed.messages || !Array.isArray(parsed.messages)) {
        return NextResponse.json({ error: '会話メッセージが抽出できませんでした' }, { status: 500 });
      }

      // chatHistory用にanalyzedAtを付与
      const now = new Date().toISOString();
      const validMoods = ['positive', 'neutral', 'negative'];
      const newMessages = parsed.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
        mood: validMoods.includes(m.mood || '') ? m.mood : 'neutral',
        analyzedAt: now,
      }));

      // Firestoreに保存
      const db = getAdminDb();
      const customerRef = db.doc(`shop_shops/${workspaceId}/customers/${customerId}`);

      // 既存のchatHistoryを取得して件数制限
      const customerSnap = await customerRef.get();
      const existing = customerSnap.exists ? customerSnap.data() ?? {} : {};
      const existingHistory: { sender: string; text: string; mood?: string; analyzedAt: string }[] =
        (existing.chatHistory as typeof existingHistory) || [];

      // 既存 + 新規を結合し、最大100件に制限（古いものから削除）
      const combined = [...existingHistory, ...newMessages];
      const trimmed = combined.length > 100 ? combined.slice(combined.length - 100) : combined;

      // customerPersonality / myMessageStyle は破壊的上書きせず、空でない場合のみ更新
      // さらに既存値があれば追記（履歴を残し、editor による偶発的削除を防止）
      const patch: Record<string, unknown> = {
        chatHistory: trimmed,
        chatAnalyzedAt: FieldValue.serverTimestamp(),
      };
      if (parsed.customerPersonality && parsed.customerPersonality.trim()) {
        const prev = (existing.customerPersonality as string | undefined)?.trim();
        patch.customerPersonality = prev && prev !== parsed.customerPersonality.trim()
          ? `${prev}\n${parsed.customerPersonality.trim()}`
          : parsed.customerPersonality.trim();
      }
      if (parsed.myStyle && parsed.myStyle.trim()) {
        const prev = (existing.myMessageStyle as string | undefined)?.trim();
        patch.myMessageStyle = prev && prev !== parsed.myStyle.trim()
          ? `${prev}\n${parsed.myStyle.trim()}`
          : parsed.myStyle.trim();
      }

      await customerRef.update(patch);

      ack();
      return NextResponse.json({
        messagesCount: parsed.messages.length,
        customerPersonality: parsed.customerPersonality || '',
        myStyle: parsed.myStyle || '',
        creditsRemaining: remaining,
      });
    }, 'message-analyze');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('Screenshot analyze error:', error);
    return NextResponse.json({ error: 'スクリーンショット解析に失敗しました' }, { status: 500 });
  }
}
