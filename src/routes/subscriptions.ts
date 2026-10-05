import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import {
  getAllSubscriptions,
  createSubscription,
  renewSubscription,
  calculateTotalMonthlyCommitment,
} from '../services/subscriptions.service.js';
import { getSubscriptionsCollection } from '../db/mongo.js';
import { logError } from '../services/logger.js';
import { SubscriptionCategory, SubscriptionStatus } from '../types/models.js';

export const subscriptionsRouter = Router();

// GET /api/subscriptions - List all subscriptions with countdown & monthly baseline
subscriptionsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const [subscriptions, totalMonthlyCommitment] = await Promise.all([
      getAllSubscriptions(),
      calculateTotalMonthlyCommitment(),
    ]);

    const activeCount = subscriptions.filter(s => s.status === 'active').length;
    const expiringSoonCount = subscriptions.filter(s => s.isExpiringSoon || s.isOverdue).length;

    res.status(200).json({
      success: true,
      totalMonthlyCommitment,
      activeCount,
      expiringSoonCount,
      subscriptions,
    });
  } catch (err) {
    logError('Error fetching subscriptions', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/subscriptions - Create new recurring subscription
subscriptionsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { title, category, totalAmount, billingCycleMonths, startDate, nextRenewalDate, notes } = req.body;

    if (!title || typeof totalAmount !== 'number' || totalAmount <= 0) {
      res.status(400).json({ success: false, error: 'Valid title and positive total amount required' });
      return;
    }

    const cycle = parseInt(billingCycleMonths, 10) || 12;
    const start = startDate ? new Date(startDate) : new Date();
    let renewal = nextRenewalDate ? new Date(nextRenewalDate) : new Date(start);
    if (!nextRenewalDate) {
      renewal.setMonth(renewal.getMonth() + cycle);
    }

    const created = await createSubscription({
      title: String(title).trim(),
      category: (category as SubscriptionCategory) || 'Utilities',
      totalAmount,
      billingCycleMonths: cycle,
      monthlyBaselineCost: Math.round((totalAmount / cycle) * 100) / 100,
      startDate: start,
      nextRenewalDate: renewal,
      remindDaysBefore: 30,
      status: 'active',
      autoRenew: true,
      notes: notes || '',
    });

    res.status(201).json({ success: true, subscription: created });
  } catch (err) {
    logError('Error creating subscription', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/subscriptions/:id/renew - Mark subscription renewed
subscriptionsRouter.patch('/:id/renew', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const newCost = req.body.newCost !== undefined ? parseFloat(req.body.newCost) : undefined;

    const renewed = await renewSubscription(id, newCost);
    if (!renewed) {
      res.status(404).json({ success: false, error: 'Subscription not found' });
      return;
    }

    res.status(200).json({ success: true, subscription: renewed });
  } catch (err) {
    logError('Error renewing subscription', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/subscriptions/:id - Edit subscription details
subscriptionsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const col = await getSubscriptionsCollection();
    const objectId = new ObjectId(id);

    const updates = { ...req.body };
    delete updates._id;

    if (updates.nextRenewalDate) {
      updates.nextRenewalDate = new Date(updates.nextRenewalDate);
    }
    if (updates.startDate) {
      updates.startDate = new Date(updates.startDate);
    }
    if (updates.totalAmount && updates.billingCycleMonths) {
      updates.monthlyBaselineCost = Math.round((updates.totalAmount / updates.billingCycleMonths) * 100) / 100;
    }

    updates.updatedAt = new Date();

    await col.updateOne({ _id: objectId }, { $set: updates });
    const updated = await col.findOne({ _id: objectId });

    res.status(200).json({ success: true, subscription: updated });
  } catch (err) {
    logError('Error updating subscription', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// DELETE /api/subscriptions/:id - Delete subscription
subscriptionsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const col = await getSubscriptionsCollection();
    const result = await col.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, error: 'Subscription not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Subscription removed' });
  } catch (err) {
    logError('Error deleting subscription', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
