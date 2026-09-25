import { Router, Request, Response } from 'express';
import { cronRouter } from './cron/index.js';
import { webhooksRouter } from './webhooks/index.js';

export const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', async (_req: Request, res: Response) => {
  const rawUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';
  const cleanUrl = rawUrl.replace(/['"]/g, '').trim();
  let sheetTest = 'untested';
  try {
    const testRes = await fetch(cleanUrl, { redirect: 'follow' });
    sheetTest = `status: ${testRes.status}`;
  } catch (err) {
    sheetTest = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  res.status(200).json({
    status: 'ok',
    service: 'cron-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sheetUrlLength: cleanUrl.length,
    sheetUrlPrefix: cleanUrl.substring(0, 50),
    sheetUrlSuffix: cleanUrl.substring(cleanUrl.length - 20),
    sheetTest,
  });
});

// Mount Cron and Webhook hubs
apiRouter.use('/cron', cronRouter);
apiRouter.use('/webhooks', webhooksRouter);
