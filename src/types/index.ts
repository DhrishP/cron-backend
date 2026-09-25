export type TransactionType = 'Debit' | 'Credit' | 'ATM / Cash';

export type ExpenseTag = 'Normal' | 'Yearly' | 'Emergency';

export interface ParsedTransaction {
  title: string;
  category: string;
  amount: number;
  type: TransactionType;
  merchant: string;
  account: string;
  rawSms: string;
  suggestedTag: ExpenseTag;
  effectiveMonthlyCost: number;
  notes: string;
  timestamp: string;
  source: 'ai_deepinfra' | 'regex_fallback';
}

export interface MacroDroidPayload {
  sms?: string;
  sender?: string;
  timestamp?: string;
}

export interface CronJobResponse {
  success: boolean;
  jobName: string;
  timestamp: string;
  durationMs: number;
  result?: Record<string, unknown>;
  error?: string;
}
