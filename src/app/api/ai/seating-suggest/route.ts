// AI 席回し（M5・Web 初の AI 配線）。
//
// 席回し画面から現在の盤面（卓×キャスト）と自由要望テキストを受け取り、
// 「理由つきの配置提案」を JSON で返す。既存の AI 基盤（認証 verifyRequest +
// resolveAccessContext の店舗メンバー確認 + withReservedCredits のクレジット予約）に載せる。
//
// 提案はサーバでは適用しない（読み取り専用）。適用はクライアントの既存
// トランザクション（assignCast / rotateHosts）経由なので、権限は Firestore rules が守る。
// クライアント側でも sanitizeAiPlan（純ロジック）で制約違反（ロック/除外/BOSS/
// 本指名引き剥がし）を落とすハイブリッド構成。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { generateText } from '../ai-provider';
import { withReservedCredits } from '../with-credits';
import { estimateAiCost } from '@/lib/ai-cost';

interface BoardTable {
  id: string; name: string; type: string; status: string;
  guests: number; elapsedMin: number;
  currentHosts: { id: string; name: string; rank: string; main: boolean; sinceMin: number }[];
  requested: string[]; // 指名待ちキャスト名
  excluded: string[];  // この卓で回さないキャスト名
}
interface BoardCast {
  id: string; name: string; rank: string; status: string; isLocked: boolean;
  ngWith?: string[]; // NG 組合せ（同卓に付けない相手の名前）
}
interface SuggestRequestBody {
  workspaceId: string;
  requestText?: string; // 自由要望（空なら設定ベースの総合提案）
  settings?: { rotationTimeLength?: number; setTimeLength?: number };
  tables: BoardTable[];
  casts: BoardCast[];
}

interface SuggestResponse {
  proposals: { tableId: string; action: 'assign' | 'rotate'; castIds: string[]; reason: string }[];
  note?: string;
}

const SYSTEM_INSTRUCTION = `あなたはナイトワーク店舗の席回し（フロア采配）マネージャです。
現在の盤面（卓とキャストの状態）と店舗の要望から、配置提案を返してください。

絶対制約（違反した提案は破棄されます）:
- ロック中(isLocked)・欠勤(Absent)・BOSS のキャストは配置しない
- 各卓の excluded（回さない指定）に入っているキャストはその卓に配置しない
- 他の卓で本指名(main)として付いているキャストを引き剥がさない
- ngWith（NG組合せ）に載っている相手と同じ卓に付けない
- 1人のキャストは同時に1卓のみ。既にその卓に居るキャストを再提案しない

方針:
- 指名待ち(requested)のキャストを最優先でその卓へ
- 初回卓は役職×新人ペアが理想（新人育成）。新人同士のペアは避ける
- 長時間同じ席のキャストはローテーション(action=rotate)を提案
- 提案は最大5件。効果が大きい順

必ず厳密な JSON のみで返答:
{
  "proposals": [
    { "tableId": "卓ID", "action": "assign" | "rotate", "castIds": ["キャストID"], "reason": "採用理由（40字以内・現場がすぐ動ける言葉で）" }
  ],
  "note": "全体コメント（60字以内・任意）"
}
- assign: castIds のキャストをその卓へ配置 / rotate: その卓の席内ローテ実行（castIds は []）
- tableId / castIds は盤面データの id をそのまま使う（名前ではなく id）`;

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as SuggestRequestBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    if (!Array.isArray(body.tables) || !Array.isArray(body.casts)) {
      return NextResponse.json({ error: '盤面データ（tables/casts）が必要です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, body.workspaceId);
    if (ctx.kind !== 'shop') {
      return NextResponse.json({ error: '席回しは店舗ワークスペース専用です' }, { status: 400 });
    }

    // 盤面はクライアントの購読データを信頼する（提案の材料であり書込はしない）。
    // ただしサイズ暴走だけは弾く
    if (body.tables.length > 60 || body.casts.length > 200) {
      return NextResponse.json({ error: '盤面データが大きすぎます' }, { status: 400 });
    }

    // settings は既知の数値のみ通す（任意 object をそのままプロンプトへ入れない）
    const setLen = Number(body.settings?.setTimeLength);
    const rotLen = Number(body.settings?.rotationTimeLength);
    const settings = {
      ...(Number.isFinite(setLen) && setLen > 0 ? { setTimeLength: setLen } : {}),
      ...(Number.isFinite(rotLen) && rotLen > 0 ? { rotationTimeLength: rotLen } : {}),
    };
    const boardText = JSON.stringify({ tables: body.tables, casts: body.casts, settings });
    const requestText = (body.requestText ?? '').slice(0, 500);
    const userPrompt = `# 現在の盤面\n${boardText}\n\n# 店舗の要望\n${requestText || '（特になし。盤面全体を見て最適な回しを提案してください）'}\n\n上記から配置提案を JSON で返してください。`;

    const cost = estimateAiCost({
      inputText: userPrompt,
      expectedOutputTokens: 700,
      featureMultiplier: 0.5,
      maxCap: 3,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      const raw = await generateText(userPrompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 700,
        temperature: 0.5,
        responseMimeType: 'application/json',
      });

      let parsed: SuggestResponse | null = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
      }
      if (!parsed || typeof parsed !== 'object') {
        // 生成物が不正 JSON で提案が取り出せない＝生成失敗。ack せず return し
        // withReservedCredits に予約分を返金させる（insights/briefing/message と同じ Day67 refund 契約）。
        // 旧実装はこの経路でも ack して 200＋空 proposals を返し、失敗を成功に見せかけつつ課金していた。
        return NextResponse.json({ error: 'AI提案の生成に失敗しました' }, { status: 500 });
      }
      if (!Array.isArray(parsed.proposals)) parsed = { proposals: [], note: parsed.note };

      ack(); // 生成成功＝消費確定
      return NextResponse.json({ ...parsed, creditsRemaining: remaining });
    }, 'seating-suggest');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('seating-suggest failed:', error);
    return NextResponse.json({ error: 'AI提案の生成に失敗しました' }, { status: 500 });
  }
}
