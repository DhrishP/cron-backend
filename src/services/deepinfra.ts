import { ParsedTransaction, ExpenseTag, TransactionType } from '../types/index.js';
import { logInfo, logError } from './logger.js';
import { parseBankSms } from './smsParser.js';

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

export async function categorizeWithDeepInfra(sms: string, sender = ''): Promise<ParsedTransaction> {
  const apiKey = process.env.DEEPINFRA_API_KEY;

  // Fallback to local regex engine if API key is not provided
  if (!apiKey) {
    logInfo('DEEPINFRA_API_KEY is not set. Using local regex parser.');
    return parseBankSms(sms, sender);
  }

  const model = process.env.DEEPINFRA_MODEL || 'meta-llama/Meta-Llama-3.1-8B-Instruct';

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
      return parseBankSms(sms, sender);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      logError('DeepInfra returned empty response content', data);
      return parseBankSms(sms, sender);
    }

    const parsedAi: DeepInfraJsonResponse = JSON.parse(rawContent);
    const durationMs = Date.now() - startTime;

    logInfo(`DeepInfra AI structured classification completed in ${durationMs}ms`, {
      title: parsedAi.title,
      category: parsedAi.category,
      tag: parsedAi.tag,
      amount: parsedAi.amount,
    });

    const amount = typeof parsedAi.amount === 'number' ? parsedAi.amount : 0;
    const tag: ExpenseTag = parsedAi.tag || 'Normal';

    // Verify / compute effectiveMonthlyCost safely
    let effectiveMonthlyCost = amount;
    if (tag === 'Yearly') {
      effectiveMonthlyCost = Math.round((amount / 12) * 100) / 100;
    } else if (tag === 'Emergency') {
      effectiveMonthlyCost = 0;
    }

    return {
      title: parsedAi.title || parsedAi.merchant || 'Expense',
      category: parsedAi.category || 'General Expense',
      amount,
      type: parsedAi.type || 'Debit',
      merchant: parsedAi.merchant || parsedAi.title || 'Unknown',
      account: parsedAi.account || sender,
      rawSms: sms,
      suggestedTag: tag,
      effectiveMonthlyCost,
      notes: parsedAi.notes || 'Categorized with DeepInfra AI',
      timestamp: new Date().toISOString(),
      source: 'ai_deepinfra',
    };
  } catch (error) {
    logError('DeepInfra categorization failed, falling back to regex', error);
    return parseBankSms(sms, sender);
  }
}
