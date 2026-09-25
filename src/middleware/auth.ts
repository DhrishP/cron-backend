import { Request, Response, NextFunction } from 'express';
import { logInfo } from '../services/logger.js';

export function requireCronAuth(req: Request, res: Response, next: NextFunction): void {
  const configuredSecret = process.env.CRON_SECRET;

  // In development without configured secret, allow pass-through
  if (!configuredSecret && process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const cronSecretHeader = req.headers['x-cron-secret'];

  let providedToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  } else if (typeof cronSecretHeader === 'string') {
    providedToken = cronSecretHeader.trim();
  }

  if (!providedToken || providedToken !== configuredSecret) {
    logInfo('Unauthorized cron access attempt', {
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing CRON_SECRET token',
    });
    return;
  }

  next();
}
