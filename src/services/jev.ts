import { logInfo, logError } from './logger.js';

export interface RecentTransactionItem {
  sms: string;
  title: string;
  amount: number;
  type: string;
  timestamp: number;
}

export interface JevEvaluationResult {
  isReal: boolean;
  isDuplicate: boolean;
  reason: string;
  confidence: number;
}

// In-memory rolling history of recently logged transactions (last 30 minutes, max 10 entries)
const recentTransactions: RecentTransactionItem[] = [];
const DEDUPLICATION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

let circuitOpenUntil = 0;

export function recordRecentTransaction(sms: string, title: string, amount: number, type: string): void {
  const now = Date.now();
  // Prune older transactions
  while (recentTransactions.length > 0 && now - recentTransactions[0].timestamp > DEDUPLICATION_WINDOW_MS) {
    recentTransactions.shift();
  }

  recentTransactions.push({
    sms,
    title,
    amount,
    type,
    timestamp: now,
  });

  if (recentTransactions.length > 10) {
    recentTransactions.shift();
  }
}

export function getRecentTransactions(): RecentTransactionItem[] {
  const now = Date.now();
  return recentTransactions.filter(t => now - t.timestamp <= DEDUPLICATION_WINDOW_MS);
}

export async function evaluateTransactionWithJev(
  sms: string,
  sender: string
): Promise<JevEvaluationResult> {
  const apiKey =
    process.env.TYPESAFE_API_KEY ||
    'apikey_22545fe21fcbeb184adaaf7d23fdabfca267_02231ddea8370ff5c14443f736595aaf1b2c4e57083852564499013c81182aa6';

  const now = Date.now();

  // If circuit breaker is open (e.g. rate limit), fail open to allow transaction
  if (now < circuitOpenUntil) {
    logInfo('Jev circuit breaker is open, bypassing Jev evaluation');
    return { isReal: true, isDuplicate: false, reason: 'circuit_open_bypass', confidence: 1 };
  }

  const recents = getRecentTransactions();

  const questions: Record<string, unknown> = {
    is_real_transaction: {
      type: 'choice',
      instructions:
        'Is this message an actual confirmed financial transaction where money was already debited, paid, spent, transferred, credited, received, or refunded? Or is it a promotional offer, pre-approved loan advertisement, credit card offer, EMI scheme, marketing message, reminder, or spam?',
      criteria: {
        yes: 'An actual completed transaction where money has already moved from/to an account/card/wallet (e.g. debited, paid, spent, credited, received, refunded).',
        no: 'A promotional offer, loan advertisement, pre-approved loan/credit, marketing message, credit limit upgrade offer, or spam.',
      },
    },
  };

  // If we have recent transactions, check for duplicates in the same Jev call
  if (recents.length > 0) {
    questions.is_duplicate = {
      type: 'choice',
      instructions:
        'Does the incoming message represent the EXACT SAME financial transaction that was already logged in recent_transactions (e.g. duplicate bank SMS + app notification for the same spend, same amount and vendor, or duplicate delivery)?',
      criteria: {
        yes: 'Yes, this is an identical duplicate notification/SMS for a transaction already logged in recent history.',
        no: 'No, this is a separate, new transaction (different amount, different merchant, or distinct purchase).',
      },
    };
  }

  const state: Record<string, unknown> = {
    incoming_message: sms,
    sender: sender || 'Unknown',
  };

  if (recents.length > 0) {
    state.recent_transactions = recents.map(r => ({
      title: r.title,
      amount: r.amount,
      type: r.type,
      text: r.sms.slice(0, 150),
      logged_seconds_ago: Math.round((now - r.timestamp) / 1000),
    }));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout

  try {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions,
      }),
    });

    clearTimeout(timeoutId);

    if (res.status === 429 || res.status === 529 || res.status === 503) {
      circuitOpenUntil = Date.now() + 30_000; // Trip circuit for 30s
      logError(`Jev API returned HTTP ${res.status}, tripping circuit for 30s`);
      return { isReal: true, isDuplicate: false, reason: 'rate_limited_bypass', confidence: 0 };
    }

    if (!res.ok) {
      logError(`Jev API returned HTTP ${res.status}`);
      return { isReal: true, isDuplicate: false, reason: 'error_bypass', confidence: 0 };
    }

    const data = (await res.json()) as {
      answers?: {
        is_real_transaction?: { choice?: string; confidence?: number };
        is_duplicate?: { choice?: string; confidence?: number };
      };
    };

    const isRealChoice = data.answers?.is_real_transaction?.choice === 'yes';
    const isRealConfidence = data.answers?.is_real_transaction?.confidence ?? 0;

    if (!isRealChoice && isRealConfidence >= 0.7) {
      logInfo('Jev identified non-real transaction (loan/promotional/spam)', {
        choice: data.answers?.is_real_transaction?.choice,
        confidence: isRealConfidence,
      });
      return {
        isReal: false,
        isDuplicate: false,
        reason: 'not_real_transaction',
        confidence: isRealConfidence,
      };
    }

    const isDuplicateChoice = data.answers?.is_duplicate?.choice === 'yes';
    const isDuplicateConfidence = data.answers?.is_duplicate?.confidence ?? 0;

    if (isDuplicateChoice && isDuplicateConfidence >= 0.7) {
      logInfo('Jev identified duplicate transaction matching recent history', {
        choice: data.answers?.is_duplicate?.choice,
        confidence: isDuplicateConfidence,
      });
      return {
        isReal: true,
        isDuplicate: true,
        reason: 'duplicate_transaction',
        confidence: isDuplicateConfidence,
      };
    }

    return {
      isReal: true,
      isDuplicate: false,
      reason: 'confirmed_new_transaction',
      confidence: isRealConfidence,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    logError('Error evaluating transaction with Jev, failing open', err);
    return { isReal: true, isDuplicate: false, reason: 'exception_bypass', confidence: 0 };
  }
}
