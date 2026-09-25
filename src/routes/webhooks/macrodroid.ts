import { Router, Request, Response } from 'express';
import { categorizeWithDeepInfra } from '../../services/deepinfra.js';
import { sendTransactionAlert } from '../../services/telegram.js';
import { logInfo, logError } from '../../services/logger.js';

export const macrodroidRouter = Router();

function isLikelyTransaction(text: string): boolean {
  const lower = text.toLowerCase();

  // Strong keywords — always pass
  const strongKeywords = [
    'debited', 'debit', 'credited', 'credit',
    'paid', 'spent', 'received', 'withdrawn',
    'transferred', 'deposited', 'refund', 'refunded', 'cashback',
    'payment', 'deducted',
  ];

  if (strongKeywords.some(kw => lower.includes(kw))) {
    return true;
  }

  // Weak keywords (e.g. "sent") — only pass if a currency/amount indicator is also present
  const weakKeywords = ['sent'];
  const currencyIndicators = ['rs', 'rs.', '₹', 'inr', 'a/c', 'upi'];

  if (weakKeywords.some(kw => lower.includes(kw)) && currencyIndicators.some(ci => lower.includes(ci))) {
    return true;
  }

  return false;
}

function parseRawBody(body: unknown): { sms: string; sender: string } {
  // body comes as raw text string from express.text()
  const raw = typeof body === 'string' ? body : '';

  if (!raw) {
    return { sms: '', sender: '' };
  }

  try {
    // Fix broken JSON: replace literal newlines/tabs inside string values
    const fixed = raw.replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
    const parsed = JSON.parse(fixed) as Record<string, string>;
    const sms = (parsed.sms || parsed.notification || parsed.not_text || parsed.not_big_text || parsed.text || parsed.message || parsed.body || '').trim();
    const sender = (parsed.sender || parsed.not_title || parsed.title || parsed.not_app_name || '').trim();
    return { sms, sender };
  } catch {
    // If JSON is totally busted, use the raw text itself
    return { sms: raw.replace(/[{}"]/g, '').trim(), sender: '' };
  }
}

macrodroidRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { sms, sender } = parseRawBody(req.body);

    logInfo('MacroDroid webhook received', { sms: sms.substring(0, 120), sender });

    if (!sms) {
      logError('MacroDroid webhook received empty payload');
      res.status(400).json({ success: false, error: 'Empty payload' });
      return;
    }

    // Filter: only process actual financial transactions
    if (!isLikelyTransaction(sms)) {
      logInfo('Filtered out (non-financial)', { sms: sms.substring(0, 80) });
      res.status(200).json({ success: true, ignored: true, reason: 'Not a financial transaction' });
      return;
    }

    // Parse with AI + regex fallback
    const parsed = await categorizeWithDeepInfra(sms, sender);

    // Skip if no valid amount
    if (parsed.amount <= 0) {
      logInfo('Filtered out (zero amount)', { sms: sms.substring(0, 80) });
      res.status(200).json({ success: true, ignored: true, reason: 'No amount found' });
      return;
    }

    logInfo('Transaction parsed', {
      title: parsed.title,
      type: parsed.type,
      amount: parsed.amount,
      tag: parsed.suggestedTag,
    });

    // Forward to Google Sheets — FLAT fields matching columns:
    // Date | Title | Type | Amount (₹) | Tag | Effective Monthly (₹) | Raw
    const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    let forwardStatus = 'skipped';
    let loggedRow: number | undefined;

    if (sheetWebhookUrl) {
      try {
        const forwardResponse = await fetch(sheetWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: new Date().toLocaleDateString('en-IN'),
            title: parsed.title,
            type: parsed.type,
            amount: parsed.amount,
            tag: parsed.suggestedTag,
            effectiveMonthly: parsed.effectiveMonthlyCost,
            raw: sms,
          }),
          redirect: 'follow',
        });
        if (forwardResponse.ok) {
          forwardStatus = 'forwarded';
          const resData = await forwardResponse.json() as { row?: number };
          loggedRow = resData.row;
        } else {
          forwardStatus = 'failed';
          logError('Google Sheets error', { status: forwardResponse.status });
        }
      } catch (fwdErr) {
        logError('Failed to forward to Google Sheets', fwdErr);
        forwardStatus = 'error';
      }
    }

    // Telegram alert for spends >= ₹1,500
    let telegramAlertSent = false;
    if (parsed.amount >= 1500) {
      telegramAlertSent = await sendTransactionAlert(parsed, loggedRow);
    }

    res.status(200).json({
      success: true,
      data: parsed,
      googleSheetSync: forwardStatus,
      telegramAlert: telegramAlertSent,
    });
  } catch (error) {
    logError('Error processing MacroDroid webhook', error);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});
