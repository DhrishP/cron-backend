import { Router, Request, Response } from 'express';
import { categorizeWithDeepInfra } from '../../services/deepinfra.js';
import { sendTransactionAlert } from '../../services/telegram.js';
import { logInfo, logError } from '../../services/logger.js';
import { evaluateTransactionWithJev, recordRecentTransaction } from '../../services/jev.js';
import { createTransaction } from '../../services/transactions.service.js';

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

    // Ignore notifications from our own bot or spend tracker alerts to prevent loops
    const senderLower = sender.toLowerCase();
    const smsLower = sms.toLowerCase();
    if (
      senderLower.includes('spendstracker') ||
      smsLower.includes('transaction alert') ||
      smsLower.includes('spend tracker connected') ||
      smsLower.includes('monthly financial summary')
    ) {
      logInfo('Ignored own bot notification loop', { sender });
      res.status(200).json({ success: true, ignored: true, reason: 'Own bot notification' });
      return;
    }

    // Quick keyword check before calling AI/Jev
    if (!isLikelyTransaction(sms)) {
      logInfo('Filtered out (non-financial keyword check)', { sms: sms.substring(0, 80) });
      res.status(200).json({ success: true, ignored: true, reason: 'Not a financial transaction' });
      return;
    }

    // Evaluate with TypeSafe Jev SystemOne:
    // 1. Is this a real transaction vs loan/promotional/spam?
    // 2. Is this a duplicate of a recent transaction (e.g. duplicate bank SMS)?
    const jev = await evaluateTransactionWithJev(sms, sender);

    if (!jev.isReal) {
      logInfo('Filtered out by Jev (not a real transaction)', { sms: sms.substring(0, 80), reason: jev.reason });
      res.status(200).json({ success: true, ignored: true, reason: 'Filtered by Jev: promotional or loan offer' });
      return;
    }

    if (jev.isDuplicate) {
      logInfo('Filtered out by Jev (duplicate transaction)', { sms: sms.substring(0, 80), reason: jev.reason });
      res.status(200).json({ success: true, ignored: true, reason: 'Filtered by Jev: duplicate transaction' });
      return;
    }

    // Parse with AI + regex fallback
    const parsed = await categorizeWithDeepInfra(sms, sender);

    // If Jev classified as credit card payment or self transfer, enforce Transfer type/tag
    if (jev.isTransfer) {
      parsed.type = 'Transfer';
      parsed.suggestedTag = 'Transfer';
      parsed.effectiveMonthlyCost = 0;
      parsed.category = 'Credit Card / Self Transfer';
    }

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

    // Record in recent history for subsequent duplicate detection
    recordRecentTransaction(sms, parsed.title, parsed.amount, parsed.type);

    // 1. Save directly to MongoDB Atlas
    let dbTxId: string | undefined;
    try {
      const typeLower = parsed.type.toLowerCase();
      let txType: 'debit' | 'credit' | 'transfer' = 'debit';
      if (typeLower.includes('credit')) txType = 'credit';
      else if (typeLower.includes('transfer')) txType = 'transfer';

      const tag: 'Normal' | 'Amortized' | 'Emergency' | 'Transfer' =
        parsed.suggestedTag === 'Emergency' ? 'Emergency' : (parsed.suggestedTag === 'Transfer' ? 'Transfer' : 'Normal');

      const savedTx = await createTransaction({
        title: parsed.title,
        amount: parsed.amount,
        type: txType,
        category: parsed.category || 'Everyday Spend',
        tag,
        effectiveMonthly: parsed.effectiveMonthlyCost || parsed.amount,
        rawSms: sms,
        date: new Date(),
        source: 'sms_macrodroid',
      });
      dbTxId = savedTx._id?.toString();
      logInfo('Saved transaction to MongoDB', { id: dbTxId, title: parsed.title, amount: parsed.amount });
    } catch (dbErr) {
      logError('Failed to save transaction to MongoDB', dbErr);
    }

    // 2. Telegram alert for spends >= ₹1,500
    let telegramAlertSent = false;
    if (parsed.amount >= 1500) {
      telegramAlertSent = await sendTransactionAlert(parsed, dbTxId);
    }

    res.status(200).json({
      success: true,
      data: parsed,
      dbId: dbTxId,
      telegramAlert: telegramAlertSent,
    });
  } catch (error) {
    logError('Error processing MacroDroid webhook', error);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});
