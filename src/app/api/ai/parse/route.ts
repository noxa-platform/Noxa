import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../with-credits';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';

const MAX_BYTES = 16 * 1024; // 短い発話想定。16KB 上限。

/**
 * 自然言語クイック入力のクラウド解析（オンデバイス Foundation Models の
 * フォールバック）。非 iOS26 端末・Android Web 等、端末LLMが使えない環境向け。
 *
 * 入力: { workspaceId, text }
 * 出力(JSON): { kind, customerName, amount, groupCount, withDouhan, withAfter, whenText, place, memo }
 *   - kind: "visitLog" | "standaloneSale" | "reminder" | "unknown"
 *   - 金額計算・日付確定はしない（whenText は表現のまま。amount は数値抽出のみ）
 *
 * iOS の ParsedEntryData と同一スキーマ。
 */
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const workspaceId: string | undefined = body?.workspaceId;
    const text: string | undefined = body?.text;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'text は必須です' }, { status: 400 });
    }
    if (new TextEncoder().encode(text).length > MAX_BYTES) {
      return NextResponse.json({ error: '本文が大きすぎます' }, { status: 413 });
    }

    await resolveAccessContext(uid, workspaceId);

    // 短文解析なので低コスト固定見積り
    const cost = estimateAiCost({
      inputText: text,
      expectedOutputTokens: 200,
      featureMultiplier: 0.5,
      maxCap: 2,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      const raw = await generateText(
        `## 発話\n${text}\n\n上記の発話を解析し、下記スキーマの JSON のみを返してください（前後の説明文やコードフェンスは禁止）。`,
        {
          systemInstruction: `あなたは夜職（ホスト/キャバ等）向け顧客管理アプリの入力アシスタントです。
ユーザーの短い発話を、売上記録・顧客なし日売・予定のいずれかに構造化します。
金額の計算や日付の確定はしません（日時は表現のまま whenText に入れる。amount は数値のみ）。

必ず次の JSON だけを返す（説明・コードフェンス禁止）:
{
  "kind": "visitLog" | "standaloneSale" | "reminder" | "unknown",
  "customerName": string,   // 無ければ ""
  "amount": number,         // 円。「3万」は30000。無ければ0
  "groupCount": number,     // 組数。無ければ0
  "withDouhan": boolean,
  "withAfter": boolean,
  "whenText": string,       // 日時の自然言語そのまま 例「明日19時」。無ければ ""
  "place": string,          // 無ければ ""
  "memo": string            // 無ければ ""
}

判定の目安:
- 顧客名があり過去/当日の来店・売上 → visitLog
- 顧客名なし＋組数や「フリー/日売」 → standaloneSale
- 「明日/今度/予定/約束」等の未来 → reminder
- 判別不能 → unknown`,
          responseMimeType: 'application/json',
        },
      );

      ack();

      let parsed: Record<string, unknown> = {};
      try {
        const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { kind: 'unknown', customerName: '', amount: 0, groupCount: 0, withDouhan: false, withAfter: false, whenText: '', place: '', memo: '' };
      }

      // 正規化（型を保証）
      const result = {
        kind: ['visitLog', 'standaloneSale', 'reminder'].includes(String(parsed.kind)) ? parsed.kind : 'unknown',
        customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
        amount: Number.isFinite(Number(parsed.amount)) ? Math.trunc(Number(parsed.amount)) : 0,
        groupCount: Number.isFinite(Number(parsed.groupCount)) ? Math.trunc(Number(parsed.groupCount)) : 0,
        withDouhan: parsed.withDouhan === true,
        withAfter: parsed.withAfter === true,
        whenText: typeof parsed.whenText === 'string' ? parsed.whenText : '',
        place: typeof parsed.place === 'string' ? parsed.place : '',
        memo: typeof parsed.memo === 'string' ? parsed.memo : '',
      };

      return NextResponse.json({ ...result, creditsRemaining: remaining });
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error('[api/ai/parse] error:', e);
    return NextResponse.json({ error: '解析に失敗しました' }, { status: 500 });
  }
}
