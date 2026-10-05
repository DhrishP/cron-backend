import { ObjectId, Filter } from 'mongodb';
import { getSubscriptionsCollection } from '../db/mongo.js';
import { SubscriptionDoc, SubscriptionStatus } from '../types/models.js';
import { logInfo, logError } from './logger.js';

export interface EnrichedSubscription extends SubscriptionDoc {
  daysRemaining: number;
  isOverdue: boolean;
  isExpiringSoon: boolean;
  urgencyStatus: 'overdue' | 'today' | 'week' | 'soon' | 'active';
  cycleLabel: string;
}

export const CANONICAL_SUBSCRIPTIONS: Omit<SubscriptionDoc, '_id' | 'createdAt' | 'updatedAt'>[] = [
  {
    title: 'Internet Jio',
    category: 'Utilities',
    totalAmount: 900,
    billingCycleMonths: 3,
    monthlyBaselineCost: 300,
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    nextRenewalDate: new Date('2026-12-01T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'JioFiber 3-month recurring broadband',
  },
  {
    title: 'YouTube Premium',
    category: 'Streaming',
    totalAmount: 89,
    billingCycleMonths: 1,
    monthlyBaselineCost: 89,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    nextRenewalDate: new Date('2026-11-01T00:00:00.000Z'),
    remindDaysBefore: 7,
    status: 'active',
    autoRenew: true,
    notes: 'Monthly recurring family / individual plan',
  },
  {
    title: 'curiouslymotivated.com',
    category: 'Domains',
    totalAmount: 977,
    billingCycleMonths: 12,
    monthlyBaselineCost: 81.42,
    startDate: new Date('2026-02-08T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-02-08T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'Primary personal brand domain registration',
  },
  {
    title: 'Wifi Worldspace',
    category: 'Utilities',
    totalAmount: 2500,
    billingCycleMonths: 6,
    monthlyBaselineCost: 416.67,
    startDate: new Date('2026-08-25T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-02-25T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'Worldspace 6-month high-speed internet plan',
  },
  {
    title: 'Water Filter Servicing',
    category: 'Utilities',
    totalAmount: 2200,
    billingCycleMonths: 12,
    monthlyBaselineCost: 183.33,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-04-01T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'RO water purifier annual maintenance contract (AMC)',
  },
  {
    title: 'Property Tax',
    category: 'Tax',
    totalAmount: 1500,
    billingCycleMonths: 12,
    monthlyBaselineCost: 125,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-04-01T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: false,
    notes: 'Annual municipal property tax payment',
  },
  {
    title: 'House Insurance',
    category: 'Insurance',
    totalAmount: 4000,
    billingCycleMonths: 12,
    monthlyBaselineCost: 333.33,
    startDate: new Date('2026-05-24T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-05-24T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'Comprehensive residential structure & content insurance',
  },
  {
    title: 'spwn.in',
    category: 'Domains',
    totalAmount: 572,
    billingCycleMonths: 12,
    monthlyBaselineCost: 47.67,
    startDate: new Date('2026-08-10T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-08-10T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: '.in short domain registration',
  },
  {
    title: 'Chacha Mediclaim',
    category: 'Health',
    totalAmount: 5000,
    billingCycleMonths: 12,
    monthlyBaselineCost: 416.67,
    startDate: new Date('2026-08-21T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-08-21T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'Family health insurance policy',
  },
  {
    title: 'Mediclaim',
    category: 'Health',
    totalAmount: 8000,
    billingCycleMonths: 12,
    monthlyBaselineCost: 666.67,
    startDate: new Date('2026-08-22T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-08-22T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'Personal health & hospitalization insurance policy',
  },
  {
    title: 'ITR Filing',
    category: 'Tax',
    totalAmount: 2000,
    billingCycleMonths: 12,
    monthlyBaselineCost: 166.67,
    startDate: new Date('2026-08-30T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-08-30T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: false,
    notes: 'Chartered accountant annual income tax return filing',
  },
  {
    title: 'Water Tank Cleaning',
    category: 'Utilities',
    totalAmount: 1500,
    billingCycleMonths: 12,
    monthlyBaselineCost: 125,
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    nextRenewalDate: new Date('2027-09-01T00:00:00.000Z'),
    remindDaysBefore: 30,
    status: 'active',
    autoRenew: true,
    notes: 'Annual deep cleaning & sanitization service',
  },
];

export async function enrichSubscription(sub: SubscriptionDoc): Promise<EnrichedSubscription> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const renewal = new Date(sub.nextRenewalDate);
  const renewalPure = new Date(renewal.getFullYear(), renewal.getMonth(), renewal.getDate());

  const diffMs = renewalPure.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const isOverdue = diffDays < 0;
  const isExpiringSoon = diffDays >= 0 && diffDays <= (sub.remindDaysBefore || 30);

  let urgencyStatus: 'overdue' | 'today' | 'week' | 'soon' | 'active' = 'active';
  if (isOverdue) urgencyStatus = 'overdue';
  else if (diffDays === 0) urgencyStatus = 'today';
  else if (diffDays <= 7) urgencyStatus = 'week';
  else if (isExpiringSoon) urgencyStatus = 'soon';

  let cycleLabel = `${sub.billingCycleMonths} months`;
  if (sub.billingCycleMonths === 1) cycleLabel = 'Monthly (1m)';
  else if (sub.billingCycleMonths === 3) cycleLabel = 'Quarterly (3m)';
  else if (sub.billingCycleMonths === 6) cycleLabel = 'Half-Yearly (6m)';
  else if (sub.billingCycleMonths === 12) cycleLabel = 'Annual (1 Year)';

  return {
    ...sub,
    daysRemaining: diffDays,
    isOverdue,
    isExpiringSoon,
    urgencyStatus,
    cycleLabel,
  };
}

export async function getAllSubscriptions(filter?: Filter<SubscriptionDoc>): Promise<EnrichedSubscription[]> {
  const col = await getSubscriptionsCollection();
  const query = filter || {};
  const subs = await col.find(query).sort({ nextRenewalDate: 1 }).toArray();
  const enriched = await Promise.all(subs.map(enrichSubscription));
  return enriched.sort((a, b) => a.nextRenewalDate.getTime() - b.nextRenewalDate.getTime());
}

export async function getUpcomingRenewals(daysAhead = 45): Promise<EnrichedSubscription[]> {
  const all = await getAllSubscriptions({ status: 'active' });
  return all.filter(s => s.daysRemaining <= daysAhead);
}

export async function calculateTotalMonthlyCommitment(): Promise<number> {
  const all = await getAllSubscriptions({ status: 'active' });
  const total = all.reduce((sum, s) => sum + s.monthlyBaselineCost, 0);
  return Math.round(total * 100) / 100;
}

export async function createSubscription(data: Omit<SubscriptionDoc, '_id' | 'createdAt' | 'updatedAt'>): Promise<SubscriptionDoc> {
  const col = await getSubscriptionsCollection();
  const now = new Date();
  const monthlyBaselineCost = Math.round((data.totalAmount / (data.billingCycleMonths || 1)) * 100) / 100;

  const doc: SubscriptionDoc = {
    ...data,
    monthlyBaselineCost: data.monthlyBaselineCost || monthlyBaselineCost,
    createdAt: now,
    updatedAt: now,
  };

  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function renewSubscription(id: string | ObjectId, newCost?: number): Promise<EnrichedSubscription | null> {
  const col = await getSubscriptionsCollection();
  const objectId = typeof id === 'string' ? new ObjectId(id) : id;
  const existing = await col.findOne({ _id: objectId });

  if (!existing) return null;

  const currentRenewal = new Date(existing.nextRenewalDate);
  const nextRenewal = new Date(currentRenewal);
  nextRenewal.setMonth(nextRenewal.getMonth() + (existing.billingCycleMonths || 12));

  const totalAmount = typeof newCost === 'number' && newCost > 0 ? newCost : existing.totalAmount;
  const monthlyBaselineCost = Math.round((totalAmount / (existing.billingCycleMonths || 1)) * 100) / 100;

  await col.updateOne(
    { _id: objectId },
    {
      $set: {
        nextRenewalDate: nextRenewal,
        totalAmount,
        monthlyBaselineCost,
        status: 'active',
        updatedAt: new Date(),
      },
    }
  );

  const updated = await col.findOne({ _id: objectId });
  return updated ? enrichSubscription(updated) : null;
}

export async function seedCanonicalSubscriptionsIfEmpty(): Promise<number> {
  const col = await getSubscriptionsCollection();
  const count = await col.countDocuments();
  if (count > 0) {
    return 0;
  }

  const now = new Date();
  const docs: SubscriptionDoc[] = CANONICAL_SUBSCRIPTIONS.map(s => ({
    ...s,
    createdAt: now,
    updatedAt: now,
  }));

  const res = await col.insertMany(docs);
  logInfo(`Seeded ${res.insertedCount} canonical subscriptions into MongoDB`);
  return res.insertedCount;
}
