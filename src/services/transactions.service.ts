import { ObjectId, Filter } from 'mongodb';
import { getTransactionsCollection } from '../db/mongo.js';
import { TransactionDoc, TransactionType, TransactionTag } from '../types/models.js';
import { logInfo, logError } from './logger.js';

export interface TransactionFilterOptions {
  month?: number; // 0-indexed (0 = Jan, 9 = Oct)
  year?: number;
  type?: TransactionType;
  category?: string;
  tag?: TransactionTag;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'date' | 'amount';
  sortOrder?: 'asc' | 'desc';
}

export function getISTMonthRange(month: number, year: number): { start: Date; end: Date } {
  // IST is UTC + 5:30.
  // 1st day of month 00:00:00 IST is previous month's last day 18:30:00 UTC.
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 5.5 * 3600 * 1000);
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - 5.5 * 3600 * 1000);
  return { start, end };
}

export async function createTransaction(
  data: Omit<TransactionDoc, '_id' | 'createdAt' | 'updatedAt'>
): Promise<TransactionDoc> {
  const col = await getTransactionsCollection();
  const now = new Date();

  const doc: TransactionDoc = {
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function getTransactions(options: TransactionFilterOptions = {}): Promise<{
  transactions: TransactionDoc[];
  total: number;
}> {
  const col = await getTransactionsCollection();
  const query: Filter<TransactionDoc> = {};

  if (options.year !== undefined && options.month !== undefined) {
    const { start, end } = getISTMonthRange(options.month, options.year);
    query.date = { $gte: start, $lt: end };
  } else if (options.year !== undefined) {
    const { start } = getISTMonthRange(0, options.year);
    const { end } = getISTMonthRange(11, options.year);
    query.date = { $gte: start, $lt: end };
  }

  if (options.type) {
    if (options.type === 'amortized') {
      query.$or = [
        { type: 'amortized' },
        { tag: { $regex: 'Amortized', $options: 'i' } }
      ];
    } else if (options.type === 'transfer') {
      query.$or = [
        { type: 'transfer' },
        { tag: 'Transfer' }
      ];
    } else if (options.type === 'debit') {
      query.type = 'debit';
      query.tag = { $ne: 'Transfer' };
    } else {
      query.type = options.type;
    }
  }

  if (options.tag) {
    query.tag = options.tag;
  }

  if (options.category) {
    query.category = options.category;
  }

  if (options.search) {
    query.$or = [
      { title: { $regex: options.search, $options: 'i' } },
      { tag: { $regex: options.search, $options: 'i' } },
      { rawSms: { $regex: options.search, $options: 'i' } },
    ];
  }

  const limit = options.limit !== undefined ? options.limit : 500;
  const skip = options.offset || 0;

  let queryBuilder = col.find(query);
  if (skip > 0) queryBuilder = queryBuilder.skip(skip);
  if (limit > 0) queryBuilder = queryBuilder.limit(limit);

  const [transactions, total] = await Promise.all([
    queryBuilder.toArray(),
    col.countDocuments(query),
  ]);

  const sortBy = options.sortBy || 'date';
  const sortOrder = options.sortOrder || 'desc';

  transactions.sort((a, b) => {
    if (sortBy === 'amount') {
      const aVal = a.amount;
      const bVal = b.amount;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    }

    // Default Date sorting: debits/credits/transfers first by date descending, amortized last
    const aAmort = a.type === 'amortized' || (a.tag && a.tag.toLowerCase().includes('amortized'));
    const bAmort = b.type === 'amortized' || (b.tag && b.tag.toLowerCase().includes('amortized'));

    if (!aAmort && bAmort) return -1;
    if (aAmort && !bAmort) return 1;

    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    return sortOrder === 'asc' ? -diff : diff;
  });

  return { transactions, total };
}

export async function getRecentTransactionsForDeduplication(limit = 10): Promise<TransactionDoc[]> {
  const col = await getTransactionsCollection();
  return col.find().sort({ date: -1 }).limit(limit).toArray();
}

export async function deleteTransaction(id: string | ObjectId): Promise<boolean> {
  const col = await getTransactionsCollection();
  const objectId = typeof id === 'string' ? new ObjectId(id) : id;
  const result = await col.deleteOne({ _id: objectId });
  return result.deletedCount === 1;
}

export async function updateTransaction(
  id: string | ObjectId,
  updates: Partial<TransactionDoc>
): Promise<TransactionDoc | null> {
  const col = await getTransactionsCollection();
  const objectId = typeof id === 'string' ? new ObjectId(id) : id;

  await col.updateOne(
    { _id: objectId },
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    }
  );

  return col.findOne({ _id: objectId });
}

export async function amortizeTransaction(
  id: string | ObjectId,
  durationMonths: number
): Promise<TransactionDoc | null> {
  const col = await getTransactionsCollection();
  const objectId = typeof id === 'string' ? new ObjectId(id) : id;
  const existing = await col.findOne({ _id: objectId });

  if (!existing) return null;

  const monthlyShare = Math.round((existing.amount / durationMonths) * 100) / 100;

  await col.updateOne(
    { _id: objectId },
    {
      $set: {
        type: 'amortized',
        tag: `Amortized (${durationMonths}mo)`,
        effectiveMonthly: monthlyShare,
        amortization: {
          isAmortized: true,
          durationMonths,
          monthlyShare,
        },
        updatedAt: new Date(),
      },
    }
  );

  return col.findOne({ _id: objectId });
}

export async function getMonthlyCashFlowMetrics(month: number, year: number): Promise<{
  actualCashDebited: number;
  totalCredited: number;
  netCashFlow: number;
  regularSpends: number;
  emergencySpends: number;
  transferAmount: number;
  amortizedMonthly: number;
  transactionCount: number;
}> {
  const col = await getTransactionsCollection();
  const { start, end } = getISTMonthRange(month, year);

  const txs = await col
    .find({
      date: { $gte: start, $lt: end },
    })
    .toArray();

  let actualCashDebited = 0;
  let totalCredited = 0;
  let regularSpends = 0;
  let emergencySpends = 0;
  let transferAmount = 0;
  let amortizedMonthly = 0;
  const count = txs.length;

  for (const t of txs) {
    const isTransfer = t.tag === 'Transfer' || t.type === 'transfer';
    const isCredit = t.type === 'credit';
    const isAmortized = t.type === 'amortized' || (t.tag && t.tag.toLowerCase().includes('amortized'));

    if (isTransfer) {
      transferAmount += t.amount;
    } else if (isCredit) {
      totalCredited += t.amount;
    } else if (isAmortized) {
      amortizedMonthly += (t.effectiveMonthly || t.amount);
    } else {
      // Regular or Emergency debit
      actualCashDebited += t.amount;
      if (t.tag === 'Emergency') {
        emergencySpends += t.amount;
      } else {
        regularSpends += t.amount;
      }
    }
  }

  const netCashFlow = totalCredited - actualCashDebited;

  return {
    actualCashDebited: Math.round(actualCashDebited * 100) / 100,
    totalCredited: Math.round(totalCredited * 100) / 100,
    netCashFlow: Math.round(netCashFlow * 100) / 100,
    regularSpends: Math.round(regularSpends * 100) / 100,
    emergencySpends: Math.round(emergencySpends * 100) / 100,
    transferAmount: Math.round(transferAmount * 100) / 100,
    amortizedMonthly: Math.round(amortizedMonthly * 100) / 100,
    transactionCount: count,
  };
}
