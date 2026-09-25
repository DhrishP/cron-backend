import { ParsedTransaction } from '../types/index.js';
import { logInfo, logError } from './logger.js';
import { categorizeWithDeepInfra } from './deepinfra.js';

let cachedChatId: string | number | null = process.env.TELEGRAM_CHAT_ID || null;

export function setCachedChatId(chatId: string | number): void {
  cachedChatId = chatId;
}

export function getCachedChatId(): string | number | null {
  return cachedChatId || process.env.TELEGRAM_CHAT_ID || null;
}

export async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: Record<string, unknown>): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logError('TELEGRAM_BOT_TOKEN not configured');
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });

    const data = (await response.json()) as { ok?: boolean };
    return data.ok === true;
  } catch (err) {
    logError('Failed to send Telegram message', err);
    return false;
  }
}

export interface MonthlySummaryData {
  period: string;
  totalDebited: number;
  totalCredited: number;
  effectiveMonthlyBurn: number;
  normalSpends: number;
  yearlyAmortized: number;
  quarterlyAmortized: number;
  emergencySpends: number;
  transactionCount: number;
}

export async function sendMonthlySummaryAlert(summary: MonthlySummaryData): Promise<boolean> {
  const chatId = getCachedChatId();
  if (!chatId) {
    logInfo('No Telegram chatId available for monthly summary');
    return false;
  }

  const text =
    `📊 <b>Monthly Financial Summary (${summary.period})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💸 <b>Actual Bank Debited:</b> ₹${summary.totalDebited.toLocaleString('en-IN')}\n` +
    `📉 <b>Effective Monthly Burn:</b> ₹${summary.effectiveMonthlyBurn.toLocaleString('en-IN')}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `• <b>Regular Spends:</b> ₹${summary.normalSpends.toLocaleString('en-IN')}\n` +
    `• <b>Subscriptions & Yearly:</b> ₹${(summary.yearlyAmortized + summary.quarterlyAmortized).toLocaleString('en-IN')}/mo\n` +
    `• <b>Emergencies:</b> ₹${summary.emergencySpends.toLocaleString('en-IN')}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 <b>Total Transactions Logged:</b> ${summary.transactionCount}`;

  return sendTelegramMessage(chatId, text);
}

export async function sendTransactionAlert(
  parsed: ParsedTransaction,
  rowNumber?: number
): Promise<boolean> {
  const chatId = getCachedChatId();
  if (!chatId) {
    logInfo('No Telegram chatId available yet. User must message bot first.');
    return false;
  }

  const row = rowNumber || 0;
  const text = `💸 <b>Transaction Alert (≥ ₹1,500)</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>${parsed.title}</b>\n` +
    `💰 <b>₹${parsed.amount.toLocaleString('en-IN')}</b> (${parsed.type})\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<i>Logged as <b>Normal</b> by default. Tap only if this is a subscription or emergency:</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🗓 1-Year Sub (12mo)', callback_data: `tag:${row}:Yearly:12` },
        { text: '📅 Quarterly (3mo)', callback_data: `tag:${row}:Quarterly:3` },
      ],
      [
        { text: '🚨 Emergency', callback_data: `tag:${row}:Emergency:0` },
      ],
    ],
  };

  return sendTelegramMessage(chatId, text, inlineKeyboard);
}

export async function handleTelegramCallback(callbackQuery: {
  id: string;
  from: { id: number; first_name?: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const data = callbackQuery.data || '';
  const chatId = callbackQuery.message?.chat.id || callbackQuery.from.id;
  const messageId = callbackQuery.message?.message_id;

  // Cache user's chat_id automatically
  setCachedChatId(chatId);

  // Acknowledge the callback immediately
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQuery.id }),
  });

  // Expected callback data: "tag:<row>:<tagName>:<duration>"
  const parts = data.split(':');
  if (parts[0] !== 'tag' || parts.length < 4) {
    return;
  }

  const row = parseInt(parts[1], 10);
  const tagName = parts[2];
  const duration = parseInt(parts[3], 10);

  logInfo(`Telegram button pressed for Row ${row}: ${tagName} (${duration} mo)`);

  // Update Google Sheet via webhook if configured
  const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  let updateSuccess = false;

  if (sheetWebhookUrl && row > 0) {
    try {
      const res = await fetch(sheetWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_tag',
          row,
          tag: tagName,
          duration,
        }),
        redirect: 'follow',
      });
      const resJson = await res.json() as { status?: string };
      updateSuccess = resJson.status === 'updated';
    } catch (err) {
      logError('Failed to update Google Sheet row via Telegram callback', err);
    }
  }

  // Edit original Telegram message to show confirmation
  if (messageId) {
    let confirmationText = `✅ <b>Logged as: ${tagName}</b>`;
    if (tagName === 'Yearly' || duration === 12) {
      confirmationText += ` (Amortized over 12 months)`;
    } else if (tagName === 'Quarterly' || duration === 3) {
      confirmationText += ` (Amortized over 3 months)`;
    } else if (tagName === 'Emergency') {
      confirmationText += ` (Excluded from monthly baseline)`;
    }

    if (row > 0 && updateSuccess) {
      confirmationText += `\n📊 Google Sheet Row ${row} updated!`;
    }

    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: confirmationText,
        parse_mode: 'HTML',
      }),
    });
  }
}

export async function handleDirectTextMessage(chatId: string | number, text: string): Promise<void> {
  const trimmed = text.trim();

  // 1. /start command
  if (trimmed.startsWith('/start')) {
    await sendTelegramMessage(
      chatId,
      `👋 <b>Spend Tracker Connected!</b>\n\n` +
      `<b>How to log spends:</b>\n` +
      `1️⃣ <b>Automatic:</b> Any bank/UPI SMS sent via MacroDroid is auto-logged.\n` +
      `2️⃣ <b>Direct text (Cash / Manual):</b> Just text me anytime, e.g.:\n` +
      `• <code>500 cash petrol</code>\n` +
      `• <code>3500 tank clean</code>\n` +
      `• <code>12000 internet annual</code>\n\n` +
      `📊 Send <b>/summary</b> to see your monthly spending breakdown!`
    );
    return;
  }

  // 2. /summary command
  if (trimmed.startsWith('/summary') || trimmed.toLowerCase() === 'summary') {
    const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    const period = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    let summaryData: MonthlySummaryData = {
      period,
      totalDebited: 0,
      totalCredited: 0,
      effectiveMonthlyBurn: 0,
      normalSpends: 0,
      yearlyAmortized: 0,
      quarterlyAmortized: 0,
      emergencySpends: 0,
      transactionCount: 0,
    };

    if (sheetWebhookUrl) {
      try {
        const sheetRes = await fetch(sheetWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_monthly_summary' }),
          redirect: 'follow',
        });
        if (sheetRes.ok) {
          const sheetJson = await sheetRes.json() as { summary?: Partial<MonthlySummaryData> };
          if (sheetJson.summary) {
            summaryData = { ...summaryData, ...sheetJson.summary, period };
          }
        }
      } catch (err) {
        logError('Error fetching summary for /summary command', err);
      }
    }

    await sendMonthlySummaryAlert(summaryData);
    return;
  }

  // 3. User sent a manual expense text (e.g. "500 cash chai" or "12000 wifi")
  try {
    const parsed = await categorizeWithDeepInfra(trimmed, 'Manual / Telegram');

    if (parsed.amount <= 0) {
      await sendTelegramMessage(
        chatId,
        `⚠️ Could not detect an amount. Please specify an amount, e.g.:\n` +
        `• <code>500 cash for auto</code>\n` +
        `• <code>3500 tank cleaning</code>`
      );
      return;
    }

    // Forward to Google Sheet
    const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    let loggedRow: number | undefined;

    if (sheetWebhookUrl) {
      try {
        const forwardResponse = await fetch(sheetWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sms: trimmed,
            sender: 'Telegram Direct',
            parsed,
          }),
          redirect: 'follow',
        });
        if (forwardResponse.ok) {
          const resData = await forwardResponse.json() as { row?: number };
          loggedRow = resData.row;
        }
      } catch (fwdErr) {
        logError('Failed to forward manual Telegram spend to Google Sheets', fwdErr);
      }
    }

    const row = loggedRow || 0;
    const confirmText =
      `✅ <b>Logged: ₹${parsed.amount.toLocaleString('en-IN')}</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📌 <b>${parsed.title}</b> (${parsed.type})\n` +
      `📊 <i>Logged as <b>Normal</b> by default. Tap below only if this is a recurring sub or emergency:</i>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🗓 1-Year Sub (12mo)', callback_data: `tag:${row}:Yearly:12` },
          { text: '📅 Quarterly (3mo)', callback_data: `tag:${row}:Quarterly:3` },
        ],
        [
          { text: '🚨 Emergency', callback_data: `tag:${row}:Emergency:0` },
        ],
      ],
    };

    await sendTelegramMessage(chatId, confirmText, inlineKeyboard);
  } catch (err) {
    logError('Error logging manual Telegram transaction', err);
    await sendTelegramMessage(chatId, `❌ Failed to log transaction: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

