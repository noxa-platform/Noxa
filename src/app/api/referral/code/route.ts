// 自分の紹介コードを取得する API。未発行なら発行する（冪等）。
//
// Firestore 構造:
//   crm_referral_codes/{code} {
//     ownerUid: string,
//     createdAt: ServerTimestamp,
//     usedCount: number,  // 何人がこのコードで登録したか
//   }
//   crm_referral_owners/{uid} {
//     code: string,
//   }   ← 逆引き用（uid → code）
//
// 発行アルゴリズム: 8 文字英数字。衝突時は最大 5 回リトライ。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

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
    const ownerRef = db.doc(`crm_referral_owners/${uid}`);

    const ownerSnap = await ownerRef.get();
    if (ownerSnap.exists && ownerSnap.data()?.code) {
      const code = ownerSnap.data()!.code as string;
      const codeSnap = await db.doc(`crm_referral_codes/${code}`).get();
      return NextResponse.json({
        code,
        usedCount: codeSnap.exists ? (codeSnap.data()?.usedCount ?? 0) : 0,
      });
    }

    // 未発行: 衝突しないコードを試行
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const existing = await db.doc(`crm_referral_codes/${code}`).get();
      if (!existing.exists) break;
      code = generateCode();
    }

    // 衝突しない確証が取れたら作成（race condition は usedCount=0 で merge:false の create で防ぐ）
    await db.runTransaction(async (tx) => {
      const codeRef = db.doc(`crm_referral_codes/${code}`);
      const codeSnap = await tx.get(codeRef);
      if (codeSnap.exists) {
        // 万一の衝突。次回の GET で再試行されるよう例外を投げる
        throw new Error('CODE_COLLISION');
      }
      tx.create(codeRef, {
        ownerUid: uid,
        createdAt: new Date(),
        usedCount: 0,
      });
      tx.set(ownerRef, { code, updatedAt: new Date() }, { merge: true });
    });

    return NextResponse.json({ code, usedCount: 0 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('referral code error:', error);
    return NextResponse.json({ error: '紹介コード取得に失敗しました' }, { status: 500 });
  }
}
