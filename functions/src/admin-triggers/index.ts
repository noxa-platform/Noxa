/**
 * 管理者専用 HTTP trigger 群。本番デプロイ済の scheduled function を、
 * 開発時に「今すぐ」テストできるよう薄い wrapper として公開する。
 *
 * 認証:
 *   - Authorization: Bearer <Firebase ID Token>
 *   - decoded.email が ADMIN_EMAILS（lib/admin-check.ts）に含まれることを要求
 *
 * セキュリティ:
 *   - 既存 scheduled function のロジックは変更しない（runXxx をそのまま呼ぶ）
 *   - 管理者以外は 401/403 で即弾く
 *   - CORS: Authorization ヘッダー付きで Web から叩けるよう許可
 */
import { onRequest, Request as HttpsRequest } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import * as logger from 'firebase-functions/logger';

import { verifyAdmin, AdminAuthError } from '../lib/admin-check';
import { runBirthdayReminder } from '../notifications/birthday';
import { runNextActionReminder } from '../notifications/next-action';
import { runLongTimeNoSeeReminder } from '../notifications/long-time-no-see';
import { runDailySummary } from '../notifications/daily-summary';
import type { RunResult } from '../notifications/birthday';

/** CORS: 認証必須なので credentials なし、Authorization ヘッダー許可 */
function applyCors(req: HttpsRequest, res: Response): boolean {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Max-Age', '3600');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

type Runner = () => Promise<RunResult>;

async function handleTrigger(
  fnName: string,
  runner: Runner,
  req: HttpsRequest,
  res: Response,
): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const admin = await verifyAdmin(req.headers.authorization);
    logger.info('admin trigger invoked', { fnName, by: admin.email });
    const startedAt = Date.now();
    const result = await runner();
    const elapsedMs = Date.now() - startedAt;
    logger.info('admin trigger done', { fnName, ...result, elapsedMs });
    res.status(200).json({
      ok: true,
      fnName,
      elapsedMs,
      result,
      message: `${result.sentCount} 件の通知を送信（対象 ${result.targetCount} / 通知対象 ${result.notifyCount} / 失敗 ${result.failedCount}）`,
    });
  } catch (err) {
    if (err instanceof AdminAuthError) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    logger.error('admin trigger failed', {
      fnName,
      error: (err as Error)?.message ?? String(err),
    });
    res.status(500).json({
      ok: false,
      error: (err as Error)?.message ?? 'internal error',
    });
  }
}

// 同リージョン・短めタイムアウトで個別公開
const REGION = 'asia-northeast1';

export const triggerBirthdayReminder = onRequest(
  { region: REGION, timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => handleTrigger('birthday', runBirthdayReminder, req, res),
);

export const triggerNextActionReminder = onRequest(
  { region: REGION, timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => handleTrigger('next-action', runNextActionReminder, req, res),
);

export const triggerLongTimeNoSeeReminder = onRequest(
  { region: REGION, timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => handleTrigger('long-time-no-see', runLongTimeNoSeeReminder, req, res),
);

export const triggerDailySummary = onRequest(
  { region: REGION, timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => handleTrigger('daily-summary', runDailySummary, req, res),
);
