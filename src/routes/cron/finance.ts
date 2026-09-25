import { Router, Request, Response } from 'express';
import { logCronExecution, logInfo } from '../../services/logger.js';
import { CronJobResponse } from '../../types/index.js';

export const financeCronRouter = Router();

/**
 * Endpoint for cron-job.org to trigger regular financial review / calculations
 * e.g., GET /api/cron/finance/summary or POST /api/cron/finance/summary
 */
financeCronRouter.all('/summary', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const jobName = 'finance-monthly-review';

  try {
    logInfo(`Executing cron job: ${jobName}`);

    // Example logic: In a full setup, this queries your Google Sheet or Database,
    // aggregates monthly income, amortizes yearly subscriptions (e.g. ₹12k / 12),
    // and filters out emergencies.
    const mockSummary = {
      period: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
      estimatedIncome: 0,
      regularExpenses: 0,
      amortizedSubscriptions: 0,
      emergencyExpenses: 0,
      netSavings: 0,
      checkedAt: new Date().toISOString(),
    };

    const durationMs = Date.now() - startTime;
    logCronExecution(jobName, durationMs, 'success', mockSummary);

    const response: CronJobResponse = {
      success: true,
      jobName,
      timestamp: new Date().toISOString(),
      durationMs,
      result: mockSummary,
    };

    res.status(200).json(response);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logCronExecution(jobName, durationMs, 'failed', { error: errorMsg });

    const response: CronJobResponse = {
      success: false,
      jobName,
      timestamp: new Date().toISOString(),
      durationMs,
      error: errorMsg,
    };

    res.status(500).json(response);
  }
});
