// 記録エンジン段 7 の取り消し（P152）。
//
// **控えに載っているものだけを引く。** 「直前の状態に戻す」ではない
// （間に人が手で足した項目まで巻き戻り、**人が意図的に消した項目が復活する**）。
//
// ## token を必須にする理由（yorulog の指摘・2026-08-25）
//
// 店に owner が複数いると、こういう順番が起きる:
//   A が適用 → B が別のパックを適用 → **A の画面にはまだ「元に戻す」が残っている**
//
// 控えは 1 世代・単一 doc なので、A がそのまま押すと**B の適用が取り消される**。
// そこで `revert` は**適用時に返した token を要求し、保存されている控えの token と
// 一致しなければ拒否する**。押した人が意図した変更だけを取り消せる。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { parseRecordSchema } from '@/lib/record-engine/record-schema';
import { revertRulePack, parseStoredDerivations, parseReceipt } from '@/lib/record-engine/rule-pack';
import {
  getAdminDb, pathRecordSchema, pathRecordSchemaReceipt, canEditRecordEngine,
} from '../lib';
import { stampIrVersion } from '@/lib/ir-version';
import { FieldValue } from 'firebase-admin/firestore';

interface RevertBody {
  workspaceId: string;
  /** 適用時に受け取った token。**必須**（他人の適用を取り消さないため） */
  token?: string;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as RevertBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    if (typeof body.token !== 'string' || !body.token) {
      return NextResponse.json({ error: 'token が必要です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, body.workspaceId);
    if (!canEditRecordEngine(ctx)) {
      return NextResponse.json({ error: '記録の仕組みの変更はオーナー専用です' }, { status: 403 });
    }

    const db = getAdminDb();
    const schemaRef = db.doc(pathRecordSchema(ctx));
    const receiptRef = db.doc(pathRecordSchemaReceipt(ctx));

    const result = await db.runTransaction(async (tx) => {
      const [schemaSnap, receiptSnap] = await Promise.all([tx.get(schemaRef), tx.get(receiptRef)]);
      const receipt = parseReceipt(receiptSnap.exists ? receiptSnap.data() : null);
      if (!receipt) {
        return { ok: false as const, status: 409 as const, error: '取り消せる変更がありません' };
      }
      if (receipt.token !== body.token) {
        // 押した人が見ている変更と、いま保存されている変更が違う
        return {
          ok: false as const,
          status: 409 as const,
          error: '別の変更が適用されているため取り消せません',
        };
      }

      const data = schemaSnap.exists ? schemaSnap.data() ?? {} : {};
      const { schema: current } = parseRecordSchema(data);
      const { derivations: currentDerivations } = parseStoredDerivations(data.derivations);
      const reverted = revertRulePack(current, currentDerivations, receipt);

      const patch = {
        fields: reverted.schema.fields,
        derivations: reverted.derivations,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      };
      // 段 2: 既存 doc を全置換しない（別クライアントが足した未知キーを消さない）。
      // 取り消しは必ず「適用済みの doc」に対して行うので、実際にはこちらの枝だけを通る
      if (schemaSnap.exists) tx.set(schemaRef, patch, { merge: true });
      else tx.set(schemaRef, stampIrVersion(patch));
      // 取り消したら控えは消す。**残すと二度押しで「既に削除されていました」だけが並ぶ**
      tx.delete(receiptRef);
      return { ok: true as const, reverted };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      schema: { fields: result.reverted.schema.fields },
      derivations: result.reverted.derivations,
      removed: result.reverted.removed,
      // 引かなかったものは理由付きで返す。**画面に出す**
      // （「元に戻したのに残っている」が説明なしだと、それはそれで不信になる）
      skipped: result.reverted.skipped,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('record-engine/revert failed:', error);
    return NextResponse.json({ error: '取り消しに失敗しました' }, { status: 500 });
  }
}
