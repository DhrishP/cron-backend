import { Router, Request, Response } from 'express';
import { logCronExecution, logInfo } from '../../services/logger.js';
import { CronJobResponse } from '../../types/index.js';

export const exampleCronRouter = Router();

/**
 * Template for any new scheduled task
 * cron-job.org can call: GET /api/cron/example/task
 */
exampleCronRouter.all('/task', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const jobName = 'example-scheduled-task';

  try {
    logInfo(`Triggered cron: ${jobName}`, { method: req.method });

    // Place any custom scheduled logic here:
    // e.g., cleanup database, ping third-party API, refresh tokens, send reminder
    const taskResult = {
      message: 'Task executed successfully',
      processedItems: 0,
    };

    const durationMs = Date.now() - startTime;
    logCronExecution(jobName, durationMs, 'success', taskResult);

    const response: CronJobResponse = {
      success: true,
      jobName,
      timestamp: new Date().toISOString(),
      durationMs,
      result: taskResult,
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
