import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // Standard middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Root welcome / info route
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      message: 'Cron Backend Router is active',
      endpoints: {
        health: '/api/health',
        cronFinance: '/api/cron/finance/summary',
        cronExample: '/api/cron/example/task',
        macroDroidWebhook: '/api/webhooks/macrodroid',
      },
    });
  });

  // Mount API router on both /api and / (for convenience)
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  // Fallback 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // Central error handler
  app.use(errorHandler);

  return app;
}
