// 顧客との LINE / DM スクショから「相手（顧客）の情報」を抽出する API。
//
// 既存の /api/ai/profile-extract は「ユーザー自身 + 店舗」のプロファイル抽出だが、
// こちらは AI チャットに投げられた会話スクショから、相手の好み・性格・温度感・
// 次のアクションなどを推測して、顧客カルテに反映する候補を返す。
//
// 安全側の挙動:
// - 名前は推測できる範囲（呼び名 / 源氏名 / ニックネーム）のみ。本名は推測しない
// - 効果数値や売上の捏造禁止
// - 既存顧客リストを受け取れば「nameHint と部分一致する顧客」の候補を返す
// - 全フィールドが空（= 顧客情報を含まない画像）なら hasContent=false で返す
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { analyzeImages } from '../ai-provider';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../with-credits';

interface ExtractRequestBody {
  workspaceId: string;
  images: { data: string; mimeType: string }[]; // base64 (no data: prefix)
  /** 既存顧客の name 一覧（任意）。スクショの呼び名と部分一致する候補を返すために使う */
  knownCustomers?: { id: string; name: string; nameKana?: string }[];
}

export interface CustomerContextExtracted {
  /** スクショ中の相手の呼び名（推測）。なければ null */
  nameHint: string | null;
  /** 会話全体の温度感 */
  mood: 'positive' | 'neutral' | 'negative' | null;
  /** 話題 */
  topics: string[];
  /** 好きそうなもの */
  likes: string[];
  /** 嫌いそうなもの / 避けるべきもの */
  dislikes: string[];
  /** 性格トレイト（例: '甘えたい' '褒められ好き'） */
  personalityTraits: string[];
  /** 興味分野 */
  interests: string[];
  /** 刺さりそうな話題 */
  triggerPositive: string[];
  /** 避けるべき話題 */
  triggerNegative: string[];
  /** コミュニケーション様式（短文・絵文字多め 等の自由記述） */
  communicationStyle: string | null;
  /** 重要メモ（誕生日近い / 仕事忙しい 等） */
  importantMemo: string | null;
  /** 次のアクション提案 */
  suggestedNextAction: string | null;
  /** 次回来店日のヒント（"来週金曜" などの自然文）。Timestamp 推定はしない */
  nextVisitHint: string | null;
}

interface ExtractResponse {
  hasContent: boolean;
  extracted: CustomerContextExtracted;
  /** knownCustomers から名前で部分一致した候補（複数あり得る） */
  matchedCustomerIds: string[];
  notes: string | null;
  /** 残りクレジット数（API 呼び出し後） */
  creditsRemaining: number;
}

const EXTRACT_SYSTEM_INSTRUCTION = `あなたはホスト/キャバクラ業界のチャット解析 AI です。
ユーザーが投稿した LINE / DM のスクショから「相手（顧客）」の情報を読み取って、
JSON で構造化してください。

抽出ルール:
- スクショの相手側発言を主な手がかりにし、自分側発言は補助情報として使う
- 確信が低い項目は null / 空配列で返す（捏造禁止）
- 本名は推測しない。「呼び名」「源氏名」「ニックネーム」までに留める
- mood は会話の温度感を 1 値（positive / neutral / negative / null）で
- 効果数値・売上額の捏造は禁止
- 「次回来店日」は自然文ヒントのみ（"来週金曜" "誕生日来月" 等）

必ず厳密な JSON のみを返し、フィールドは以下の通り:
{
  "nameHint": string | null,
  "mood": "positive" | "neutral" | "negative" | null,
  "topics": string[],
  "likes": string[],
  "dislikes": string[],
  "personalityTraits": string[],
  "interests": string[],
  "triggerPositive": string[],
  "triggerNegative": string[],
  "communicationStyle": string | null,
  "importantMemo": string | null,
  "suggestedNextAction": string | null,
  "nextVisitHint": string | null,
  "notes": string | null
}

データが顧客との会話と判定できない（看板・商品写真・自分のプロフィール等）場合は、
すべて null / 空配列を返してください。`;

function isPlausibleCustomerContent(e: CustomerContextExtracted): boolean {
  // 1 つでも非空のフィールドがあれば「中身あり」扱い
  return !!(
    e.nameHint ||
    e.mood ||
    e.topics.length ||
    e.likes.length ||
    e.dislikes.length ||
    e.personalityTraits.length ||
    e.interests.length ||
    e.triggerPositive.length ||
    e.triggerNegative.length ||
    e.communicationStyle ||
    e.importantMemo ||
    e.suggestedNextAction ||
    e.nextVisitHint
  );
}

function matchKnownCustomers(
  nameHint: string | null,
  known: { id: string; name: string; nameKana?: string }[] | undefined,
): string[] {
  if (!nameHint || !known || known.length === 0) return [];
  const hint = nameHint.trim();
  if (!hint) return [];
  return known
    .filter((c) => {
      if (!c.name) return false;
      // 完全一致 / 部分一致 / かな一致
      return (
        c.name === hint ||
        c.name.includes(hint) ||
        hint.includes(c.name) ||
        (c.nameKana && (c.nameKana === hint || c.nameKana.includes(hint)))
      );
    })
    .map((c) => c.id)
    .slice(0, 5); // 多すぎても UX 悪いので 5 まで
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json()) as ExtractRequestBody;
    const { workspaceId, images, knownCustomers } = body;
    if (!workspaceId || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: '画像が指定されていません' }, { status: 400 });
    }
    if (images.length > 4) {
      return NextResponse.json({ error: '画像は 4 枚までです' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    // 画像枚数比例でクレジット見積もり（顧客コンテキスト抽出は featureMultiplier 1.5）
    const cost = estimateAiCost({
      inputText: '',
      imageCount: images.length,
      expectedOutputTokens: 1200,
      featureMultiplier: 1.5,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      const raw = await analyzeImages(images, 'スクショから抽出してください。', {
        systemInstruction: EXTRACT_SYSTEM_INSTRUCTION,
        maxOutputTokens: 1200,
        temperature: 0.25,
        responseMimeType: 'application/json',
      });

      type RawParsed = Partial<CustomerContextExtracted> & { notes?: string | null };
      let parsedRaw: RawParsed = {};
      try {
        parsedRaw = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsedRaw = JSON.parse(m[0]);
          } catch {
            /* noop */
          }
        }
      }

      // 配列フィールドの正規化（モデルが文字列で返した時のリカバリ）
      const arrayOrEmpty = (v: unknown): string[] => {
        if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim().length > 0);
        if (typeof v === 'string' && v.trim()) return v.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);
        return [];
      };

      const extracted: CustomerContextExtracted = {
        nameHint: typeof parsedRaw.nameHint === 'string' && parsedRaw.nameHint.trim() ? parsedRaw.nameHint.trim() : null,
        mood: parsedRaw.mood === 'positive' || parsedRaw.mood === 'neutral' || parsedRaw.mood === 'negative' ? parsedRaw.mood : null,
        topics: arrayOrEmpty(parsedRaw.topics),
        likes: arrayOrEmpty(parsedRaw.likes),
        dislikes: arrayOrEmpty(parsedRaw.dislikes),
        personalityTraits: arrayOrEmpty(parsedRaw.personalityTraits),
        interests: arrayOrEmpty(parsedRaw.interests),
        triggerPositive: arrayOrEmpty(parsedRaw.triggerPositive),
        triggerNegative: arrayOrEmpty(parsedRaw.triggerNegative),
        communicationStyle: typeof parsedRaw.communicationStyle === 'string' && parsedRaw.communicationStyle.trim() ? parsedRaw.communicationStyle.trim() : null,
        importantMemo: typeof parsedRaw.importantMemo === 'string' && parsedRaw.importantMemo.trim() ? parsedRaw.importantMemo.trim() : null,
        suggestedNextAction: typeof parsedRaw.suggestedNextAction === 'string' && parsedRaw.suggestedNextAction.trim() ? parsedRaw.suggestedNextAction.trim() : null,
        nextVisitHint: typeof parsedRaw.nextVisitHint === 'string' && parsedRaw.nextVisitHint.trim() ? parsedRaw.nextVisitHint.trim() : null,
      };

      const response: ExtractResponse = {
        hasContent: isPlausibleCustomerContent(extracted),
        extracted,
        matchedCustomerIds: matchKnownCustomers(extracted.nameHint, knownCustomers),
        notes: typeof parsedRaw.notes === 'string' ? parsedRaw.notes : null,
        creditsRemaining: remaining,
      };

      ack();
      return NextResponse.json(response);
    }, 'customer-context-extract');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('customer-context-extract failed:', error);
    return NextResponse.json({ error: '抽出に失敗しました' }, { status: 500 });
  }
}
