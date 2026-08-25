// 記録エンジン段 7 の適用（P152）。
//
// 人が差分プレビューでチェックしたものだけを適用し、**取り消し用の控えを保存する**。
// AI は関与しない（生成は `/api/ai/rule-pack`）。ここは**人の操作**なのでサーバが書く。
//
// ## 2 つの守り
//
// 1. **必ずトランザクション**。スキーマと控えが別々に成否が分かれると
//    「足したのに取り消せない」「足していないのに控えがある」が生まれる。
// 2. **現行スキーマはサーバで読み直す**。クライアントが送ってきた状態を土台にすると、
//    生成から適用までの間に**別の人が加えた変更を巻き戻す**（クライアントは古い姿を持っている）。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { parseRecordSchema } from '@/lib/record-engine/record-schema';
import {
  validateRulePack, applyRulePack, parseStoredDerivations,
} from '@/lib/record-engine/rule-pack';
import {
  getAdminDb, pathRecordSchema, pathRecordSchemaReceipt, canEditRecordEngine, makeReceiptToken,
} from '../lib';
import { stampIrVersion } from '@/lib/ir-version';
import { FieldValue } from 'firebase-admin/firestore';

interface ApplyBody {
  workspaceId: string;
  /** 適用したいパック（`/api/ai/rule-pack` の返り値の `pack`、または人が組んだもの） */
  pack?: unknown;
  /** チェックされたキー。**省略すると全部**（「全部適用」ボタン用） */
  selectedKeys?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as ApplyBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, body.workspaceId);
    if (!canEditRecordEngine(ctx)) {
      return NextResponse.json({ error: '記録の仕組みの変更はオーナー専用です' }, { status: 403 });
    }
    const selectedKeys = Array.isArray(body.selectedKeys)
      ? body.selectedKeys.filter((k): k is string => typeof k === 'string')
      : undefined;
    if (selectedKeys && selectedKeys.length === 0) {
      // 「1 つも選ばずに適用」を成功として返さない。押した人は何かが起きたと思う
      return NextResponse.json({ error: '適用する項目が選ばれていません' }, { status: 400 });
    }

    const db = getAdminDb();
    const schemaRef = db.doc(pathRecordSchema(ctx));
    const receiptRef = db.doc(pathRecordSchemaReceipt(ctx));
    const now = Date.now();
    const token = makeReceiptToken(now);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(schemaRef);
      const data = snap.exists ? snap.data() ?? {} : {};
      // **サーバで読み直した現行**を土台にする（クライアントの姿は使わない）
      const { schema: current } = parseRecordSchema(data);
      const { derivations: currentDerivations } = parseStoredDerivations(data.derivations);

      // 送られてきたパックも検証を通す。**生成 API を経由せず直接叩かれても、
      // 壊れた式や不正なキーは入らない**（route ごとに守りを重ねる）
      const validated = validateRulePack(body.pack, current, currentDerivations.map((d) => d.key));
      if (validated.accepted === 0) {
        return { ok: false as const, rejected: validated.rejected };
      }

      const applied = applyRulePack(current, currentDerivations, validated.pack, { token, now, selectedKeys });
      if (applied.receipt.fields.length === 0 && applied.receipt.derivations.length === 0) {
        // 選ばれたものが全部「適用時点で既にあった」場合。**控えを空で保存しない**
        // （空の控えが残ると、次の取り消しが何も引かずに成功したように見える）
        return { ok: false as const, rejected: [...validated.rejected, ...applied.skipped] };
      }

      const patch = {
        fields: applied.schema.fields,
        derivations: applied.derivations,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      };
      // ⚠️ **既存 doc を全置換しない**（記録エンジン段 2「未知キーの保持」）。
      // 別クライアントがスキーマ doc に足した項目（将来の `constraints` 等）を、
      // こちらの書き込みで黙って消してしまう。既存があれば merge で更新する。
      // 新規作成のときだけ版を刻む（段 3。更新で刻むと版が巻き戻る）
      if (snap.exists) tx.set(schemaRef, patch, { merge: true });
      else tx.set(schemaRef, stampIrVersion(patch));
      // 控えは**上書き**（1 世代）。前の控えは取り消せなくなるが、UI の想定が
      // 「適用直後、その画面を閉じるまで」なのでこれで足りる
      tx.set(receiptRef, stampIrVersion({
        token: applied.receipt.token,
        appliedAt: applied.receipt.appliedAt,
        appliedBy: uid,
        fields: applied.receipt.fields,
        derivations: applied.receipt.derivations,
      }));
      return { ok: true as const, applied, rejected: validated.rejected };
    });

    if (!result.ok) {
      return NextResponse.json({
        error: '適用できる項目がありませんでした',
        rejected: result.rejected,
      }, { status: 409 });
    }

    return NextResponse.json({
      // iOS はこの token を握っておき、取り消しに添える（他人の適用を消さないため）
      token: result.applied.receipt.token,
      schema: { fields: result.applied.schema.fields },
      derivations: result.applied.derivations,
      applied: {
        fields: result.applied.receipt.fields.map((f) => f.key),
        derivations: result.applied.receipt.derivations.map((d) => d.key),
      },
      skipped: result.applied.skipped,
      rejected: result.rejected,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('record-engine/apply failed:', error);
    return NextResponse.json({ error: '適用に失敗しました' }, { status: 500 });
  }
}
