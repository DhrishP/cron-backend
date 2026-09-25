import { Router, Request, Response } from 'express';
import { categorizeWithDeepInfra } from '../../services/deepinfra.js';
import { cleanMacroDroidArtifacts } from '../../services/smsParser.js';
import { sendTransactionAlert } from '../../services/telegram.js';
import { logInfo, logError } from '../../services/logger.js';
import { MacroDroidPayload } from '../../types/index.js';

export const macrodroidRouter = Router();

function isLikelyTransaction(text: string, sender: string): boolean {
  const combined = `${text} ${sender}`.toLowerCase();

  // Must contain at least one number
  if (!/\d+/.test(combined)) {
    return false;
  }

  // Must contain at least one financial transaction or banking keyword
  const transactionKeywords = [
    'debit', 'debited', 'paid', 'spent', 'sent', 'transferred', 'withdrawn', 'payment', 'deducted', 'charge',
    'credit', 'credited', 'received', 'refund', 'cashback', 'deposited', 'added',
    'inr', 'rs', 'rs.', '₹', 'upi', 'vpa', 'a/c', 'acct', 'bal', 'balance', 'bank',
    'hdfc', 'sbi', 'icici', 'axis', 'kotak', 'paytm', 'phonepe', 'gpay', 'google pay', 'cred'
  ];

  return transactionKeywords.some(keyword => combined.includes(keyword));
}

macrodroidRouter.post('/', async (req: Request, res: Response) => {
  try {
    const payload: MacroDroidPayload = req.body || {};
    logInfo('MacroDroid webhook received payload', { rawBody: req.body });

    const rawSms = (
      payload.sms ||
      payload.notification ||
      payload.not_text ||
      payload.not_big_text ||
      payload.text ||
      payload.message ||
      payload.body ||
      (typeof req.body === 'string' ? req.body : '')
    ).trim();

    const rawSender = (
      payload.sender ||
      payload.not_title ||
      payload.title ||
      payload.not_app_name ||
      ''
    ).trim();

    const sms = cleanMacroDroidArtifacts(rawSms);
    const sender = cleanMacroDroidArtifacts(rawSender);

    if (!sms) {
      logError('MacroDroid webhook received empty SMS/notification payload', { body: req.body });
      res.status(400).json({
        success: false,
        error: 'Missing required content field: "sms", "notification", "not_text", or "body"',
      });
      return;
    }

    // 1. Pre-filter non-financial messages (e.g. WhatsApp chats, stickers, system status)
    if (!isLikelyTransaction(sms, sender)) {
      logInfo('MacroDroid message filtered out (non-financial)', { sms, sender });
      res.status(200).json({
        success: true,
        ignored: true,
        reason: 'Filtered: Notification does not appear to be a financial transaction.',
      });
      return;
    }

    logInfo('MacroDroid financial transaction detected, parsing...', { sms, sender });

    // 2. Categorize transaction using DeepInfra AI (falls back to regex automatically)
    const parsed = await categorizeWithDeepInfra(sms, sender);

    // 3. Post-filter: If amount is 0 or negative, do NOT write to Google Sheets or send alerts
    if (parsed.amount <= 0) {
      logInfo('MacroDroid parsed transaction has 0 amount, skipping storage', { sms, sender, parsed });
      res.status(200).json({
        success: true,
        ignored: true,
        reason: 'Filtered: No valid transaction amount found.',
        data: parsed,
      });
      return;
    }

    logInfo('MacroDroid transaction classified successfully', {
      title: parsed.title,
      category: parsed.category,
      amount: parsed.amount,
      tag: parsed.suggestedTag,
      source: parsed.source,
      effectiveMonthlyCost: parsed.effectiveMonthlyCost,
    });

    // Optional: Forward to Google Sheets Web App if configured
    const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    let forwardStatus = 'skipped';
    let loggedRow: number | undefined;

    if (sheetWebhookUrl) {
      try {
        const forwardResponse = await fetch(sheetWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sms,
            sender,
            parsed,
          }),
          redirect: 'follow',
        });
        if (forwardResponse.ok) {
          forwardStatus = 'forwarded';
          const resData = await forwardResponse.json() as { row?: number };
          loggedRow = resData.row;
        } else {
          forwardStatus = 'failed';
        }
      } catch (fwdErr) {
        logError('Failed to forward to Google Sheets webhook', fwdErr);
        forwardStatus = 'error';
      }
    }

    // If transaction is >= 1,500 INR, send Telegram notification with 1-tap tag selection
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
    res.status(500).json({
      success: false,
      error: 'Failed to process SMS payload',
    });
  }
});
