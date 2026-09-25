import { Router, Request, Response } from 'express';
import { parseBankSms } from '../../services/smsParser.js';
import { logInfo, logError } from '../../services/logger.js';
import { MacroDroidPayload } from '../../types/index.js';

export const macrodroidRouter = Router();

macrodroidRouter.post('/', async (req: Request, res: Response) => {
  try {
    const payload: MacroDroidPayload = req.body;
    const sms = payload.sms || '';
    const sender = payload.sender || '';

    if (!sms) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: "sms"',
      });
      return;
    }

    // Parse the SMS content
    const parsed = parseBankSms(sms, sender);

    logInfo('MacroDroid SMS parsed successfully', {
      amount: parsed.amount,
      type: parsed.type,
      merchant: parsed.merchant,
      tag: parsed.suggestedTag,
      effectiveMonthlyCost: parsed.effectiveMonthlyCost,
    });

    // Optional: Forward to Google Sheets Web App if configured
    const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    let forwardStatus = 'skipped';

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
        });
        forwardStatus = forwardResponse.ok ? 'forwarded' : 'failed';
      } catch (fwdErr) {
        logError('Failed to forward to Google Sheets webhook', fwdErr);
        forwardStatus = 'error';
      }
    }

    res.status(200).json({
      success: true,
      data: parsed,
      googleSheetSync: forwardStatus,
    });
  } catch (error) {
    logError('Error processing MacroDroid webhook', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process SMS payload',
    });
  }
});
