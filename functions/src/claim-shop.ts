/**
 * UGC バーの所有権 claim フロー。
 *
 * - nomishugy 内で誰でも作れる UGC バー（ownerUid: null）に対して、
 *   「このバーのオーナーです」申請を受け付ける Cloud Function。
 * - 申請は account_shop_claims に append、運営確認後に shop_shops.ownerUid を更新する。
 *
 * Request body:
 *   { shopId: string, claimMessage: string }
 *
 * Auth: Authorization: Bearer <ID Token>
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

export const claimShop = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public' }, async (req, res) => {
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

  const body = req.body as { shopId?: unknown; claimMessage?: unknown };
  const shopId = typeof body.shopId === 'string' ? body.shopId : '';
  const claimMessage = typeof body.claimMessage === 'string' ? body.claimMessage.slice(0, 1000) : '';

  if (!shopId) {
    res.status(400).json({ error: 'INVALID_BODY' });
    return;
  }

  try {
    const firestore = db();
    const shopRef = firestore.doc(`shop_shops/${shopId}`);
    const shopSnap = await shopRef.get();

    if (!shopSnap.exists) {
      res.status(404).json({ error: 'SHOP_NOT_FOUND' });
      return;
    }
    const shop = shopSnap.data() ?? {};
    if (shop.ownerUid && shop.ownerUid !== uid) {
      res.status(409).json({ error: 'ALREADY_OWNED' });
      return;
    }

    // 申請を append（運営は account_shop_claims を見て手動承認）
    const claimRef = firestore.collection('account_shop_claims').doc();
    await claimRef.set({
      shopId,
      claimantUid: uid,
      claimMessage,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    // 既存 shop に pending マーカーを付ける（重複申請防止 UX 用）
    await shopRef.set({
      ownerPendingClaim: {
        claimantUid: uid,
        claimId: claimRef.id,
        createdAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });

    res.status(200).json({ claimId: claimRef.id });
  } catch (e) {
    logger.error('[claimShop] failed', e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});
