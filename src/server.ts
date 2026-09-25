import dotenv from 'dotenv';
import { createApp } from './app.js';
import { logInfo } from './services/logger.js';

dotenv.config();

const port = process.env.PORT || 3000;
const app = createApp();

app.listen(port, () => {
  logInfo(`Cron Backend listening locally on http://localhost:${port}`);
});
