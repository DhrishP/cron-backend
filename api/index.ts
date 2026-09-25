import dotenv from 'dotenv';
import { createApp } from '../src/app.js';

dotenv.config();

const app = createApp();

export default app;
