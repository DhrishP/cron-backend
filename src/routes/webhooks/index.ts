import { Router } from 'express';
import { macrodroidRouter } from './macrodroid.js';

export const webhooksRouter = Router();

// Mount individual webhook providers
webhooksRouter.use('/macrodroid', macrodroidRouter);
