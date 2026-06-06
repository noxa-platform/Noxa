/**
 * アカウント統合（誤って2アカウント作成した場合）。
 *
 * 認証済みの「残すアカウント A」（Authorization: Bearer <A の ID Token>）が、
 * 「統合元 B」の ID Token（body.sourceIdToken）を添えて呼ぶ。
 * B のデータ（店舗オーナー権/メンバー/個人データ/売上帰属 等）を A に移管し、
 * B は **削除せず無効化**（status='merged' + Auth disabled）。全操作を audit_logs に記録（復元可能）。
 *
 * 安全策: 各移管ステップは独立 try/catch。失敗ステップは結果に含めて返す（部分失敗を可視化）。
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getAuth } from 'firebase-admin/auth';
import { db, getAdminApp } from './admin';
import { writeAuditLog } from './audit';

const ALLOWED_ORIGINS = ['https://noxa.egshugy.com', 'https://noxa-delta.vercel.app', 'http://localhost:3000', 'http://localhost:3100'];

function adminAuth() { return getAuth(getAdminApp()); }
function applyCors(res: { setHeader: (k: string, v: string) => void }, origin: string | undefined) {
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app'))) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}
async function verify(idToken: string): Promise<string> {
  const decoded = await adminAuth().verifyIdToken(idToken);
  return decoded.uid;
}

/** B 配下サブコレ items を A 配下へ移す（浅いコピー＋元削除） */
async function moveItems(parent: string, from: string, to: string): Promise<number> {
  const fs = db();
  const snap = await fs.collection(`${parent}/${from}/items`).get();
  let n = 0;
  for (const d of snap.docs) {
    await fs.doc(`${parent}/${to}/items/${d.id}`).set(d.data(), { merge: true });
    await d.ref.delete();
    n++;
  }
  return n;
}

/** collectionGroup の field==B を A に付け替え */
async function reassignField(group: string, field: string, from: string, to: string): Promise<number> {
  const fs = db();
  const snap = await fs.collectionGroup(group).where(field, '==', from).get();
  let n = 0;
  for (const d of snap.docs) { await d.ref.set({ [field]: to }, { merge: true }); n++; }
  return n;
}

export const mergeAccounts = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public' }, async (req, res) => {
  applyCors(res, req.headers.origin as string | undefined);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  let uidA: string;
  try {
    const header = (req.headers.authorization as string | undefined) ?? '';
    if (!header.startsWith('Bearer ')) throw new Error('NO_BEARER');
    uidA = await verify(header.slice(7).trim());
  } catch { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }

  const sourceIdToken = ((req.body ?? {}) as { sourceIdToken?: string }).sourceIdToken ?? '';
  if (!sourceIdToken) { res.status(400).json({ error: 'NO_SOURCE' }); return; }
  let uidB: string;
  try { uidB = await verify(sourceIdToken); } catch { res.status(401).json({ error: 'SOURCE_UNAUTHORIZED' }); return; }
  if (uidA === uidB) { res.status(400).json({ error: 'SAME_ACCOUNT' }); return; }

  const fs = db();
  const summary: Record<string, number | string> = {};
  const errors: string[] = [];
  const step = async (key: string, fn: () => Promise<number>) => {
    try { summary[key] = await fn(); } catch (e) { errors.push(`${key}: ${(e as Error).message}`); summary[key] = 'ERROR'; }
  };

  // 1) 店舗オーナー権
  await step('shopOwnership', async () => {
    const snap = await fs.collection('shop_shops').where('ownerUid', '==', uidB).get();
    let n = 0; for (const d of snap.docs) { await d.ref.set({ ownerUid: uidA }, { merge: true }); n++; } return n;
  });
  // 2) 店舗メンバー（members/{uid}）
  await step('members', async () => {
    const snap = await fs.collectionGroup('members').where('uid', '==', uidB).get();
    let n = 0;
    for (const d of snap.docs) {
      const targetRef = d.ref.parent.doc(uidA);
      const exists = (await targetRef.get()).exists;
      if (!exists) await targetRef.set({ ...d.data(), uid: uidA });
      await d.ref.delete(); n++;
    }
    return n;
  });
  // 3) account_users/{B}/memberships → A
  await step('memberships', async () => {
    const snap = await fs.collection(`account_users/${uidB}/memberships`).get();
    let n = 0; for (const d of snap.docs) { await fs.doc(`account_users/${uidA}/memberships/${d.id}`).set(d.data(), { merge: true }); await d.ref.delete(); n++; } return n;
  });
  // 4) 個人データ items 移管
  for (const parent of ['personal_customers', 'personal_sales', 'personal_ai_threads', 'personal_templates', 'personal_goals', 'personal_reminders', 'reward_missions', 'reward_grants']) {
    await step(`move:${parent}`, () => moveItems(parent, uidB, uidA));
  }
  // 5) 売上・顧客・勤怠の帰属
  await step('sales.castUid', () => reassignField('sales', 'castUid', uidB, uidA));
  await step('sales.operatorUid', () => reassignField('sales', 'operatorUid', uidB, uidA));
  await step('customers.mainCastUid', () => reassignField('customers', 'mainCastUid', uidB, uidA));
  await step('shifts.castUid', () => reassignField('shifts', 'castUid', uidB, uidA));
  await step('shift_plans.castUid', () => reassignField('shift_plans', 'castUid', uidB, uidA));
  // 6) account 系シングルトン（A に無い場合のみ移管。billing は誤統合を避け read-only 判定）
  await step('singletons', async () => {
    let n = 0;
    for (const col of ['account_subscriptions', 'account_premium', 'account_app_settings', 'account_google_tokens', 'personal_self_styles', 'reward_referral_owners']) {
      const bRef = fs.doc(`${col}/${uidB}`); const bDoc = await bRef.get();
      if (!bDoc.exists) continue;
      const aRef = fs.doc(`${col}/${uidA}`);
      if (!(await aRef.get()).exists) { await aRef.set(bDoc.data() as Record<string, unknown>); n++; }
      await bRef.delete();
    }
    return n;
  });
  // 7) IAP トランザクション uid 付け替え
  await step('iap', async () => {
    const snap = await fs.collection('account_iap_transactions').where('uid', '==', uidB).get();
    let n = 0; for (const d of snap.docs) { await d.ref.set({ uid: uidA }, { merge: true }); n++; } return n;
  });

  // 8) LINE 統合: B が line_ アカウントなら A に lineUserId を記録（今後の LINE ログインは A に解決）
  if (uidB.startsWith('line_')) {
    try { await fs.doc(`account_users/${uidA}`).set({ lineUserId: uidB.slice('line_'.length) }, { merge: true }); summary.lineMapping = 'set'; }
    catch (e) { errors.push(`lineMapping: ${(e as Error).message}`); }
  }

  // 9) B を無効化（削除しない＝復元可能）
  const bSnap = await fs.doc(`account_users/${uidB}`).get();
  const bBefore = bSnap.exists ? bSnap.data() ?? null : null;
  try {
    await fs.doc(`account_users/${uidB}`).set({ status: 'merged', mergedInto: uidA, mergedAt: new Date() }, { merge: true });
    await adminAuth().updateUser(uidB, { disabled: true });
  } catch (e) { errors.push(`disableSource: ${(e as Error).message}`); }

  void writeAuditLog({
    actor: { uid: uidA, role: 'user' },
    action: 'account.merge',
    target: { type: 'user', id: uidB, path: `account_users/${uidB}` },
    before: bBefore,
    after: { mergedInto: uidA, summary },
    metadata: { source: 'noxa-account-merge', errors: errors.join(' | ') },
    ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim(),
    userAgent: req.headers['user-agent'] as string | undefined,
  });

  logger.info('[mergeAccounts] done', { uidA, uidB, summary, errors });
  res.status(200).json({ ok: true, summary, errors });
});
