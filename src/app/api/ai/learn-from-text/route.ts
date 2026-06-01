// 顧客カルテへのテキスト学習 API。
//
// 顧客個別ページの「学習」モードから呼ばれる。LINE トーク履歴をテキスト書き出しした
// もの、または自分の過去の文面などを受け取って、相手の特徴 + 自分の文体を JSON 抽出し、
// 該当顧客の customer doc に patch を書き戻す。
//
// クレジット消費:
//   - estimateAiCost で文字数に応じて算出（上限なし、最小 1cr）
//   - reserveAiCredit で予約 → 失敗時 refund
//
// 安全:
//   - 入力テキストはデータ扱い（gemini.ts の prompt-injection guard が共通注入）
//   - 1MB 上限、最低 20 字
import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_BYTES = 1024 * 1024; // 1MB（日本語で約 33 万字相当）
const MIN_CHARS = 20;
const MIN_COST = 1;

interface LearnFromTextBody {
  workspaceId: string;
  customerId: string;
  content: string;
}

interface ExtractedFromText {
  customerPersonality: string | null;
  myMessageStyle: string | null;
  likes: string[];
  dislikes: string[];
  personalityTraits: string[];
  interests: string[];
  triggerPositive: string[];
  triggerNegative: string[];
  communicationStyle: string | null;
  importantMemo: string | null;
  suggestedNextAction: string | null;
}

const EXTRACT_SYSTEM = `あなたはホスト/キャスト向けのチャット解析 AI です。
提供されたテキスト（LINE トーク履歴・メッセージ書き出し等）から、対象の顧客との
やり取りを読み取って以下を JSON 抽出してください。

抽出ルール:
- 相手（顧客）の発言と、自分側の発言を区別する。自分側からは「文体（trends）」を、
  相手側からは「性格・好み・感情シグナル」を読む
- 確信が低い項目は null / 空配列で返す（捏造禁止）
- 本名・電話番号・住所の推測は禁止（呼び名のみ可、ただし本 API ではプロファイル
  更新には反映しない）
- 効果数値・売上額の捏造禁止
- 配列は最大 8 個程度に絞る

必ず厳密な JSON のみで返答。フィールド:
{
  "customerPersonality": string | null,    // 相手の人物像を 80 字以内
  "myMessageStyle": string | null,         // 自分側の文体を 80 字以内
  "likes": string[],
  "dislikes": string[],
  "personalityTraits": string[],
  "interests": string[],
  "triggerPositive": string[],
  "triggerNegative": string[],
  "communicationStyle": string | null,     // 短文/絵文字多めなど
  "importantMemo": string | null,          // 来店予定・誕生日近い等
  "suggestedNextAction": string | null
}`;

function arrayOrEmpty(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim().length > 0).slice(0, 10);
  if (typeof v === 'string' && v.trim()) return v.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  return [];
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function mergeUnique(existing: string[] | undefined, additions: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...additions])).filter(Boolean);
}

export async function POST(request: NextRequest) {
  let cost = MIN_COST;
  let uid: string | null = null;
  try {
    uid = await verifyRequest(request);
    const body = (await request.json()) as LearnFromTextBody;
    const { workspaceId, customerId, content } = body;
    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'workspaceId / customerId が必要です' }, { status: 400 });
    }
    if (typeof content !== 'string' || content.trim().length < MIN_CHARS) {
      return NextResponse.json({ error: `本文は ${MIN_CHARS} 文字以上必要です` }, { status: 400 });
    }
    const byteLength = new TextEncoder().encode(content).length;
    if (byteLength > MAX_BYTES) {
      return NextResponse.json({ error: '本文が大きすぎます（最大 1MB）' }, { status: 413 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // テキスト量に応じてクレジット見積もり（UI 表示と完全一致、上限なし）
    cost = estimateAiCost({
      inputText: content,
      expectedOutputTokens: 1500,
      featureMultiplier: 1.2,
      maxCap: Number.POSITIVE_INFINITY,
    });
    const reserved = await reserveAiCredit(uid, cost);
    if (!reserved.ok) {
      return NextResponse.json(
        { error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: cost },
        { status: 429 },
      );
    }

    let raw: string;
    try {
      raw = await generateText(
        `## 解析対象テキスト\n${content}\n\n上記の会話履歴を解析して JSON で抽出してください。`,
        {
          systemInstruction: EXTRACT_SYSTEM,
          maxOutputTokens: 1500,
          temperature: 0.25,
          responseMimeType: 'application/json',
        },
      );
    } catch (e) {
      await refundAiCredit(uid, cost);
      throw e;
    }
    void logAiLedger(uid, 'learn-from-text', cost);

    // safe parse
    type RawParsed = Partial<ExtractedFromText>;
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

    const extracted: ExtractedFromText = {
      customerPersonality: strOrNull(parsedRaw.customerPersonality),
      myMessageStyle: strOrNull(parsedRaw.myMessageStyle),
      likes: arrayOrEmpty(parsedRaw.likes),
      dislikes: arrayOrEmpty(parsedRaw.dislikes),
      personalityTraits: arrayOrEmpty(parsedRaw.personalityTraits),
      interests: arrayOrEmpty(parsedRaw.interests),
      triggerPositive: arrayOrEmpty(parsedRaw.triggerPositive),
      triggerNegative: arrayOrEmpty(parsedRaw.triggerNegative),
      communicationStyle: strOrNull(parsedRaw.communicationStyle),
      importantMemo: strOrNull(parsedRaw.importantMemo),
      suggestedNextAction: strOrNull(parsedRaw.suggestedNextAction),
    };

    // 既存 customer ドキュメントとマージして書き戻す
    const db = getAdminDb();
    const ref = db.doc(`shop_shops/${workspaceId}/customers/${customerId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      await refundAiCredit(uid, cost);
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }
    const cur = snap.data() ?? {};

    // SEC-M4: 自由テキストフィールドの prompt injection 経由汚染を抑止するため、
    // AI 抽出値には [AI] プレフィックスと文字数上限を付ける。ユーザーが書いた値と
    // 機械生成値を識別可能にし、悪意あるテキスト混入を緩和する。
    const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
    const aiTag = `[AI ${new Date().toISOString().slice(0, 10)}]`;

    const patch: Record<string, unknown> = {
      chatAnalyzedAt: FieldValue.serverTimestamp(),
    };
    if (extracted.customerPersonality) {
      patch.customerPersonality = `${aiTag} ${truncate(extracted.customerPersonality, 300)}`;
    }
    if (extracted.myMessageStyle) {
      patch.myMessageStyle = `${aiTag} ${truncate(extracted.myMessageStyle, 300)}`;
    }
    if (extracted.likes.length) patch.likes = mergeUnique(cur.likes as string[] | undefined, extracted.likes);
    if (extracted.dislikes.length) patch.dislikes = mergeUnique(cur.dislikes as string[] | undefined, extracted.dislikes);
    if (extracted.personalityTraits.length) patch.personalityTraits = mergeUnique(cur.personalityTraits as string[] | undefined, extracted.personalityTraits);
    if (extracted.interests.length) patch.interests = mergeUnique(cur.interests as string[] | undefined, extracted.interests);
    if (extracted.triggerPositive.length) patch.triggerPositive = mergeUnique(cur.triggerPositive as string[] | undefined, extracted.triggerPositive);
    if (extracted.triggerNegative.length) patch.triggerNegative = mergeUnique(cur.triggerNegative as string[] | undefined, extracted.triggerNegative);
    if (extracted.communicationStyle) {
      patch.communicationStyle = `${aiTag} ${truncate(extracted.communicationStyle, 200)}`;
    }
    if (extracted.importantMemo) {
      const prev = (cur.importantMemo as string | undefined)?.trim();
      const tagged = `${aiTag} ${truncate(extracted.importantMemo, 300)}`;
      patch.importantMemo = prev ? `${prev}\n${tagged}` : tagged;
    }
    if (extracted.suggestedNextAction) {
      patch.nextAction = truncate(extracted.suggestedNextAction, 200);
    }

    await ref.update(patch);

    return NextResponse.json({
      ok: true,
      consumedCredits: cost,
      remainingCredits: reserved.remaining,
      extracted,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    if (uid) {
      // ネットワーク失敗時など、try 内 refund に乗らないケースの保険
      try {
        await refundAiCredit(uid, cost);
      } catch {
        /* noop */
      }
    }
    console.error('learn-from-text failed:', error);
    return NextResponse.json({ error: 'テキスト学習に失敗しました' }, { status: 500 });
  }
}
