/**
 * AI クレジット ledger Cloud Function。
 *
 * 目的:
 *   - サーバーサイドで AI 消費を一元管理（client 改ざん不能）
 *   - account_subscriptions.aiCreditsUsed を increment
 *   - account_credit_ledger/{uid}/entries に append（監査履歴）
 *
 * 呼び出し元:
 *   - yorulog / nomishugy / noxa の AI 機能から POST
 *   - Authorization: Bearer <ID Token> 必須
 *
 * Request body:
 *   { service: 'yorulog' | 'nomishugy' | 'noxa', feature: string, amount: number }
 *
 * Response:
 *   200: { aiCreditsUsed: number }  // 累積消費量
 *   401: { error: 'UNAUTHORIZED' }
 *   400: { error: 'INVALID_BODY' }
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

const ALLOWED_ORIGINS = [
  'https://noxa-delta.vercel.app',
  'https://yorulog.vercel.app',
  'https://nomishugy.vercel.app',
  'http://localhost:3000',
  'http://localhost:3100',
];

type ServiceName = 'yorulog' | 'nomishugy' | 'noxa';

function applyCors(res: { setHeader: (k: string, v: string) => void }, origin: string | undefined) {
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
}

async function verifyBearer(req: { headers: Record<string, string | string[] | undefined> }): Promise<string> {
  const auth = req.headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header || !header.startsWith('Bearer ')) throw new Error('NO_BEARER');
  const idToken = header.slice('Bearer '.length).trim();
  const decoded = await getAuth().verifyIdToken(idToken);
  return decoded.uid;
}

function isValidService(s: unknown): s is ServiceName {
  return s === 'yorulog' || s === 'nomishugy' || s === 'noxa';
}

export const consumeAiCredit = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public' }, async (req, res) => {
  applyCors(res, req.headers.origin as string | undefined);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  let uid: string;
  try {
    uid = await verifyBearer(req);
  } catch {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = req.body as { service?: unknown; feature?: unknown; amount?: unknown };
  const service = body.service;
  const feature = typeof body.feature === 'string' ? body.feature : '';
  const amount = typeof body.amount === 'number' ? Math.max(1, Math.floor(body.amount)) : 0;

  if (!isValidService(service) || !feature || amount <= 0) {
    res.status(400).json({ error: 'INVALID_BODY' });
    return;
  }

  try {
    const firestore = db();
    const subRef = firestore.doc(`account_subscriptions/${uid}`);
    const ledgerRef = firestore.collection(`account_credit_ledger/${uid}/entries`).doc();

    await firestore.runTransaction(async (tx) => {
      tx.set(subRef, {
        aiCreditsUsed: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(ledgerRef, {
        service,
        feature,
        amount,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const snap = await subRef.get();
    const aiCreditsUsed = (snap.data()?.aiCreditsUsed as number) ?? amount;

    res.status(200).json({ aiCreditsUsed });
  } catch (e) {
    logger.error('[consumeAiCredit] failed', e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});
