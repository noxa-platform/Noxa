/**
 * NOXA 認証関連の HTTP triggers。
 *
 * - exchangeAuthToken: noxa-delta.vercel.app でログインしたユーザーが yorulog/nomishugy へ
 *   遷移するとき、ID Token を Custom Token に交換する。
 * - deleteNoxaAccount: NOXA アカウント完全削除（カスケード）。
 *
 * 配置場所の理由: yorulog/functions は既存の Firebase Functions プロジェクトで
 * デプロイ済み。新規 functions プロジェクトを作るよりここに同居が早い。
 * 将来的に共通機能だけ別パッケージに切り出すのは可能。
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getAuth } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';
import { db, getAdminApp } from './admin';
import { writeAuditLog } from './audit';

/**
 * 初期化済み Admin App を渡した Auth インスタンスを返す。
 *
 * 重要: getAuth() を引数なしで呼ぶと「default app」を探すが、この Function は
 * scheduled 系と違って db()/messaging() を経由しないため initializeApp() が
 * 走っておらず「app/no-app」エラーで verifyIdToken が必ず 401 になっていた。
 * getAdminApp() で確実に初期化してから getAuth(app) を使う。
 */
function adminAuth() {
  return getAuth(getAdminApp());
}

const ALLOWED_ORIGINS = [
  'https://noxa.egshugy.com',
  'https://noxa-delta.vercel.app',
  'https://yorulog.vercel.app',
  'https://nomishugy.vercel.app',
  'http://localhost:3000',
  'http://localhost:3100',
];

/** 店舗デバイス PIN のハッシュ（shopId をソルトに）。共有端末コード向けの軽量ハッシュ。 */
export function devicePinHash(shopId: string, pin: string): string {
  return createHash('sha256').update(`${shopId}:${pin}`).digest('hex');
}

function applyCors(res: { setHeader: (k: string, v: string) => void }, origin: string | undefined) {
  if (origin && ALLOWED_ORIGINS.some((o) => origin === o || origin.endsWith('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
}

/**
 * Authorization: Bearer <ID Token> を検証して uid を返す。
 */
async function verifyBearer(req: { headers: Record<string, string | string[] | undefined> }): Promise<string> {
  const auth = req.headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header || !header.startsWith('Bearer ')) throw new Error('NO_BEARER');
  const idToken = header.slice('Bearer '.length).trim();
  const decoded = await adminAuth().verifyIdToken(idToken);
  return decoded.uid;
}

/**
 * NOXA でログイン済みユーザーの ID Token → 同 uid の Custom Token を発行。
 * yorulog/nomishugy 側はこれを受け取って signInWithCustomToken で session 確立。
 */
export const exchangeAuthToken = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public' }, async (req, res) => {
  applyCors(res, req.headers.origin as string | undefined);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  try {
    const uid = await verifyBearer(req);
    const customToken = await adminAuth().createCustomToken(uid);
    res.status(200).json({ customToken });
  } catch (e) {
    logger.error('[exchangeAuthToken] failed', e);
    res.status(401).json({ error: 'UNAUTHORIZED' });
  }
});

/**
 * 店舗デバイスログイン。共有タブレット用。オーナー個人垢を使わず、
 * shop_shops/{shopId}/device_profiles/{profileId} の PIN を検証し、
 * 端末専用の Custom Token（claims: device/shopId/profileId/allow）を発行。
 * allow に含まれないモジュール（給与/売掛/リスク客 等）は UI / ルールで遮断する。
 */
export const storeDeviceLogin = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public' }, async (req, res) => {
  applyCors(res, req.headers.origin as string | undefined);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  try {
    const body = (req.body ?? {}) as { shopId?: string; profileId?: string; pin?: string };
    const shopId = (body.shopId ?? '').trim();
    const profileId = (body.profileId ?? '').trim();
    const pin = (body.pin ?? '').trim();
    if (!shopId || !profileId || !pin) { res.status(400).json({ error: 'BAD_REQUEST' }); return; }

    const snap = await db().doc(`shop_shops/${shopId}/device_profiles/${profileId}`).get();
    if (!snap.exists) { res.status(404).json({ error: 'PROFILE_NOT_FOUND' }); return; }
    const data = snap.data() as { pinHash?: string; allowedModules?: string[]; label?: string };
    if (!data.pinHash || data.pinHash !== devicePinHash(shopId, pin)) {
      res.status(401).json({ error: 'INVALID_PIN' });
      return;
    }

    const uid = `dev_${shopId}_${profileId}`;
    const allow = data.allowedModules ?? [];

    // 共有タブレットが POS（sessions / sales）を Firestore に読み書きできるよう
    // shop メンバーとして登録する。role='accounting' は売上編集（sales/payments/tabs）
    // を許可するが、owner/manager 専用（pos_config/menus/tables/給与/締め等）は不可のまま。
    // これにより端末で会計→売上計上が可能になり、機微モジュールは引き続き遮断される。
    await db().doc(`shop_shops/${shopId}/members/${uid}`).set({
      uid,
      role: 'accounting',
      status: 'active',
      kind: 'device',
      profileId,
      label: data.label ?? '',
      joinedAt: new Date(),
    }, { merge: true });

    const customToken = await adminAuth().createCustomToken(uid, {
      device: true,
      shopId,
      profileId,
      allow,
      label: data.label ?? '',
    });
    res.status(200).json({ customToken, allow, label: data.label ?? '', shopId, profileId });
  } catch (e) {
    logger.error('[storeDeviceLogin] failed', e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});

/**
 * NOXA アカウント完全削除（カスケード）。
 *
 * 削除対象:
 *   - account_users/{uid}
 *   - account_subscriptions/{uid}, account_iap_transactions where uid==
 *   - account_google_tokens/{uid}, account_premium/{uid}, account_app_settings/{uid}
 *   - account_users/{uid}/memberships/{*} (本人の所属レコード)
 *   - personal_xxx/{uid}/items/xxx (個人カスタマー / セールス / AI スレ等)
 *   - personal_self_styles/{uid}
 *   - shop_shops/{shopId}/members/{uid} (在籍店舗から脱退)
 *   - reward_referral_owners/{uid}, reward_missions/{uid}, reward_grants/{uid}
 *   - notification_inbox/{uid}, notification_push_tokens/{uid}
 *   - Firebase Auth user
 *
 * 残すもの:
 *   - shop_shops 内 sales / customers (店舗の経営記録、castDisplayName は匿名化)
 *   - community_posts / community_comments (author を anonymized に置換)
 *   - audit_logs (法的保管義務)
 */
export const deleteNoxaAccount = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public' }, async (req, res) => {
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

  // ユーザー削除前にプロフィール snapshot を取得（audit のため）
  const profileSnap = await db().doc(`account_users/${uid}`).get();
  const beforeProfile = profileSnap.exists ? profileSnap.data() ?? null : null;

  try {
    await cascadeDelete(uid);
    await adminAuth().deleteUser(uid);
    logger.info('[deleteNoxaAccount] completed', { uid });

    void writeAuditLog({
      actor: { uid, email: beforeProfile?.email as string | undefined, role: 'user' },
      action: 'user.delete',
      target: { type: 'user', id: uid, path: `account_users/${uid}` },
      before: beforeProfile,
      after: null,
      metadata: { source: 'noxa-self-delete', cascadedCollections: 'account_*, personal_*, shop members, notifications, IAP' },
      ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim(),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    logger.error('[deleteNoxaAccount] failed', { uid, error: String(e) });
    res.status(500).json({ error: 'INTERNAL' });
  }
});

async function cascadeDelete(uid: string): Promise<void> {
  const firestore = db();
  const batch = firestore.batch();

  // 直接削除する account_*/{uid} 系
  for (const col of [
    'account_users',
    'account_subscriptions',
    'account_google_tokens',
    'account_premium',
    'account_app_settings',
    'reward_referral_owners',
    'notification_push_tokens',
  ]) {
    batch.delete(firestore.doc(`${col}/${uid}`));
  }

  // personal_self_styles/{uid}
  batch.delete(firestore.doc(`personal_self_styles/${uid}`));

  await batch.commit();

  // サブコレを再帰削除（personal_customers/{uid}/items 等）
  const personalParents = [
    'personal_customers',
    'personal_sales',
    'personal_ai_threads',
    'personal_templates',
    'personal_goals',
    'personal_reminders',
    'reward_missions',
    'reward_grants',
  ];
  for (const parent of personalParents) {
    await deleteSubcollection(`${parent}/${uid}/items`);
  }

  // shop_shops/{any}/members/{uid} を全部削除
  const memberSnap = await firestore.collectionGroup('members').where('uid', '==', uid).get();
  const memberBatch = firestore.batch();
  for (const d of memberSnap.docs) {
    memberBatch.delete(d.ref);
  }
  await memberBatch.commit();

  // notification_inbox 配下も削除
  await deleteSubcollection(`notification_inbox/${uid}/items`);

  // account_iap_transactions は uid フィールドで検索
  const iapSnap = await firestore.collection('account_iap_transactions').where('uid', '==', uid).get();
  if (!iapSnap.empty) {
    const iapBatch = firestore.batch();
    for (const d of iapSnap.docs) iapBatch.delete(d.ref);
    await iapBatch.commit();
  }
}

/** あるパスのコレクション配下をすべて削除（小規模想定、500 docs ずつ batch） */
async function deleteSubcollection(path: string): Promise<void> {
  const firestore = db();
  let snap = await firestore.collection(path).limit(500).get();
  while (!snap.empty) {
    const batch = firestore.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    snap = await firestore.collection(path).limit(500).get();
  }
}
