// 自分の紹介コードを取得する API。未発行なら発行する（冪等）。
//
// Firestore 構造（v2: reward_referral_*。rules / 退会・統合処理と整合）:
//   reward_referral_codes/{code} { ownerUid, createdAt, usedCount }
//   reward_referral_owners/{uid} { code }   ← 逆引き（uid → code）
// 旧 crm_referral_* に既存コードがある場合は読み取りのみフォールバックして救済する。
//
// 発行アルゴリズム: 8 文字英数字。衝突時は最大 5 回リトライ。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { stampIrVersion } from '@/lib/ir-version';

const CODE_LENGTH = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I/l などの紛らわしい文字を除外

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const db = getAdminDb();
    const ownerRef = db.doc(`reward_referral_owners/${uid}`);

    // 既発行: v2 → なければ旧 crm_ を読みフォールバック（既存コードを救済）
    let ownerSnap = await ownerRef.get();
    let legacy = false;
    if (!(ownerSnap.exists && ownerSnap.data()?.code)) {
      const legacySnap = await db.doc(`crm_referral_owners/${uid}`).get();
      if (legacySnap.exists && legacySnap.data()?.code) { ownerSnap = legacySnap; legacy = true; }
    }
    if (ownerSnap.exists && ownerSnap.data()?.code) {
      const code = ownerSnap.data()!.code as string;
      const codeSnap = await db.doc(`${legacy ? 'crm' : 'reward'}_referral_codes/${code}`).get();
      return NextResponse.json({
        code,
        usedCount: codeSnap.exists ? (codeSnap.data()?.usedCount ?? 0) : 0,
      });
    }

    // 未発行: 衝突しないコードを試行（v2 を確認）
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const existing = await db.doc(`reward_referral_codes/${code}`).get();
      if (!existing.exists) break;
      code = generateCode();
    }

    // 発行を tx で冪等化する。tx 内で ownerRef を読み直し、既にコードがあれば作らず
    // それを返す。これをしないと同一ユーザーの並行初回 GET が別々のコードを生成して
    // 二重発行され（1ユーザーに有効コードが複数・usedCount 分裂）、冪等性が壊れる。
    const issued = await db.runTransaction(async (tx) => {
      const ownerSnapTx = await tx.get(ownerRef);
      const existingCode = ownerSnapTx.exists ? (ownerSnapTx.data()?.code as string | undefined) : undefined;
      if (existingCode) return existingCode; // 並行発行済み＝それを採用（二重作成しない）
      const codeRef = db.doc(`reward_referral_codes/${code}`);
      const codeSnap = await tx.get(codeRef);
      if (codeSnap.exists) {
        // 万一の衝突。次回の GET で再試行されるよう例外を投げる
        throw new Error('CODE_COLLISION');
      }
      tx.create(codeRef, stampIrVersion({
        ownerUid: uid,
        createdAt: new Date(),
        usedCount: 0,
      }));
      tx.set(ownerRef, { code, updatedAt: new Date() }, { merge: true });
      return code;
    });

    // 採用コードの usedCount を返す（並行発行済みを拾った場合も正しい値を返す）
    const issuedSnap = await db.doc(`reward_referral_codes/${issued}`).get();
    return NextResponse.json({
      code: issued,
      usedCount: issuedSnap.exists ? (issuedSnap.data()?.usedCount ?? 0) : 0,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('referral code error:', error);
    return NextResponse.json({ error: '紹介コード取得に失敗しました' }, { status: 500 });
  }
}
