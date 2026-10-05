import dotenv from 'dotenv';
import { getTransactionsCollection, getSubscriptionsCollection } from '../src/db/mongo.js';

dotenv.config();

const API_BASE = 'https://cron-backend-phi.vercel.app';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: boolean, suite: string, name: string, details?: unknown) {
  if (condition) {
    results.push({ suite, name, passed: true, details });
    console.log(`  ✅ [PASS] ${suite} -> ${name}`);
  } else {
    results.push({ suite, name, passed: false, error: 'Assertion failed', details });
    console.error(`  ❌ [FAIL] ${suite} -> ${name}`, details ? JSON.stringify(details) : '');
  }
}

async function runLiveApiTests() {
  console.log('\n========================================');
  console.log('🧪 SUITE 1: Live Production API Verification');
  console.log(`Target: ${API_BASE}`);
  console.log('========================================');

  // Test 1.1: Monthly Summary
  try {
    const res = await fetch(`${API_BASE}/api/finance/summary?month=9&year=2026`);
    const data = await res.json();
    assert(data.success === true, 'API /finance/summary', 'Success status is true');
    const s = data.summary;
    assert(s.period === 'October 2026', 'API /finance/summary', 'Period is October 2026', s.period);
    assert(s.totalDebited === 12493.17, 'API /finance/summary', 'totalDebited === 12493.17', s.totalDebited);
    assert(s.totalCredited === 1012, 'API /finance/summary', 'totalCredited === 1012', s.totalCredited);
    assert(s.netCashFlow === -11481.17, 'API /finance/summary', 'netCashFlow === -11481.17', s.netCashFlow);
    assert(s.effectiveMonthlyBurn === 15944.6, 'API /finance/summary', 'effectiveMonthlyBurn === 15944.60', s.effectiveMonthlyBurn);
    assert(s.normalSpends === 12493.17, 'API /finance/summary', 'normalSpends === 12493.17', s.normalSpends);
    assert(s.subscriptionsBurn === 3451.43, 'API /finance/summary', 'subscriptionsBurn === 3451.43', s.subscriptionsBurn);
    assert(s.transactionCount === 45, 'API /finance/summary', 'transactionCount === 45', s.transactionCount);
    assert(s.subscriptionsCount === 13, 'API /finance/summary', 'subscriptionsCount === 13', s.subscriptionsCount);
  } catch (err) {
    assert(false, 'API /finance/summary', 'Failed with exception', err);
  }

  // Test 1.2: Filter All
  try {
    const res = await fetch(`${API_BASE}/api/transactions?month=9&year=2026&limit=100`);
    const data = await res.json();
    assert(data.success === true, 'API /transactions (all)', 'Success is true');
    assert(data.total === 45, 'API /transactions (all)', 'Total is 45', data.total);
    assert(data.transactions.length === 45, 'API /transactions (all)', 'Returned 45 items', data.transactions.length);
  } catch (err) {
    assert(false, 'API /transactions (all)', 'Failed with exception', err);
  }

  // Test 1.3: Filter Credit
  try {
    const res = await fetch(`${API_BASE}/api/transactions?month=9&year=2026&type=credit`);
    const data = await res.json();
    assert(data.success === true, 'API /transactions (credit)', 'Success is true');
    assert(data.total === 1, 'API /transactions (credit)', 'Total credit is 1', data.total);
    const tx = data.transactions[0];
    assert(tx?.amount === 1012, 'API /transactions (credit)', 'Credit amount is 1012', tx?.amount);
    assert(tx?.title === 'CASA Credit Interest Capitalized', 'API /transactions (credit)', 'Credit title matches', tx?.title);
  } catch (err) {
    assert(false, 'API /transactions (credit)', 'Failed with exception', err);
  }

  // Test 1.4: Filter Amortized
  try {
    const res = await fetch(`${API_BASE}/api/transactions?month=9&year=2026&type=amortized`);
    const data = await res.json();
    assert(data.success === true, 'API /transactions (amortized)', 'Success is true');
    assert(data.total === 13, 'API /transactions (amortized)', 'Total amortized is 13', data.total);
    const sumEff = data.transactions.reduce((acc: number, t: { effectiveMonthly?: number; amount: number }) => acc + (t.effectiveMonthly || t.amount), 0);
    assert(Math.abs(sumEff - 3451.43) < 0.05, 'API /transactions (amortized)', 'Sum of effectiveMonthly is 3451.43', sumEff);
  } catch (err) {
    assert(false, 'API /transactions (amortized)', 'Failed with exception', err);
  }

  // Test 1.5: Filter Debit (Regular spends)
  try {
    const res = await fetch(`${API_BASE}/api/transactions?month=9&year=2026&type=debit`);
    const data = await res.json();
    assert(data.success === true, 'API /transactions (debit)', 'Success is true');
    assert(data.total === 30, 'API /transactions (debit)', 'Total regular debits is 30', data.total);
    const sumDebit = data.transactions.reduce((acc: number, t: { amount: number }) => acc + t.amount, 0);
    assert(Math.abs(sumDebit - 12493.17) < 0.05, 'API /transactions (debit)', 'Sum of debits is 12493.17', sumDebit);
  } catch (err) {
    assert(false, 'API /transactions (debit)', 'Failed with exception', err);
  }

  // Test 1.6: Filter Transfer
  try {
    const res = await fetch(`${API_BASE}/api/transactions?month=9&year=2026&type=transfer`);
    const data = await res.json();
    assert(data.success === true, 'API /transactions (transfer)', 'Success is true');
    assert(data.total === 1, 'API /transactions (transfer)', 'Total transfer is 1', data.total);
    assert(data.transactions[0]?.title === 'RAJESH UPI Transfer', 'API /transactions (transfer)', 'Title is RAJESH UPI Transfer', data.transactions[0]?.title);
    assert(data.transactions[0]?.amount === 12860, 'API /transactions (transfer)', 'Amount is 12860', data.transactions[0]?.amount);
  } catch (err) {
    assert(false, 'API /transactions (transfer)', 'Failed with exception', err);
  }

  // Test 1.7: Subscriptions List
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions`);
    const data = await res.json();
    assert(data.success === true, 'API /subscriptions', 'Success is true');
    assert(data.activeCount === 13, 'API /subscriptions', 'activeCount === 13', data.activeCount);
    assert(Math.abs(data.totalMonthlyCommitment - 3451.43) < 0.05, 'API /subscriptions', 'totalMonthlyCommitment === 3451.43', data.totalMonthlyCommitment);
    const hasHelperFields = data.subscriptions.every((s: { daysRemaining?: number; cycleLabel?: string }) => s.daysRemaining !== undefined && s.cycleLabel !== undefined);
    assert(hasHelperFields, 'API /subscriptions', 'Every subscription has daysRemaining and cycleLabel');
  } catch (err) {
    assert(false, 'API /subscriptions', 'Failed with exception', err);
  }

  // Test 1.8: Renewals List
  try {
    const res = await fetch(`${API_BASE}/api/finance/renewals`);
    const data = await res.json();
    assert(data.success === true, 'API /finance/renewals', 'Success is true');
    assert(Array.isArray(data.upcomingRenewals), 'API /finance/renewals', 'Returns array of upcoming renewals');
  } catch (err) {
    assert(false, 'API /finance/renewals', 'Failed with exception', err);
  }
}

async function runTransactionCrudTests() {
  console.log('\n========================================');
  console.log('🧪 SUITE 2: Transaction Full CRUD & Tag Switching Lifecycle');
  console.log('========================================');

  let testTxId = '';

  // Step 2.1: CREATE
  try {
    const res = await fetch(`${API_BASE}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'TEST_AUTOMATION_SPEND',
        amount: 888.88,
        type: 'debit',
        tag: 'Normal',
        date: new Date().toISOString(),
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Transaction CRUD', 'Create transaction 201');
    assert(data.transaction?._id !== undefined, 'Transaction CRUD', 'Returned valid _id');
    assert(data.transaction?.amount === 888.88, 'Transaction CRUD', 'Amount stored accurately');
    testTxId = data.transaction?._id;
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Create failed', err);
  }

  if (!testTxId) {
    console.error('Cannot proceed with CRUD tests without a created transaction ID');
    return;
  }

  // Step 2.2: PATCH - Title and Amount
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${testTxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'TEST_AUTOMATION_SPEND_EDITED',
        amount: 999.99,
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Transaction CRUD', 'Update title and amount');
    assert(data.transaction?.title === 'TEST_AUTOMATION_SPEND_EDITED', 'Transaction CRUD', 'Updated title persisted');
    assert(data.transaction?.amount === 999.99, 'Transaction CRUD', 'Updated amount persisted');
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Patch title/amount failed', err);
  }

  // Step 2.3: PATCH - Change Debit to Transfer
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${testTxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'transfer',
        tag: 'Transfer',
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Transaction CRUD', 'Switch Debit -> Transfer');
    assert(data.transaction?.type === 'transfer', 'Transaction CRUD', 'type === transfer persisted');
    assert(data.transaction?.tag === 'Transfer', 'Transaction CRUD', 'tag === Transfer persisted');
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Switch to transfer failed', err);
  }

  // Step 2.4: PATCH - Change Transfer back to Debit (The user prompt issue!)
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${testTxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'debit',
        tag: 'Normal',
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Transaction CRUD', 'Switch Transfer -> Debit');
    assert(data.transaction?.type === 'debit', 'Transaction CRUD', 'type === debit persisted');
    assert(data.transaction?.tag === 'Normal', 'Transaction CRUD', 'tag === Normal persisted');
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Switch transfer to debit failed', err);
  }

  // Step 2.5: PATCH - Amortize endpoint
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${testTxId}/amortize`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        durationMonths: 6,
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Transaction CRUD', 'Amortize transaction 6 months');
    assert(data.transaction?.type === 'amortized', 'Transaction CRUD', 'type === amortized');
    assert(data.transaction?.tag === 'Amortized (6mo)', 'Transaction CRUD', 'tag === Amortized (6mo)');
    assert(data.transaction?.effectiveMonthly === 166.67, 'Transaction CRUD', 'effectiveMonthly === 166.67 (999.99/6)');
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Amortize endpoint failed', err);
  }

  // Step 2.6: DELETE
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${testTxId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    assert(data.success === true, 'Transaction CRUD', 'Delete transaction 200');
    assert(data.message === 'Transaction deleted', 'Transaction CRUD', 'Delete message confirmed');
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Delete failed', err);
  }

  // Step 2.7: Verify deleted
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${testTxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ghost' }),
    });
    assert(res.status === 404, 'Transaction CRUD', 'Subsequent patch on deleted ID returns 404');
  } catch (err) {
    assert(false, 'Transaction CRUD', 'Verify delete failed', err);
  }
}

async function runSubscriptionCrudTests() {
  console.log('\n========================================');
  console.log('🧪 SUITE 3: Subscription Full Lifecycle & Status Toggle');
  console.log('========================================');

  let testSubId = '';

  // Step 3.1: CREATE
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'TEST_AUTOMATION_SERVICE',
        category: 'Utilities',
        totalAmount: 1200,
        billingCycleMonths: 12,
        notes: 'Integration test',
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Subscription Lifecycle', 'Create subscription 201');
    assert(data.subscription?.monthlyBaselineCost === 100, 'Subscription Lifecycle', 'monthlyBaselineCost === 100 (1200/12)');
    assert(data.subscription?.status === 'active', 'Subscription Lifecycle', 'status === active');
    testSubId = data.subscription?._id;
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Create subscription failed', err);
  }

  if (!testSubId) {
    console.error('Cannot proceed with subscription lifecycle without a valid testSubId');
    return;
  }

  // Step 3.2: TOGGLE ACTIVE -> PAUSED
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/${testSubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    const data = await res.json();
    assert(data.success === true, 'Subscription Lifecycle', 'Toggle Active -> Paused');
    assert(data.subscription?.status === 'paused', 'Subscription Lifecycle', 'status === paused persisted');
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Pause subscription failed', err);
  }

  // Step 3.3: TOGGLE PAUSED -> ACTIVE
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/${testSubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    const data = await res.json();
    assert(data.success === true, 'Subscription Lifecycle', 'Toggle Paused -> Active');
    assert(data.subscription?.status === 'active', 'Subscription Lifecycle', 'status === active persisted');
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Resume subscription failed', err);
  }

  // Step 3.4: UPDATE PRICE AND RECALCULATE BASELINE
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/${testSubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalAmount: 3600,
        billingCycleMonths: 12,
      }),
    });
    const data = await res.json();
    assert(data.success === true, 'Subscription Lifecycle', 'Update price and cycle');
    assert(data.subscription?.totalAmount === 3600, 'Subscription Lifecycle', 'totalAmount === 3600 persisted');
    assert(data.subscription?.monthlyBaselineCost === 300, 'Subscription Lifecycle', 'monthlyBaselineCost recalculated to 300');
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Update price failed', err);
  }

  // Step 3.5: RENEW SUBSCRIPTION
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/${testSubId}/renew`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newCost: 4000 }),
    });
    const data = await res.json();
    assert(data.success === true, 'Subscription Lifecycle', 'Renew subscription endpoint 200');
    assert(data.subscription?.totalAmount === 4000, 'Subscription Lifecycle', 'New renewal cost updated to 4000');
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Renew endpoint failed', err);
  }

  // Step 3.6: DELETE SUBSCRIPTION
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/${testSubId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    assert(data.success === true, 'Subscription Lifecycle', 'Delete subscription 200');
    assert(data.message === 'Subscription removed', 'Subscription Lifecycle', 'Delete confirmation message returned');
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Delete failed', err);
  }

  // Step 3.7: Verify deleted
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/${testSubId}`, {
      method: 'DELETE',
    });
    assert(res.status === 404, 'Subscription Lifecycle', 'Subsequent delete returns 404');
  } catch (err) {
    assert(false, 'Subscription Lifecycle', 'Verify delete failed', err);
  }
}

async function runDirectDatabaseVerification() {
  console.log('\n========================================');
  console.log('🧪 SUITE 4: Direct MongoDB Atlas Database Verification');
  console.log('========================================');

  try {
    const txCol = await getTransactionsCollection();
    const subCol = await getSubscriptionsCollection();

    const totalTx = await txCol.countDocuments();
    assert(totalTx === 208, 'Direct DB', 'Total transactions in MongoDB Atlas is 208', totalTx);

    const totalSubs = await subCol.countDocuments();
    assert(totalSubs === 13, 'Direct DB', 'Total subscriptions in MongoDB Atlas is 13', totalSubs);

    // Verify October 2026 IST range: 2026-09-30T18:30:00Z to 2026-10-31T18:30:00Z
    const octStart = new Date(Date.UTC(2026, 8, 30, 18, 30, 0));
    const octEnd = new Date(Date.UTC(2026, 9, 31, 18, 30, 0));

    const octTxs = await txCol.find({ date: { $gte: octStart, $lt: octEnd } }).toArray();
    assert(octTxs.length === 45, 'Direct DB', 'October 2026 IST transaction count is 45', octTxs.length);

    let regularDebits = 0;
    let credits = 0;
    let transfers = 0;
    let amortizedMonthly = 0;

    for (const t of octTxs) {
      if (t.type === 'credit') {
        credits += t.amount;
      } else if (t.tag === 'Transfer' || t.type === 'transfer') {
        transfers += t.amount;
      } else if (t.type === 'amortized' || (t.tag && t.tag.toLowerCase().includes('amortized'))) {
        amortizedMonthly += (t.effectiveMonthly || t.amount);
      } else if (t.type === 'debit') {
        regularDebits += t.amount;
      }
    }

    assert(Math.abs(regularDebits - 12493.17) < 0.05, 'Direct DB', 'DB regular debits sum === 12493.17', regularDebits);
    assert(Math.abs(credits - 1012.00) < 0.05, 'Direct DB', 'DB credits sum === 1012.00', credits);
    assert(Math.abs(transfers - 12860.00) < 0.05, 'Direct DB', 'DB transfers sum === 12860.00', transfers);
    assert(Math.abs(amortizedMonthly - 3451.43) < 0.05, 'Direct DB', 'DB amortized monthly sum === 3451.43', amortizedMonthly);
    assert(Math.abs((regularDebits + amortizedMonthly) - 15944.60) < 0.05, 'Direct DB', 'DB operating burn === 15944.60', regularDebits + amortizedMonthly);
    assert(Math.abs((credits - regularDebits) - (-11481.17)) < 0.05, 'Direct DB', 'DB net cash flow === -11481.17', credits - regularDebits);

    // Verify zero fake categories in DB
    const fakeCategoriesFound = await txCol.countDocuments({
      category: { $in: ['Food & Dining', 'Groceries', 'Transport & Fuel', 'Shopping', 'Entertainment'] }
    });
    assert(fakeCategoriesFound === 0, 'Direct DB', 'Zero fake categories found in MongoDB transactions', fakeCategoriesFound);

  } catch (err) {
    assert(false, 'Direct DB', 'Direct DB verification failed with exception', err);
  }
}

async function main() {
  console.log('🚀 RUNNING EXHAUSTIVE VERIFICATION SUITE: NO HALF MEASURES');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await runLiveApiTests();
  await runTransactionCrudTests();
  await runSubscriptionCrudTests();
  await runDirectDatabaseVerification();

  console.log('\n========================================');
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('========================================');

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total Assertions: ${total}`);
  console.log(`Passed:          ${passed} ✅`);
  console.log(`Failed:          ${failed} ${failed > 0 ? '❌' : ''}`);

  if (failed > 0) {
    console.error('\nFAILED TESTS:');
    for (const f of results.filter(r => !r.passed)) {
      console.error(`- [${f.suite}] ${f.name}: ${f.error || 'Check details'}`);
    }
    process.exit(1);
  } else {
    console.log('\n🌟 ALL ASSERTIONS PASSED PERFECTLY WITH ZERO ERRORS!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
