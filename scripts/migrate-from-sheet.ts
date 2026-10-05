import dotenv from 'dotenv';
import { getDb, ensureIndexes, getTransactionsCollection, getSubscriptionsCollection } from '../src/db/mongo.js';
import { seedCanonicalSubscriptionsIfEmpty } from '../src/services/subscriptions.service.js';
import { TransactionDoc, TransactionType } from '../src/types/models.js';

dotenv.config();

function parseDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (!val) return new Date();

  const s = String(val).trim();
  if (s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    // 00:00:00 IST is 18:30:00 UTC previous day, but noon UTC is safe for date identity
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

async function runMigration() {
  console.log('🚀 Starting Data Migration: Google Sheet → MongoDB Atlas');
  await ensureIndexes();

  // 1. Seed the 13 Canonical Subscriptions
  console.log('\n📦 Step 1: Seeding Subscriptions Registry...');
  const seededCount = await seedCanonicalSubscriptionsIfEmpty();
  const subCol = await getSubscriptionsCollection();
  const totalSubs = await subCol.countDocuments();
  console.log(`✅ Subscriptions in MongoDB: ${totalSubs} (New seeded: ${seededCount})`);

  // 2. Fetch all rows from Google Sheet
  const sheetUrl = (process.env.GOOGLE_SHEET_WEBHOOK_URL || '').replace(/['"]/g, '').trim();
  if (!sheetUrl) {
    console.error('❌ GOOGLE_SHEET_WEBHOOK_URL not configured');
    process.exit(1);
  }

  console.log('\n📥 Step 2: Fetching transactions from Google Sheet...');
  const fetchUrl = `${sheetUrl}${sheetUrl.includes('?') ? '&' : '?'}action=get_recent&limit=1000`;
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch from sheet: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    status?: string;
    transactions?: Array<{
      date: string;
      title: string;
      type: string;
      amount: number | string;
      tag: string;
      effective: number | string;
      raw: string;
    }>;
  };

  const rows = data.transactions || [];
  console.log(`📄 Retrieved ${rows.length} total rows from Google Sheet.`);

  // 3. Process every sheet row cleanly WITHOUT fabricated categories
  const processedDocs: TransactionDoc[] = [];

  for (const row of rows) {
    const amount = typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount)) || 0;
    const title = (row.title || '').trim();
    const raw = (row.raw || '').trim();
    const rawType = (row.type || 'Debit').trim();
    const rawTag = (row.tag || 'Normal').trim();

    if (!title || title === 'Unknown') {
      continue;
    }

    const date = parseDate(row.date);
    let txType: TransactionType = 'debit';
    const lowerType = rawType.toLowerCase();
    if (lowerType.includes('credit')) {
      txType = 'credit';
    } else if (lowerType.includes('amortized')) {
      txType = 'amortized';
    } else if (lowerType.includes('transfer')) {
      txType = 'transfer';
    }

    const effective = typeof row.effective === 'number'
      ? row.effective
      : parseFloat(String(row.effective)) || amount;

    processedDocs.push({
      date,
      title,
      type: txType,
      amount,
      tag: rawTag || 'Normal',
      effectiveMonthly: effective,
      rawSms: raw || title,
      source: 'sheet_migration',
      createdAt: date,
      updatedAt: new Date(),
    });
  }

  console.log(`✅ Processed ${processedDocs.length} valid transactions from sheet.`);

  // 4. Overwrite transactions collection with authentic sheet data
  console.log('\n💾 Step 4: Syncing transactions into MongoDB Atlas...');
  const txCol = await getTransactionsCollection();
  
  // Clear previous migrated transactions to eliminate fake categories and duplicates
  await txCol.deleteMany({});
  console.log('🗑️ Cleared previous transactions collection.');

  if (processedDocs.length > 0) {
    const insertResult = await txCol.insertMany(processedDocs);
    console.log(`🎉 Inserted ${insertResult.insertedCount} authentic transactions into MongoDB.`);
  }

  // 5. Verification query for Oct 2026
  // October 2026 IST starts at 2026-09-30T18:30:00.000Z and ends at 2026-10-31T18:30:00.000Z
  const octStart = new Date(Date.UTC(2026, 8, 30, 18, 30, 0));
  const octEnd = new Date(Date.UTC(2026, 9, 31, 18, 30, 0));

  const octTxs = await txCol.find({
    date: { $gte: octStart, $lt: octEnd }
  }).toArray();

  let regularDebits = 0;
  let credits = 0;
  let transfers = 0;
  let amortizedMonthly = 0;

  for (const t of octTxs) {
    if (t.type === 'credit') {
      credits += t.amount;
    } else if (t.tag === 'Transfer' || t.type === 'transfer') {
      transfers += t.amount;
    } else if (t.type === 'amortized' || (t.tag && t.tag.includes('Amortized'))) {
      amortizedMonthly += (t.effectiveMonthly || t.amount);
    } else if (t.type === 'debit') {
      regularDebits += t.amount;
    }
  }

  console.log('\n📊 October 2026 Verification:');
  console.log(`- Total Rows: ${octTxs.length}`);
  console.log(`- Regular Debits: ₹${regularDebits.toFixed(2)}`);
  console.log(`- Credits: ₹${credits.toFixed(2)}`);
  console.log(`- Transfers: ₹${transfers.toFixed(2)}`);
  console.log(`- Amortized Monthly: ₹${amortizedMonthly.toFixed(2)}`);
  console.log(`- Total Burn: ₹${(regularDebits + amortizedMonthly).toFixed(2)}`);

  process.exit(0);
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
