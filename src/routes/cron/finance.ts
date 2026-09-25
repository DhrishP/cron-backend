import { Router, Request, Response } from 'express';
import { logCronExecution, logInfo, logError } from '../../services/logger.js';
import { sendMonthlySummaryAlert, MonthlySummaryData } from '../../services/telegram.js';
import { CronJobResponse } from '../../types/index.js';

export const financeCronRouter = Router();

/**
 * Endpoint for cron-job.org to trigger monthly financial summary
 * Calculates true burn rate and delivers a breakdown to Telegram
 */
financeCronRouter.all('/summary', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const jobName = 'finance-monthly-review';

  try {
    logInfo(`Executing cron job: ${jobName}`);

    const period = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    let summaryData: MonthlySummaryData = {
      period,
      totalDebited: 0,
      totalCredited: 0,
      effectiveMonthlyBurn: 0,
      normalSpends: 0,
      yearlyAmortized: 0,
      quarterlyAmortized: 0,
      emergencySpends: 0,
      transactionCount: 0,
    };

    // Query Google Sheets if configured
    const sheetWebhookUrl = (process.env.GOOGLE_SHEET_WEBHOOK_URL || '').replace(/['"]/g, '').trim();
    if (sheetWebhookUrl) {
      try {
        const sheetRes = await fetch(sheetWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_monthly_summary' }),
          redirect: 'follow',
        });
        if (sheetRes.ok) {
          const sheetJson = await sheetRes.json() as { status?: string; summary?: Partial<MonthlySummaryData> };
          if (sheetJson.summary) {
            summaryData = {
              ...summaryData,
              ...sheetJson.summary,
              period,
            };
          }
        }
      } catch (sheetErr) {
        logError('Error fetching monthly summary from Google Sheet', sheetErr);
      }
    }

    // Send Telegram Notification
    const telegramSent = await sendMonthlySummaryAlert(summaryData);

    const durationMs = Date.now() - startTime;
    logCronExecution(jobName, durationMs, 'success', { ...summaryData, telegramSent });

    const response: CronJobResponse = {
      success: true,
      jobName,
      timestamp: new Date().toISOString(),
      durationMs,
      result: {
        ...summaryData,
        telegramAlertDelivered: telegramSent,
      },
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
