// 投稿画像から「自分のプロファイル / 店舗プロファイル」候補を抽出する API。
//
// ユースケース:
//   - 自分の名刺 / 出勤情報 / SNS スクショ から 源氏名・職業・店舗名・業種を読む
//   - 店舗の看板 / メニュー / 求人ページから 店舗業種・営業時間・住所を読む
//
// 安全側の挙動:
//   - 確信度が低い項目は null で返す（呼び出し側が空表示）
//   - 第三者個人情報（他の従業員の本名・連絡先）は抽出対象外と明示
//   - 抽出結果はそのまま保存しない。クライアントが「更新しますか？」ダイアログで
//     確認させてから saveSelfBaseStyle / updateWorkspace を呼ぶ。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { analyzeImages } from '../ai-provider';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../with-credits';

interface ExtractRequestBody {
  workspaceId: string;
  images: { data: string; mimeType: string }[]; // base64 (no data: prefix)
}

interface ExtractedProfile {
  // 自分プロファイル候補
  stageName?: string | null;
  staffRole?: string | null;
  gender?: 'female' | 'male' | 'other' | null;
  // 自分の文体候補（自分側発言のスクショから推定）
  firstPerson?: string | null;
  defaultTone?: string | null;
  emojiLevel?: 'none' | 'low' | 'mid' | 'high' | null;
  avgLength?: number | null;
  signaturePhrases?: string[] | null;
  // 店舗プロファイル候補
  storeName?: string | null;
  storeTypeName?: string | null;
  address?: string | null;
  businessHours?: string | null;
  phoneNumber?: string | null;
  // 補助
  notes?: string | null; // 抽出 AI から人間向けメモ
}

const EXTRACT_SYSTEM_INSTRUCTION = `あなたはホスト/キャバクラ業界のプロフィール情報抽出 AI です。
ユーザーが投稿した画像（名刺・SNS スクショ・出勤表・店舗看板・自分の LINE 送信履歴
など）から、以下のグループに分けて項目をできる範囲で抽出してください。

【1. 自分自身のプロフィール】源氏名・職業・性別
【2. 自分の文体】LINE / DM スクショ等で「自分側の発言」がある場合のみ推定
   - firstPerson: 自分が使う一人称（あたし / 私 / 俺 / うち / 僕 等。自由入力）
   - defaultTone: 基本トーン（例: "カジュアル敬語ベース" "タメ口寄り"
     "甘え系" "クール系" 等を短い自由文で）
   - emojiLevel: 絵文字頻度（"none" / "low" / "mid" / "high"）
   - avgLength: 自分側発言の平均文字数（整数）
   - signaturePhrases: よく使う言い回しを最大 5 個（"〜だよん" "おつかれ〜"等）
【3. 店舗プロフィール】店名・業種・住所・営業時間・電話番号

抽出ルール:
- 他人の個人情報（他キャスト・顧客の本名・連絡先）は絶対に抽出しない
- 確信が低い項目は null を返す（無理に埋めない）
- 数値推定や根拠なしの推測は禁止（avgLength は実際に見えた発言から計算）
- 業種は自由文（例: 「中小キャバ」「コンセプトホスト」「メンズコンカフェ」「セクキャバ」「ガールズバー」など）
- 文体推定は「自分側発言（LINE 右側 / 出力側）」を主な手がかりにする
- 自分の発言が画像に無ければ文体系はすべて null / 空配列

性別の判定基準:
- "female"  女性スタッフ・女性源氏名・キャバ嬢など
- "male"    男性スタッフ・男性源氏名・ホストなど
- "other"   どちらでもない、または判定不能

必ず厳密な JSON のみを返し、フィールドは以下の通り:
{
  "stageName": string | null,
  "staffRole": string | null,
  "gender": "female" | "male" | "other" | null,
  "firstPerson": string | null,
  "defaultTone": string | null,
  "emojiLevel": "none" | "low" | "mid" | "high" | null,
  "avgLength": number | null,
  "signaturePhrases": string[] | null,
  "storeName": string | null,
  "storeTypeName": string | null,
  "address": string | null,
  "businessHours": string | null,
  "phoneNumber": string | null,
  "notes": string | null
}`;

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json()) as ExtractRequestBody;
    const { workspaceId, images } = body;
    if (!workspaceId || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: '画像が指定されていません' }, { status: 400 });
    }
    if (images.length > 4) {
      return NextResponse.json({ error: '画像は 4 枚までです' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    // 画像枚数比例でクレジット見積もり（プロファイル抽出は featureMultiplier 1.5）
    const cost = estimateAiCost({
      inputText: '',
      imageCount: images.length,
      expectedOutputTokens: 800,
      featureMultiplier: 1.5,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      const raw = await analyzeImages(images, '画像から抽出してください。', {
        systemInstruction: EXTRACT_SYSTEM_INSTRUCTION,
        maxOutputTokens: 800,
        temperature: 0.2,
        responseMimeType: 'application/json',
      });

      // モデルからの JSON をパース。整形ミスがある可能性に備えて safe parse。
      let parsed: ExtractedProfile = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 末尾のテキストや fences を含む場合のリカバリ
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            /* noop */
          }
        }
      }

      ack();
      return NextResponse.json({ extracted: parsed, creditsRemaining: remaining });
    }, 'profile-extract');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('profile-extract failed:', error);
    return NextResponse.json({ error: '抽出に失敗しました' }, { status: 500 });
  }
}
