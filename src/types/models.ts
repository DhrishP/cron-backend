import { ObjectId } from 'mongodb';

export type TransactionType = 'debit' | 'credit' | 'transfer' | 'amortized';
export type TransactionTag = 'Normal' | 'Amortized' | 'Emergency' | 'Transfer' | string;

export interface AmortizationMeta {
  isAmortized: boolean;
  durationMonths: number;
  monthlyShare: number;
  subscriptionId?: ObjectId;
}

export interface TransactionDoc {
  _id?: ObjectId;
  date: Date;
  title: string;
  type: TransactionType;
  amount: number;
  category?: string;
  tag: TransactionTag;
  effectiveMonthly?: number;
  amortization?: AmortizationMeta;
  rawSms?: string;
  source: 'sms_macrodroid' | 'telegram' | 'manual_pwa' | 'sheet_migration';
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionCategory =
  | 'Utilities'
  | 'Health'
  | 'Insurance'
  | 'Domains'
  | 'Tax'
  | 'Streaming'
  | 'Other';

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export interface SubscriptionDoc {
  _id?: ObjectId;
  title: string;
  category: SubscriptionCategory;
  totalAmount: number;
  billingCycleMonths: number;
  monthlyBaselineCost: number;
  startDate: Date;
  nextRenewalDate: Date;
  remindDaysBefore: number;
  status: SubscriptionStatus;
  autoRenew: boolean;
  notes?: string;
  lastPaidTransactionId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonthlySummaryMetrics {
  period: string;
  month: number;
  year: number;
  totalDebited: number;
  totalCredited: number;
  netCashFlow: number;
  effectiveMonthlyBurn: number;
  normalSpends: number;
  subscriptionsBurn: number;
  emergencySpends: number;
  transactionCount: number;
  subscriptionsCount: number;
}
