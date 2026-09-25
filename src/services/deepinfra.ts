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

  const systemPrompt = `You are an expert financial assistant analyzing transactional SMS messages in India (UPI, cards, net banking, ATM).
Your task is to accurately extract transaction details and categorize them into clean, structured JSON.

Allowed categories:
- "Food & Dining"
- "Groceries"
- "Utilities & Internet"
- "Household Maintenance"
- "Healthcare"
- "Shopping"
- "Transport"
- "Entertainment"
- "Income"
- "Transfers"
- "Cash & ATM"
- "Other"

Allowed tags:
- "1-Year Sub": For annual plans/subscriptions (e.g., 1-year broadband/fibernet, annual Amazon/Netflix, domain renewals).
- "Home / Tank Maintenance": For periodic infrequent household services (e.g., water tank cleaning, AC service, deep cleaning).
- "Emergency": For unexpected urgent expenses (e.g., hospital, emergency clinic, urgent plumbing/appliance breakdown).
- "Petty Cash": For ATM cash withdrawals under ₹1,000-2,000.
- "Normal": For standard daily transactions.

Calculate effectiveMonthlyCost:
- If tag is "1-Year Sub" or "Home / Tank Maintenance": amount / 12
- If tag is "Emergency": 0 (so it doesn't skew monthly living budget)
- Otherwise: amount

Return ONLY a valid JSON object matching this schema:
{
  "title": "Clean Merchant Name (e.g. ACT Fibernet, Swiggy, Water Tank Cleaning)",
  "category": "Exact Category Name",
  "amount": 12000,
  "type": "Debit" | "Credit" | "ATM / Cash",
  "merchant": "Merchant or entity",
  "account": "e.g. A/c XX4321",
  "tag": "Normal" | "1-Year Sub" | "Emergency" | "Petty Cash" | "Home / Tank Maintenance",
  "effectiveMonthlyCost": 1000,
  "notes": "Brief explanation of tag and categorization"
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
    if (tag === '1-Year Sub' || tag === 'Home / Tank Maintenance') {
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
