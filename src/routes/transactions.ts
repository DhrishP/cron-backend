import { Router, Request, Response } from 'express';
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  amortizeTransaction,
} from '../services/transactions.service.js';
import { logError } from '../services/logger.js';
import { TransactionType, TransactionTag } from '../types/models.js';

export const transactionsRouter = Router();

// GET /api/transactions - List transactions with filters
transactionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const month = req.query.month !== undefined ? parseInt(req.query.month as string, 10) : undefined;
    const year = req.query.year !== undefined ? parseInt(req.query.year as string, 10) : undefined;
    const type = req.query.type as TransactionType | undefined;
    const category = req.query.category as string | undefined;
    const tag = req.query.tag as TransactionTag | undefined;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 500;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const sortBy = req.query.sortBy as 'date' | 'amount' | undefined;
    const sortOrder = req.query.sortOrder as 'asc' | 'desc' | undefined;

    const result = await getTransactions({
      month,
      year,
      type,
      category,
      tag,
      search,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    logError('Error fetching transactions', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/transactions - Create a new spend/credit manually
transactionsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const title = req.body.title || req.body.description;
    const { amount, type, category, tag, date } = req.body;

    if (!title || typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid title or description and positive amount are required' });
      return;
    }

    const txDate = date ? new Date(date) : new Date();

    const created = await createTransaction({
      title: String(title).trim(),
      amount: Math.round(amount * 100) / 100,
      type: type || 'debit',
      category: category || 'Everyday Spend',
      tag: tag || 'Normal',
      date: isNaN(txDate.getTime()) ? new Date() : txDate,
      source: 'manual_pwa',
    });

    res.status(201).json({ success: true, transaction: created });
  } catch (err) {
    logError('Error creating transaction', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/transactions/:id/amortize - Convert debit to amortized schedule
transactionsRouter.patch('/:id/amortize', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const duration = parseInt(req.body.durationMonths || req.body.duration, 10) || 3;

    const updated = await amortizeTransaction(id, duration);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    res.status(200).json({ success: true, transaction: updated });
  } catch (err) {
    logError('Error amortizing transaction', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/transactions/:id - Update transaction
transactionsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const updates = req.body;
    delete updates._id;

    if (updates.date) {
      updates.date = new Date(updates.date);
    }

    const updated = await updateTransaction(id, updates);
    if (!updated) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    res.status(200).json({ success: true, transaction: updated });
  } catch (err) {
    logError('Error updating transaction', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// DELETE /api/transactions/:id - Delete transaction
transactionsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const deleted = await deleteTransaction(id);

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    logError('Error deleting transaction', err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
