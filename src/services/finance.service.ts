import { getMonthlyCashFlowMetrics } from './transactions.service.js';
import { calculateTotalMonthlyCommitment, getAllSubscriptions } from './subscriptions.service.js';
import { MonthlySummaryMetrics } from '../types/models.js';

export async function getComprehensiveMonthlySummary(
  targetMonth?: number,
  targetYear?: number
): Promise<MonthlySummaryMetrics> {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const month = targetMonth !== undefined ? targetMonth : istNow.getUTCMonth();
  const year = targetYear !== undefined ? targetYear : istNow.getUTCFullYear();

  const [cashFlow, subscriptionsMonthlyBurn, subscriptions] = await Promise.all([
    getMonthlyCashFlowMetrics(month, year),
    calculateTotalMonthlyCommitment(),
    getAllSubscriptions({ status: 'active' }),
  ]);

  const dateObj = new Date(Date.UTC(year, month, 1));
  const period = dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Use amortized monthly commitment from transactions if present, or subscriptions baseline
  const amortizedBurn = cashFlow.amortizedMonthly > 0 ? cashFlow.amortizedMonthly : subscriptionsMonthlyBurn;
  const effectiveMonthlyBurn = Math.round((cashFlow.regularSpends + amortizedBurn) * 100) / 100;

  return {
    period,
    month,
    year,
    totalDebited: cashFlow.actualCashDebited,
    totalCredited: cashFlow.totalCredited,
    netCashFlow: cashFlow.netCashFlow,
    effectiveMonthlyBurn,
    normalSpends: cashFlow.regularSpends,
    subscriptionsBurn: amortizedBurn,
    emergencySpends: cashFlow.emergencySpends,
    transactionCount: cashFlow.transactionCount,
    subscriptionsCount: subscriptions.length,
  };
}
