# Cron Backend Router (Express + Vercel)

A modular, serverless Express backend designed to deploy on **Vercel** and act as your centralized router for **cron-job.org** schedules and **MacroDroid** SMS logging.

Whenever you want to add a new scheduled task or cron job in the future, you just drop a router into `src/routes/cron/` without having to set up a new project or server.

---

## Features

- **Ready for Vercel Serverless**: Configured with `vercel.json` and `api/index.ts` to run seamlessly on Vercel's free tier.
- **Protected Cron Endpoints**: Built-in `requireCronAuth` middleware to reject unauthorized requests from the internet using `CRON_SECRET`.
- **Indian Bank / UPI SMS Parser**: Built-in parser service for HDFC, SBI, ICICI, Axis, Kotak, GPay, PhonePe, and Paytm SMS.
- **Smart Tagging & Amortization**: Automatically identifies 1-year subscriptions (spreads cost over 12 months) and emergencies (isolated from monthly baseline budget).
- **MacroDroid Webhook**: `/api/webhooks/macrodroid` endpoint to receive SMS directly from your Android phone and optionally forward to Google Sheets.
- **Zero-Friction Extensibility**: Drop new cron files in `src/routes/cron/` in 2 minutes.

---

## Project Structure

```
cron-backend/
├── api/
│   └── index.ts                 # Vercel serverless entry point
├── src/
│   ├── app.ts                   # Express app setup & middleware
│   ├── server.ts                # Local development server (port 3000)
│   ├── middleware/
│   │   ├── auth.ts              # Bearer / x-cron-secret authentication
│   │   └── errorHandler.ts      # Central error handler
│   ├── routes/
│   │   ├── index.ts             # Main router & /api/health
│   │   ├── cron/
│   │   │   ├── index.ts         # Cron router hub (protected by auth)
│   │   │   ├── finance.ts       # Finance & monthly summary job
│   │   │   └── example.ts       # Template for adding future cron jobs
│   │   └── webhooks/
│   │       ├── index.ts         # Webhooks router hub
│   │       └── macrodroid.ts    # MacroDroid SMS parser endpoint
│   ├── services/
│   │   ├── smsParser.ts         # Indian bank SMS regex parser
│   │   └── logger.ts            # Structured execution & cron logger
│   └── types/
│       └── index.ts             # TypeScript definitions
├── vercel.json                  # Vercel routing configuration
├── tsconfig.json                # TypeScript NodeNext ESM config
└── package.json
```

---

## Quick Start (Local Development)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create your `.env`**:
   ```bash
   cp .env.example .env
   ```

3. **Start the dev server**:
   ```bash
   npm run dev
   ```
   The server will start at `http://localhost:3000`.

---

## Deploying to Vercel

### Option 1: Via Vercel CLI
```bash
npx vercel
```

### Option 2: Via GitHub
1. Push this folder to a GitHub repository.
2. Import the project into your Vercel Dashboard.
3. In **Settings -> Environment Variables**, add:
   - `CRON_SECRET`: A secure random string (e.g. `sk_cron_993847291...`).
   - `GOOGLE_SHEET_WEBHOOK_URL`: (Optional) Your Google Apps Script webhook URL if forwarding SMS rows.

Your API will be live at `https://your-project.vercel.app`.

---

## Scheduling on cron-job.org

1. Create a free account on [cron-job.org](https://cron-job.org).
2. Click **Create Cronjob**.
3. **URL**: `https://your-project.vercel.app/api/cron/finance/summary`
4. **Execution Schedule**: Select your interval (e.g., Every day at 09:00 AM, or 1st of every month).
5. **Headers**: Add your authorization header:
   - **Key**: `Authorization`
   - **Value**: `Bearer your_super_secret_cron_key_here`
   *(Or Key: `x-cron-secret`, Value: `your_super_secret_cron_key_here`)*
6. Save the job.

---

## How to Add a New Cron Job in 60 Seconds

Whenever you have a new task to schedule:

1. Create a new file `src/routes/cron/my-new-task.ts`:
   ```typescript
   import { Router, Request, Response } from 'express';
   import { logInfo } from '../../services/logger.js';

   export const myNewTaskRouter = Router();

   myNewTaskRouter.all('/run', async (req: Request, res: Response) => {
     logInfo('Running my scheduled task');
     // Your custom logic here
     res.status(200).json({ success: true, message: 'Done!' });
   });
   ```

2. In `src/routes/cron/index.ts`, mount it:
   ```typescript
   import { myNewTaskRouter } from './my-new-task.js';
   // ...
   cronRouter.use('/my-new-task', myNewTaskRouter);
   ```

3. Now `https://your-project.vercel.app/api/cron/my-new-task/run` is live and automatically protected by `CRON_SECRET`!

---

## MacroDroid Webhook Setup

- **URL**: `https://your-project.vercel.app/api/webhooks/macrodroid`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {"sms": "[sms_message]", "sender": "[sms_number]"}
  ```
- **Response**: Returns parsed amount, transaction type (Debit/Credit/ATM), merchant, tag (`1-Year Sub`, `Emergency`, `Normal`, `Petty Cash`), and amortized monthly cost.
