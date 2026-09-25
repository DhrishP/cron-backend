import { Request, Response, NextFunction } from 'express';
import { logError } from '../services/logger.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logError('Unhandled Application Error', err);

  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
}
