import { Router, Request, Response } from 'express';
import { cronRouter } from './cron/index.js';
import { webhooksRouter } from './webhooks/index.js';
import { transactionsRouter } from './transactions.js';
import { subscriptionsRouter } from './subscriptions.js';
import { financeRouter } from './finance.js';

export const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', async (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'cron-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'mongodb-atlas',
  });
});

// Mount Core REST APIs
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/subscriptions', subscriptionsRouter);
apiRouter.use('/finance', financeRouter);

// Mount Cron and Webhook hubs
apiRouter.use('/cron', cronRouter);
apiRouter.use('/webhooks', webhooksRouter);
