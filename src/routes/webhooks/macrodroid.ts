import { Router, Request, Response } from 'express';
import { categorizeWithDeepInfra } from '../../services/deepinfra.js';
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

    // Categorize transaction using DeepInfra AI (falls back to regex automatically)
    const parsed = await categorizeWithDeepInfra(sms, sender);

    logInfo('MacroDroid SMS classified successfully', {
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
