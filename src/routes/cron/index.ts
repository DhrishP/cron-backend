import { Router } from 'express';
import { requireCronAuth } from '../../middleware/auth.js';
import { financeCronRouter } from './finance.js';
import { exampleCronRouter } from './example.js';

export const cronRouter = Router();

// Protect all /api/cron/* routes with authentication
cronRouter.use(requireCronAuth);

// Mount individual scheduled task routers
cronRouter.use('/finance', financeCronRouter);
cronRouter.use('/example', exampleCronRouter);
