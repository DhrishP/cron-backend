import { Router, Request, Response } from 'express';
import { handleTelegramCallback, sendTelegramMessage, setCachedChatId } from '../../services/telegram.js';
import { logInfo, logError } from '../../services/logger.js';

export const telegramRouter = Router();

telegramRouter.post('/', async (req: Request, res: Response) => {
  try {
    const update = req.body;

    // 1. Handle normal text messages (e.g. /start)
    if (update.message) {
      const chatId = update.message.chat?.id;
      const text = (update.message.text || '').trim();

      if (chatId) {
        setCachedChatId(chatId);
        logInfo(`Telegram chat connected with ID: ${chatId}`);

        if (text.startsWith('/start')) {
          await sendTelegramMessage(
            chatId,
            `👋 <b>Spend Tracker Bot Connected!</b>\n\n` +
            `Your Chat ID: <code>${chatId}</code>\n\n` +
            `Whenever MacroDroid logs a transaction <b>≥ ₹1,500</b>, I will send you 1-tap buttons here so you can tag it as <i>Yearly</i>, <i>Quarterly</i>, or <i>Emergency</i> instantly.`
          );
        }
      }
    }

    // 2. Handle button clicks (callback_query)
    if (update.callback_query) {
      await handleTelegramCallback(update.callback_query);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    logError('Error processing Telegram webhook update', error);
    res.status(200).json({ ok: true }); // Always return 200 to Telegram so it doesn't retry endlessly
  }
});
