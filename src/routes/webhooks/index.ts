import { Router } from 'express';
import { macrodroidRouter } from './macrodroid.js';
import { telegramRouter } from './telegram.js';

export const webhooksRouter = Router();

// Mount individual webhook providers
webhooksRouter.use('/macrodroid', macrodroidRouter);
webhooksRouter.use('/telegram', telegramRouter);

