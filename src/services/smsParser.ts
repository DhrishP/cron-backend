import { ParsedTransaction, TransactionType, ExpenseTag } from '../types/index.js';

export function parseBankSms(sms: string, sender = ''): ParsedTransaction {
  const timestamp = new Date().toISOString();

  // 1. Detect Amount (handles "Rs. 1,250.00", "INR 500", "debited by 350.00", etc.)
  let amount = 0;
  const amountMatch = sms.match(/(?:Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
                      sms.match(/(?:debited|credited)\s*(?:by|for|with)?\s*(?:Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (amountMatch && amountMatch[1]) {
    amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  }

  // 2. Detect Transaction Type
  let type: TransactionType = 'Debit';
  if (/credited|received|refund|deposited/i.test(sms)) {
    type = 'Credit';
  } else if (/ATM|cash wdl|cash withdrawal|withdrawn at/i.test(sms)) {
    type = 'ATM / Cash';
  }

  // 3. Extract Merchant / Recipient
  let merchant = 'Unknown Merchant';
  if (type === 'ATM / Cash') {
    merchant = 'ATM Cash Withdrawal';
  } else {
    const merchantMatch = sms.match(/(?:to|at|vpa|info|towards|for)\s+([A-Za-z0-9\.\-_&@ ]{2,35}?)(?:\s+(?:on|ref|upi|avl|bal|using|via|annual|subscription|\.|$))/i) ||
                          sms.match(/(?:to|at|vpa|info|towards|for)\s+([A-Za-z0-9\.\-_&@ ]{2,30})/i);
    if (merchantMatch && merchantMatch[1]) {
      merchant = merchantMatch[1].trim();
    }
  }

  // 4. Extract Account / Card identifier
  let account = sender;
  const accMatch = sms.match(/(?:a\/c|acct|acc|card)\s*(?:no\.?)?\s*([xX*]*\d{3,4})/i);
  if (accMatch && accMatch[1]) {
    account = `A/c ${accMatch[1]}`;
  }

  // 5. Intelligent Tagging
  let suggestedTag: ExpenseTag = 'Normal';
  if (type === 'ATM / Cash') {
    suggestedTag = 'Petty Cash';
  } else if (/annual|yearly|1-year|subscription|fibernet|broadband|act|airtel.*xstream|jiofiber/i.test(sms) || /annual|yearly/i.test(merchant)) {
    suggestedTag = '1-Year Sub';
  } else if (/hospital|clinic|emergency|pharma|repair|tank|plumber/i.test(sms) || /tank/i.test(merchant)) {
    suggestedTag = /tank/i.test(sms) || /tank/i.test(merchant) ? 'Home / Tank Maintenance' : 'Emergency';
  }

  // 6. Calculate Effective Monthly Cost
  let effectiveMonthlyCost = amount;
  if (suggestedTag === '1-Year Sub' || suggestedTag === 'Home / Tank Maintenance') {
    effectiveMonthlyCost = Math.round((amount / 12) * 100) / 100;
  } else if (suggestedTag === 'Emergency') {
    effectiveMonthlyCost = 0; // Excluded from monthly recurring baseline
  }

  return {
    amount,
    type,
    merchant,
    account,
    rawSms: sms,
    suggestedTag,
    effectiveMonthlyCost,
    timestamp,
  };
}
