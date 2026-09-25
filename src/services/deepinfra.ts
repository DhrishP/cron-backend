import { ParsedTransaction, ExpenseTag, TransactionType } from '../types/index.js';
import { logInfo, logError } from './logger.js';
import { parseBankSms, cleanMacroDroidArtifacts } from './smsParser.js';

interface DeepInfraJsonResponse {
  title?: string;
  category?: string;
  amount?: number;
  type?: TransactionType;
  merchant?: string;
  account?: string;
  tag?: ExpenseTag;
  effectiveMonthlyCost?: number;
  notes?: string;
}

export async function categorizeWithDeepInfra(rawSms: string, rawSender = ''): Promise<ParsedTransaction> {
  const sms = cleanMacroDroidArtifacts(rawSms);
  const sender = cleanMacroDroidArtifacts(rawSender);
  const regexFallback = parseBankSms(sms, sender);

  const apiKey = process.env.DEEPINFRA_API_KEY;

  // Fallback to local regex engine if API key is not provided
  if (!apiKey) {
    logInfo('DEEPINFRA_API_KEY is not set. Using local regex parser.');
    return regexFallback;
  }

  const model = process.env.DEEPINFRA_MODEL || 'deepseek-ai/DeepSeek-V4-Flash-0731';

  const systemPrompt = `You are an expert financial assistant analyzing transactional SMS messages in India.
Your task is to extract transaction details into clean JSON.

Tags:
- "Yearly": For annual subscriptions, once-a-year expenses (e.g. 1-year internet, annual tank cleaning, yearly insurance).
- "Emergency": For sudden unexpected emergency expenses (hospital, urgent repair).
- "Normal": For standard day-to-day spending.

Calculate effectiveMonthlyCost:
- If tag is "Yearly": amount / 12
- If tag is "Emergency": 0
- Otherwise: amount

Return ONLY a valid JSON object matching this schema:
{
  "title": "Clean Merchant Name (e.g. ACT Fibernet, Swiggy, Water Tank Cleaning)",
  "category": "Category Name (e.g. Utilities, Food, Household, Health)",
  "amount": 12000,
  "type": "Debit" | "Credit" | "ATM / Cash",
  "merchant": "Merchant name",
  "account": "e.g. A/c XX4321",
  "tag": "Normal" | "Yearly" | "Emergency",
  "effectiveMonthlyCost": 1000,
  "notes": "Brief explanation"
}`;

  try {
    const startTime = Date.now();
    const response = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `SMS text: "${sms}"\nSender: "${sender}"` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`DeepInfra API responded with HTTP ${response.status}`, errorText);
      return regexFallback;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      logError('DeepInfra returned empty response content', data);
      return regexFallback;
    }

    const parsedAi: DeepInfraJsonResponse = JSON.parse(rawContent);
    const durationMs = Date.now() - startTime;

    logInfo(`DeepInfra AI structured classification completed in ${durationMs}ms`, {
      title: parsedAi.title,
      category: parsedAi.category,
      tag: parsedAi.tag,
      amount: parsedAi.amount,
    });

    let amount = typeof parsedAi.amount === 'number' && parsedAi.amount > 0 ? parsedAi.amount : 0;
    // Ground-truth fallback: If AI didn't catch amount but regex did, use regex amount!
    if (amount <= 0 && regexFallback.amount > 0) {
      amount = regexFallback.amount;
    }

    const tag: ExpenseTag = parsedAi.tag || regexFallback.suggestedTag || 'Normal';
    const type: TransactionType = parsedAi.type || regexFallback.type || 'Debit';
    const title = (parsedAi.title && parsedAi.title !== 'Expense' && parsedAi.title !== 'Unknown')
      ? parsedAi.title
      : regexFallback.title;
    const merchant = (parsedAi.merchant && parsedAi.merchant !== 'Unknown')
      ? parsedAi.merchant
      : regexFallback.merchant;
    const account = parsedAi.account || regexFallback.account || sender || 'Bank';

    // Verify / compute effectiveMonthlyCost safely
    let effectiveMonthlyCost = amount;
    if (tag === 'Yearly') {
      effectiveMonthlyCost = Math.round((amount / 12) * 100) / 100;
    } else if (tag === 'Emergency') {
      effectiveMonthlyCost = 0;
    }

    return {
      title,
      category: parsedAi.category || regexFallback.category || 'General Expense',
      amount,
      type,
      merchant,
      account,
      rawSms: rawSms,
      suggestedTag: tag,
      effectiveMonthlyCost,
      notes: parsedAi.notes || 'Categorized with DeepInfra AI',
      timestamp: new Date().toISOString(),
      source: 'ai_deepinfra',
    };
  } catch (error) {
    logError('DeepInfra categorization failed, falling back to regex', error);
    return regexFallback;
  }
}
