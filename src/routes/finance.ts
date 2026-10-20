import { Router, Request, Response } from 'express';
import { getComprehensiveMonthlySummary } from '../services/finance.service.js';
import { getUpcomingRenewals, calculateTotalMonthlyCommitment } from '../services/subscriptions.service.js';
import { logError } from '../services/logger.js';

export const financeRouter = Router();

// GET /api/finance/summary - Monthly summary metrics
financeRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const month = req.query.month !== undefined ? parseInt(req.query.month as string, 10) : undefined;
    const year = req.query.year !== undefined ? parseInt(req.query.year as string, 10) : undefined;

    const summary = await getComprehensiveMonthlySummary(month, year);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, summary });
  } catch (err) {
    logError('Error fetching monthly finance summary', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/finance/renewals - Upcoming renewal alerts
financeRouter.get('/renewals', async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 45;
    const [renewals, monthlyCommitment] = await Promise.all([
      getUpcomingRenewals(days),
      calculateTotalMonthlyCommitment(),
    ]);

    res.status(200).json({
      success: true,
      daysAhead: days,
      monthlyCommitment,
      count: renewals.length,
      renewals,
      upcomingRenewals: renewals,
    });
  } catch (err) {
    logError('Error fetching upcoming renewals', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
