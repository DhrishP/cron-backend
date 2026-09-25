import { ParsedTransaction, TransactionType, ExpenseTag } from '../types/index.js';

export function cleanMacroDroidArtifacts(str: string): string {
  return str
    .replace(/\[(?:not_text|not_big_text|not_title|not_app_name|not_app_title|notification|sms_message|sms_number)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBankSms(rawSms: string, rawSender = ''): ParsedTransaction {
  const timestamp = new Date().toISOString();
  const sms = cleanMacroDroidArtifacts(rawSms);
  const sender = cleanMacroDroidArtifacts(rawSender);

  // 1. Detect Amount (handles "Rs. 1,250.00", "₹1500", "Debit 1500", "Paid 500", "1500 debited", etc.)
  let amount = 0;
  const amountPatterns = [
    /(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:Rs\.?|INR|₹)/i,
    /(?:debited|debit|paid|spent|sent|transferred|withdrawn|credited|credit|received|refund)\s*(?:by|for|with|of)?\s*(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:debited|debit|paid|spent|sent|credited|credit|received)/i,
    /\b([0-9]{2,7}(?:\.[0-9]{1,2})?)\b/, // Fallback to bare number if surrounded by transaction text
  ];

  for (const pattern of amountPatterns) {
    const match = sms.match(pattern);
    if (match && match[1]) {
      const parsedVal = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsedVal) && parsedVal > 0) {
        amount = parsedVal;
        break;
      }
    }
  }

  // 2. Detect Transaction Type
  let type: TransactionType = 'Debit';
  if (/credited|credit|received|refund|deposited|cashback/i.test(sms)) {
    type = 'Credit';
  } else if (/ATM|cash wdl|cash withdrawal|withdrawn at/i.test(sms)) {
    type = 'ATM / Cash';
  }

  // 3. Extract Merchant / Recipient
  let merchant = sender || 'Unknown Merchant';
  if (type === 'ATM / Cash') {
    merchant = 'ATM Cash Withdrawal';
  } else {
    const merchantMatch = sms.match(/(?:to|at|vpa|info|towards|for)\s+([A-Za-z0-9\.\-_&@ ]{2,35}?)(?:\s+(?:on|ref|upi|avl|bal|using|via|annual|subscription|\.|$))/i) ||
                          sms.match(/(?:to|at|vpa|info|towards|for)\s+([A-Za-z0-9\.\-_&@ ]{2,30})/i);
    if (merchantMatch && merchantMatch[1]) {
      merchant = merchantMatch[1].trim();
    } else {
      // Check for known bank/UPI names in text (e.g. "hdfc", "sbi", "swiggy")
      const knownEntity = sms.match(/\b(hdfc|sbi|icici|axis|kotak|paytm|phonepe|gpay|swiggy|zomato|amazon|flipkart|uber|ola)\b/i);
      if (knownEntity && knownEntity[1]) {
        merchant = knownEntity[1].toUpperCase();
      }
    }
  }

  // 4. Extract Account / Card identifier
  let account = sender || 'Bank';
  const accMatch = sms.match(/(?:a\/c|acct|acc|card)\s*(?:no\.?)?\s*([xX*]*\d{3,4})/i);
  if (accMatch && accMatch[1]) {
    account = `A/c ${accMatch[1]}`;
  } else if (/\b(hdfc|sbi|icici|axis|kotak)\b/i.test(sms)) {
    const bankMatch = sms.match(/\b(hdfc|sbi|icici|axis|kotak)\b/i);
    if (bankMatch) account = `${bankMatch[1].toUpperCase()} A/c`;
  }

  // 5. Intelligent Tagging
  let suggestedTag: ExpenseTag = 'Normal';
  if (/annual|yearly|1-year|subscription|tank|broadband|act|fibernet/i.test(sms) || /annual|yearly|tank/i.test(merchant)) {
    suggestedTag = 'Yearly';
  } else if (/hospital|clinic|emergency|pharma|repair|plumber/i.test(sms)) {
    suggestedTag = 'Emergency';
  }

  // 6. Calculate Effective Monthly Cost
  let effectiveMonthlyCost = amount;
  if (suggestedTag === 'Yearly') {
    effectiveMonthlyCost = Math.round((amount / 12) * 100) / 100;
  } else if (suggestedTag === 'Emergency') {
    effectiveMonthlyCost = 0; // Excluded from monthly recurring baseline
  }

  // 7. Fallback category determination
  let category = 'General Expense';
  if (type === 'ATM / Cash') category = 'Cash & ATM';
  else if (suggestedTag === 'Yearly') category = 'Yearly Expenses';
  else if (suggestedTag === 'Emergency') category = 'Emergency';
  else if (type === 'Credit') category = 'Income / Refund';

  return {
    title: merchant,
    category,
    amount,
    type,
    merchant,
    account,
    rawSms: sms,
    suggestedTag,
    effectiveMonthlyCost,
    notes: `Parsed via regex rules as ${suggestedTag}`,
    timestamp,
    source: 'regex_fallback',
  };
}
