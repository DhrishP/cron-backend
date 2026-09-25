import { Router, Request, Response } from 'express';
import { handleTelegramCallback, handleDirectTextMessage, setCachedChatId } from '../../services/telegram.js';
import { logInfo, logError } from '../../services/logger.js';

export const telegramRouter = Router();

telegramRouter.post('/', async (req: Request, res: Response) => {
  try {
    const update = req.body;

    // 1. Handle user direct text messages (cash, manual spends, /summary, /start)
    if (update.message) {
      const chatId = update.message.chat?.id;
      const text = (update.message.text || '').trim();

      if (chatId && text) {
        setCachedChatId(chatId);
        logInfo(`Telegram message from ${chatId}: "${text}"`);
        await handleDirectTextMessage(chatId, text);
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
