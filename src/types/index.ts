export type TransactionType = 'Debit' | 'Credit' | 'ATM / Cash';

export type ExpenseTag = 'Normal' | '1-Year Sub' | 'Emergency' | 'Petty Cash' | 'Home / Tank Maintenance';

export interface ParsedTransaction {
  amount: number;
  type: TransactionType;
  merchant: string;
  account: string;
  rawSms: string;
  suggestedTag: ExpenseTag;
  effectiveMonthlyCost: number;
  timestamp: string;
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
