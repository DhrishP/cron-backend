import { Router, Request, Response } from 'express';
import { cronRouter } from './cron/index.js';
import { webhooksRouter } from './webhooks/index.js';

export const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'cron-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Mount Cron and Webhook hubs
apiRouter.use('/cron', cronRouter);
apiRouter.use('/webhooks', webhooksRouter);
