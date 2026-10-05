import { ObjectId } from 'mongodb';
import { ParsedTransaction } from '../types/index.js';
import { TransactionTag } from '../types/models.js';
import { logInfo, logError } from './logger.js';
import { categorizeWithDeepInfra } from './deepinfra.js';
import { getComprehensiveMonthlySummary } from './finance.service.js';
import { getAllSubscriptions, getUpcomingRenewals, EnrichedSubscription } from './subscriptions.service.js';
import { createTransaction, amortizeTransaction, updateTransaction } from './transactions.service.js';

let cachedChatId: string | number | null = process.env.TELEGRAM_CHAT_ID || null;

export function setCachedChatId(chatId: string | number): void {
  cachedChatId = chatId;
}

export function getCachedChatId(): string | number | null {
  return cachedChatId || process.env.TELEGRAM_CHAT_ID || null;
}

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

    const data = (await response.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      logError('Telegram API returned error', data);
    }
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
  netCashFlow?: number;
  effectiveMonthlyBurn: number;
  normalSpends: number;
  yearlyAmortized?: number;
  quarterlyAmortized?: number;
  subscriptionsBurn?: number;
  emergencySpends: number;
  transactionCount: number;
}

export async function sendMonthlySummaryAlert(summary: MonthlySummaryData, targetChatId?: string | number): Promise<boolean> {
  const chatId = targetChatId || getCachedChatId();
  if (!chatId) {
    logInfo('No Telegram chatId available for monthly summary');
    return false;
  }

  const net = summary.netCashFlow !== undefined ? summary.netCashFlow : (summary.totalCredited - summary.totalDebited);
  const netSign = net >= 0 ? '+' : '-';
  const netLabel = net >= 0 ? 'Surplus / Inflow' : 'Net Outflow';
  const subsBurn = summary.subscriptionsBurn !== undefined
    ? summary.subscriptionsBurn
    : ((summary.yearlyAmortized || 0) + (summary.quarterlyAmortized || 0));

  const text =
    `📊 <b>Monthly Financial Summary (${summary.period})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏦 <b>Bank Cash Flow (Real Money):</b>\n` +
    `  • 💸 <b>Actual Spent (Debited):</b> ₹${summary.totalDebited.toLocaleString('en-IN')}\n` +
    `  • 💰 <b>Received (Credited):</b> ₹${summary.totalCredited.toLocaleString('en-IN')}\n` +
    `  • ⚖️ <b>Net Cash Flow:</b> ${netSign}₹${Math.abs(net).toLocaleString('en-IN')} (<i>${netLabel}</i>)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📉 <b>True Monthly Burn (Operating Cost):</b>\n` +
    `  • 🔥 <b>Effective Monthly Burn:</b> ₹${summary.effectiveMonthlyBurn.toLocaleString('en-IN')}\n` +
    `    - <b>Regular Spends:</b> ₹${summary.normalSpends.toLocaleString('en-IN')}\n` +
    `    - <b>Subscriptions & Amortized:</b> ₹${subsBurn.toLocaleString('en-IN')}/mo\n` +
    `    - <b>Emergencies:</b> ₹${summary.emergencySpends.toLocaleString('en-IN')}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 <b>Total Transactions Logged:</b> ${summary.transactionCount}`;

  return sendTelegramMessage(chatId, text);
}

export async function fetchMonthlySummaryFromDb(targetMonth?: number, targetYear?: number): Promise<MonthlySummaryData> {
  const summary = await getComprehensiveMonthlySummary(targetMonth, targetYear);
  return {
    period: summary.period,
    totalDebited: summary.totalDebited,
    totalCredited: summary.totalCredited,
    netCashFlow: summary.netCashFlow,
    effectiveMonthlyBurn: summary.effectiveMonthlyBurn,
    normalSpends: summary.normalSpends,
    yearlyAmortized: summary.subscriptionsBurn,
    quarterlyAmortized: 0,
    subscriptionsBurn: summary.subscriptionsBurn,
    emergencySpends: summary.emergencySpends,
    transactionCount: summary.transactionCount,
  };
}

export async function fetchMonthlySummaryFromSheet(): Promise<MonthlySummaryData | null> {
  return fetchMonthlySummaryFromDb();
}

export interface SubscriptionRenewalItem {
  title: string;
  duration: number;
  durationLabel: string;
  monthlyCost: number;
  totalAmount: number;
  startDate: string;
  expiryDate: string;
  expiryTimestamp: number;
  daysRemaining: number;
  isOverdue: boolean;
  isExpiringSoon: boolean;
  status: 'overdue' | 'today' | 'week' | 'soon' | 'active';
}

export async function fetchSubscriptionRenewals(daysAhead = 45): Promise<SubscriptionRenewalItem[]> {
  try {
    const activeSubs = await getAllSubscriptions({ status: 'active' });
    const filtered = activeSubs.filter(s => s.daysRemaining <= daysAhead);
    return filtered.map(s => {
      const d = new Date(s.nextRenewalDate);
      const expiryDate = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      return {
        title: s.title,
        duration: s.billingCycleMonths,
        durationLabel: s.cycleLabel,
        monthlyCost: s.monthlyBaselineCost,
        totalAmount: s.totalAmount,
        startDate: s.startDate ? new Date(s.startDate).toLocaleDateString('en-IN') : '',
        expiryDate,
        expiryTimestamp: d.getTime(),
        daysRemaining: s.daysRemaining,
        isOverdue: s.isOverdue,
        isExpiringSoon: s.isExpiringSoon,
        status: s.urgencyStatus,
      };
    });
  } catch (err) {
    logError('Error fetching subscription renewals from MongoDB Atlas', err);
    return [];
  }
}

export async function sendRenewalAlert(renewals: SubscriptionRenewalItem[], targetChatId?: string | number): Promise<boolean> {
  const chatId = targetChatId || getCachedChatId();
  if (!chatId) {
    logInfo('No Telegram chatId available for renewal alert');
    return false;
  }

  if (renewals.length === 0) {
    return false;
  }

  let text = `🔔 <b>Subscription Renewal Alert</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `The following subscription(s) are ending soon and need renewal:\n\n`;

  for (const item of renewals) {
    let statusBadge = '🟡';
    let timeText = `in <b>${item.daysRemaining} days</b>`;
    if (item.isOverdue) {
      statusBadge = '🔴';
      timeText = `<b>OVERDUE by ${Math.abs(item.daysRemaining)} days</b>`;
    } else if (item.daysRemaining === 0) {
      statusBadge = '🚨';
      timeText = `<b>EXPIRES TODAY!</b>`;
    } else if (item.daysRemaining <= 7) {
      statusBadge = '⚠️';
      timeText = `in <b>${item.daysRemaining} days</b> (<i>This week!</i>)`;
    }

    text += `${statusBadge} <b>${escapeHtml(item.title)}</b> (${escapeHtml(item.durationLabel)})\n`;
    text += `  • 📅 <b>Renewal Due:</b> ${item.expiryDate} (${timeText})\n`;
    text += `  • 💰 <b>Est. Renewal Cost:</b> ₹${item.totalAmount.toLocaleString('en-IN')} (₹${item.monthlyCost.toLocaleString('en-IN')}/mo)\n\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💡 <i>Send /renewals to inspect all tracked subscriptions.</i>`;

  return sendTelegramMessage(chatId, text);
}

export async function sendAllSubscriptionsList(renewals: SubscriptionRenewalItem[], targetChatId?: string | number): Promise<boolean> {
  const chatId = targetChatId || getCachedChatId();
  if (!chatId) {
    logInfo('No Telegram chatId available for subscriptions list');
    return false;
  }

  if (renewals.length === 0) {
    return sendTelegramMessage(
      chatId,
      `📋 <b>Tracked Subscriptions</b>\n\nNo recurring or active subscriptions found in database.\n\n` +
      `💡 <i>Tip: Amortized expenses (3m, 6m, 12m) are automatically tracked here!</i>`
    );
  }

  const expiringSoon = renewals.filter(r => r.isExpiringSoon || r.isOverdue);
  const futureSubs = renewals.filter(r => !r.isExpiringSoon && !r.isOverdue);
  const totalMonthlyCommit = renewals.reduce((sum, r) => sum + r.monthlyCost, 0);

  let text = `📋 <b>Tracked Subscriptions & Renewals</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  if (expiringSoon.length > 0) {
    text += `🚨 <b>Due for Renewal Soon:</b>\n`;
    for (const r of expiringSoon) {
      const badge = r.isOverdue ? '🔴 [OVERDUE]' : (r.daysRemaining <= 7 ? '⚠️ [THIS WEEK]' : '🟡 [SOON]');
      text += `• <b>${escapeHtml(r.title)}</b> (${escapeHtml(r.durationLabel)})\n`;
      text += `  📅 <b>${r.expiryDate}</b> (${r.daysRemaining >= 0 ? `${r.daysRemaining}d left` : `${Math.abs(r.daysRemaining)}d ago`}) ${badge}\n`;
      text += `  💰 ₹${r.totalAmount.toLocaleString('en-IN')} (₹${r.monthlyCost.toLocaleString('en-IN')}/mo)\n\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  }

  if (futureSubs.length > 0) {
    text += `🗓 <b>Active Subscriptions:</b>\n`;
    for (const r of futureSubs) {
      text += `• <b>${escapeHtml(r.title)}</b> (${escapeHtml(r.durationLabel)})\n`;
      text += `  📅 Due: <b>${r.expiryDate}</b> (in ${r.daysRemaining} days)\n`;
      text += `  💰 ₹${r.totalAmount.toLocaleString('en-IN')} (₹${r.monthlyCost.toLocaleString('en-IN')}/mo)\n\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  }

  text += `📊 <b>Total Subscriptions:</b> ${renewals.length}\n`;
  text += `💸 <b>Total Monthly Baseline:</b> ₹${Math.round(totalMonthlyCommit).toLocaleString('en-IN')}/mo`;

  return sendTelegramMessage(chatId, text);
}

export function getDefaultAlertKeyboard(rowOrId: string | number) {
  return {
    inline_keyboard: [
      [
        { text: '🗓 3 Months', callback_data: `tag:${rowOrId}:Amortized:3` },
        { text: '🗓 6 Months', callback_data: `tag:${rowOrId}:Amortized:6` },
        { text: '🗓 1 Year (12m)', callback_data: `tag:${rowOrId}:Amortized:12` },
      ],
      [
        { text: '🔢 Pick 2–12 Months', callback_data: `picker:${rowOrId}` },
        { text: '🚨 Emergency', callback_data: `tag:${rowOrId}:Emergency:0` },
      ],
    ],
  };
}

export function getMonthPickerKeyboard(rowOrId: string | number) {
  return {
    inline_keyboard: [
      [
        { text: '2 mo', callback_data: `tag:${rowOrId}:Amortized:2` },
        { text: '3 mo', callback_data: `tag:${rowOrId}:Amortized:3` },
        { text: '4 mo', callback_data: `tag:${rowOrId}:Amortized:4` },
        { text: '5 mo', callback_data: `tag:${rowOrId}:Amortized:5` },
      ],
      [
        { text: '6 mo', callback_data: `tag:${rowOrId}:Amortized:6` },
        { text: '7 mo', callback_data: `tag:${rowOrId}:Amortized:7` },
        { text: '8 mo', callback_data: `tag:${rowOrId}:Amortized:8` },
        { text: '9 mo', callback_data: `tag:${rowOrId}:Amortized:9` },
      ],
      [
        { text: '10 mo', callback_data: `tag:${rowOrId}:Amortized:10` },
        { text: '11 mo', callback_data: `tag:${rowOrId}:Amortized:11` },
        { text: '12 mo', callback_data: `tag:${rowOrId}:Amortized:12` },
      ],
      [
        { text: '⬅️ Back', callback_data: `back:${rowOrId}` },
        { text: '🚨 Emergency', callback_data: `tag:${rowOrId}:Emergency:0` },
      ],
    ],
  };
}

export async function sendTransactionAlert(
  parsed: ParsedTransaction,
  rowOrId?: string | number
): Promise<boolean> {
  const chatId = getCachedChatId();
  if (!chatId) {
    logInfo('No Telegram chatId available yet. User must message bot first.');
    return false;
  }

  const row = rowOrId || 0;
  const safeTitle = escapeHtml(parsed.title);
  const safeType = escapeHtml(parsed.type);

  if (parsed.type === 'Transfer' || parsed.suggestedTag === 'Transfer') {
    const text = `💳 <b>Credit Card / Self-Transfer (≥ ₹1,500)</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📌 <b>${safeTitle}</b>\n` +
      `💰 <b>₹${parsed.amount.toLocaleString('en-IN')}</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `ℹ️ <i>Logged as <b>Transfer</b>. Excluded from Monthly Burn & Net Cash Flow to prevent double-counting.</i>`;
    return sendTelegramMessage(chatId, text);
  }

  const text = `💸 <b>Transaction Alert (≥ ₹1,500)</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>${safeTitle}</b>\n` +
    `💰 <b>₹${parsed.amount.toLocaleString('en-IN')}</b> (${safeType})\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<i>Logged as <b>Normal</b> by default. Split across multiple months:</i>`;

  return sendTelegramMessage(chatId, text, getDefaultAlertKeyboard(row));
}

export async function handleTelegramCallback(callbackQuery: {
  id: string;
  from: { id: number; first_name?: string };
  message?: { message_id: number; chat: { id: number }; text?: string };
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

  // Handle switching to month picker grid (2 to 12 months)
  if (data.startsWith('picker:') && messageId) {
    const row = parseInt(data.split(':')[1], 10) || 0;
    await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: getMonthPickerKeyboard(row),
      }),
    });
    return;
  }

  // Handle back button to default keyboard
  if (data.startsWith('back:') && messageId) {
    const row = parseInt(data.split(':')[1], 10) || 0;
    await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: getDefaultAlertKeyboard(row),
      }),
    });
    return;
  }

  // Expected callback data: "tag:<rowOrId>:<tagName>:<duration>"
  const parts = data.split(':');
  if (parts[0] !== 'tag' || parts.length < 4) {
    return;
  }

  const rowOrId = parts[1];
  const tagName = parts[2];
  const duration = parseInt(parts[3], 10);

  logInfo(`Telegram button pressed for Item ${rowOrId}: ${tagName} (${duration} mo)`);

  let updateSuccess = false;
  let monthlyCost = 0;

  // Update MongoDB Atlas if valid ObjectId
  if (ObjectId.isValid(rowOrId)) {
    try {
      if (duration > 1) {
        const updated = await amortizeTransaction(rowOrId, duration);
        if (updated) {
          updateSuccess = true;
          monthlyCost = updated.effectiveMonthly || Math.round((updated.amount / duration) * 100) / 100;
        }
      } else if (tagName === 'Emergency') {
        const updated = await updateTransaction(rowOrId, {
          tag: 'Emergency',
          type: 'debit',
        });
        if (updated) updateSuccess = true;
      } else {
        const updated = await updateTransaction(rowOrId, {
          tag: tagName as TransactionTag,
        });
        if (updated) updateSuccess = true;
      }
      logInfo('Updated transaction in MongoDB from Telegram button', { id: rowOrId, tag: tagName, duration, monthlyCost });
    } catch (err) {
      logError('Failed to update transaction in MongoDB via Telegram callback', err);
    }
  }

  // Edit original Telegram message to show confirmation
  if (messageId) {
    const origText = callbackQuery.message?.text || '';
    let headerAndDetails = '';
    if (origText.includes('━━━━━━━━━━━━━━━━━━')) {
      const textParts = origText.split('━━━━━━━━━━━━━━━━━━');
      if (textParts.length >= 2) {
        const safeHeader = textParts[0].trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeDetails = textParts[1].trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        headerAndDetails = `<b>${safeHeader}</b>\n━━━━━━━━━━━━━━━━━━\n${safeDetails}\n━━━━━━━━━━━━━━━━━━\n`;
      }
    }

    let confirmationText = headerAndDetails;
    if (duration > 1) {
      const perMo = monthlyCost > 0 ? ` (₹${monthlyCost.toLocaleString('en-IN')}/mo)` : '';
      confirmationText += `✅ <b>Amortized over ${duration} months${perMo}</b>`;
      if (updateSuccess) {
        confirmationText += `\n💾 <i>Database updated!</i>`;
      }
    } else if (tagName === 'Emergency') {
      confirmationText += `✅ <b>Tagged as: Emergency</b> (Excluded from monthly baseline)`;
      if (updateSuccess) {
        confirmationText += `\n💾 <i>Database updated!</i>`;
      }
    } else {
      confirmationText += `✅ <b>Tagged as: ${tagName}</b>`;
      if (updateSuccess) {
        confirmationText += `\n💾 <i>Database updated!</i>`;
      }
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
      `📊 <b>Commands:</b>\n` +
      `• <b>/summary</b> - Monthly spending breakdown & burn rate\n` +
      `• <b>/renewals</b> - Track 3m, 6m, and 12m subscription renewals`
    );
    return;
  }

  // 2. /summary command
  if (trimmed.startsWith('/summary') || trimmed.toLowerCase() === 'summary') {
    const summaryData = await fetchMonthlySummaryFromDb();
    await sendMonthlySummaryAlert(summaryData, chatId);
    return;
  }

  // 3. /renewals or /subscriptions command
  if (
    trimmed.startsWith('/renewals') ||
    trimmed.startsWith('/subscriptions') ||
    trimmed.toLowerCase() === 'renewals' ||
    trimmed.toLowerCase() === 'subscriptions'
  ) {
    // Optional days parameter, e.g. "/renewals 60"
    const parts = trimmed.split(/\s+/);
    const customDays = parts.length > 1 ? parseInt(parts[1], 10) : 45;
    const daysAhead = isNaN(customDays) ? 45 : customDays;

    const renewals = await fetchSubscriptionRenewals(daysAhead);
    await sendAllSubscriptionsList(renewals, chatId);
    return;
  }

  // 4. User sent a manual expense text (e.g. "500 cash chai" or "12000 wifi")
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

    // Save directly to MongoDB Atlas
    let dbTxId: string | undefined;
    try {
      const typeLower = parsed.type.toLowerCase();
      let txType: 'debit' | 'credit' | 'transfer' = 'debit';
      if (typeLower.includes('credit')) txType = 'credit';
      else if (typeLower.includes('transfer')) txType = 'transfer';

      const tag: TransactionTag =
        parsed.suggestedTag === 'Emergency' ? 'Emergency' : (parsed.suggestedTag === 'Transfer' ? 'Transfer' : 'Normal');

      const saved = await createTransaction({
        title: parsed.title,
        amount: parsed.amount,
        type: txType,
        category: parsed.category || 'Manual Spend',
        tag,
        effectiveMonthly: parsed.effectiveMonthlyCost || parsed.amount,
        rawSms: trimmed,
        date: new Date(),
        source: 'telegram',
      });
      dbTxId = saved._id?.toString();
      logInfo('Saved manual Telegram transaction to MongoDB', { id: dbTxId, title: parsed.title, amount: parsed.amount });
    } catch (dbErr) {
      logError('Failed to save manual Telegram transaction to MongoDB', dbErr);
    }

    const rowOrId = dbTxId || '0';
    const safeTitle = escapeHtml(parsed.title);
    const safeType = escapeHtml(parsed.type);

    if (parsed.type === 'Transfer' || parsed.suggestedTag === 'Transfer') {
      const confirmText =
        `💳 <b>Logged Transfer: ₹${parsed.amount.toLocaleString('en-IN')}</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📌 <b>${safeTitle}</b>\n` +
        `ℹ️ <i>Excluded from Monthly Burn & Net Cash Flow.</i>`;
      await sendTelegramMessage(chatId, confirmText);
      return;
    }

    const confirmText =
      `✅ <b>Logged: ₹${parsed.amount.toLocaleString('en-IN')}</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📌 <b>${safeTitle}</b> (${safeType})\n` +
      `📊 <i>Logged as <b>Normal</b> by default. Split across multiple months:</i>`;

    await sendTelegramMessage(chatId, confirmText, getDefaultAlertKeyboard(rowOrId));
  } catch (err) {
    logError('Error logging manual Telegram transaction', err);
    await sendTelegramMessage(chatId, `❌ Failed to log transaction: ${escapeHtml(err instanceof Error ? err.message : 'Unknown error')}`);
  }
}

