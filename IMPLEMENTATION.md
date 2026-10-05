# SpendSpace — Architecture & Implementation Plan
**A Modern, Bank-Grade Personal Finance Tracker & Renewal Engine**  
*Migrating from Google Sheets to MongoDB Atlas + Express Backend + React PWA (KeepSpace Aesthetics) on Vercel*

---

## 1. Executive Summary & Core Philosophy

The current Google Sheets integration provided an initial prototype, but suffers from inherent architectural constraints:
- **3–5 second latency** per webhook call.
- **HTTP 302 redirect incompatibilities** with Google Apps Script Web Apps.
- **Ledger pollution** from 130+ future amortized "ghost" rows stretching into 2027.
- **Double-counting risks** when real monthly SMS debits (e.g. YouTube Premium, GST) hit already pre-generated rows.

### The Solution: "SpendSpace"
A production-grade, full-stack personal finance system:
1. **Database:** MongoDB Atlas (M0 / Dedicated) with strict Mongoose schemas and sub-50ms query times.
2. **Backend:** Serverless Express API running on Vercel, directly receiving MacroDroid bank SMS and Telegram webhooks.
3. **Frontend:** Mobile-first Progressive Web App (PWA) with the **exact visual aesthetic and design tokens of `@keepspace`** (Zinc-950 dark theme, Space Grotesk metrics, Plus Jakarta Sans typography, and glassmorphic cards).
4. **Automation:** Proactive Telegram alerts for renewals (3m, 6m, 12m) and interactive bot commands (`/summary`, `/renewals`).

---

## 2. High-Level System Architecture

```
                    ┌─────────────────────────────────────────┐
                    │      MacroDroid Android Bank SMS        │
                    │                   &                     │
                    │        Interactive Telegram Bot         │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Vercel Unified Deployment                                 │
│                                                                                        │
│   ┌────────────────────────────────────────┐   ┌───────────────────────────────────┐   │
│   │        Express API (/api/*)            │   │      React PWA Frontend (/)       │   │
│   │  • /api/webhooks/macrodroid            │   │  • KeepSpace Zinc-950 Design      │   │
│   │  • /api/webhooks/telegram              │   │  • Plus Jakarta Sans & Space Gro. │   │
│   │  • /api/cron/finance/summary           │   │  • Cash Flow vs True Burn Hero    │   │
│   │  • /api/cron/finance/renewals          │   │  • Subscriptions & Countdown Grid │   │
│   │  • /api/transactions (CRUD + Filter)   │   │  • Clean Ledger View              │   │
│   │  • /api/subscriptions (CRUD)           │   │  • Standalone Mobile Manifest     │   │
│   └───────────────────┬────────────────────┘   └─────────────────┬─────────────────┘   │
└───────────────────────┼──────────────────────────────────────────┼─────────────────────┘
                        │                                          │
                        ▼                                          ▼
             ┌──────────────────────────────────────────────────────────────┐
             │                     MongoDB Atlas                            │
             │   • transactions (actual ledger — strictly past & present)   │
             │   • subscriptions (renewal registry & monthly allocations)   │
             └──────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema & Data Modeling (MongoDB)

### 3.1. Collection: `transactions`
Represents the **clean cashbook**. A record is inserted **only when money actually moves** in real life. No future phantom rows.

```typescript
import { Schema, model, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  date: Date;
  title: string;              // "Swiggy", "Shell Petrol", "Client Payment"
  type: 'debit' | 'credit' | 'transfer';
  amount: number;             // Real amount moved from/to bank
  category: string;           // "Food & Dining", "Utilities", "Health", "Income", etc.
  tag: 'Normal' | 'Amortized' | 'Emergency' | 'Transfer';
  amortization?: {
    isAmortized: boolean;
    durationMonths: number;   // 3, 6, 12
    monthlyShare: number;     // amount / durationMonths
    subscriptionId?: Types.ObjectId;
  };
  rawSms?: string;
  source: 'sms' | 'telegram' | 'manual' | 'sheet_migration';
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    date: { type: Date, required: true, index: true },
    title: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: ['debit', 'credit', 'transfer'], required: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, default: 'General', index: true },
    tag: { type: String, enum: ['Normal', 'Amortized', 'Emergency', 'Transfer'], default: 'Normal' },
    amortization: {
      isAmortized: { type: Boolean, default: false },
      durationMonths: { type: Number, default: 1 },
      monthlyShare: { type: Number, default: 0 },
      subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    },
    rawSms: { type: String, trim: true },
    source: { type: String, enum: ['sms', 'telegram', 'manual', 'sheet_migration'], default: 'sms' },
  },
  { timestamps: true }
);

TransactionSchema.index({ date: -1, createdAt: -1 });
```

---

### 3.2. Collection: `subscriptions`
The single source of truth for **annual, quarterly, and monthly recurring commitments**.

```typescript
export interface ISubscription extends Document {
  title: string;              // "Wifi Worldspace", "Internet Jio", "Mediclaim"
  category: 'Utilities' | 'Health' | 'Insurance' | 'Domains' | 'Tax' | 'Streaming' | 'Other';
  totalAmount: number;        // e.g. ₹8,000
  billingCycle: '1m' | '3m' | '6m' | '12m'; // or custom months
  durationMonths: number;     // 1, 3, 6, 12
  monthlyCost: number;        // e.g. ₹666.67
  startDate: Date;            // e.g. 22 Aug 2026
  nextRenewalDate: Date;      // e.g. 22 Aug 2027
  status: 'active' | 'paused' | 'cancelled';
  remindDaysBefore: number;   // default: 30 days
  autoRenew: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    title: { type: String, required: true, unique: true, trim: true },
    category: {
      type: String,
      enum: ['Utilities', 'Health', 'Insurance', 'Domains', 'Tax', 'Streaming', 'Other'],
      default: 'Utilities',
    },
    totalAmount: { type: Number, required: true },
    billingCycle: { type: String, enum: ['1m', '3m', '6m', '12m'], required: true },
    durationMonths: { type: Number, required: true },
    monthlyCost: { type: Number, required: true },
    startDate: { type: Date, required: true },
    nextRenewalDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ['active', 'paused', 'cancelled'], default: 'active' },
    remindDaysBefore: { type: Number, default: 30 },
    autoRenew: { type: Boolean, default: true },
    notes: { type: String },
  },
  { timestamps: true }
);

SubscriptionSchema.index({ status: 1, nextRenewalDate: 1 });
```

---

## 4. UI / UX Design System (Matching `@keepspace`)

The frontend will use the exact design system and CSS tokens found in `/Users/whycurious/code/projects/keepspace/frontend/src/index.css`.

### 4.1. Design Tokens & Theme Variables

```css
:root {
  /* KeepSpace Dark Theme (Zinc-950) */
  --bg-primary: #09090b;       /* Zinc-950 main surface */
  --bg-secondary: #09090b;     /* Zinc-950 sidebar & header */
  --bg-tertiary: #18181b;      /* Zinc-900 inputs & card backgrounds */
  --card-bg: #18181b;          /* Zinc-900 card surface */
  
  --border-color: #27272a;     /* Zinc-800 borders */
  --border-light: rgba(255, 255, 255, 0.06);
  --hover-bg: rgba(255, 255, 255, 0.04);
  
  --accent-primary: #fafafa;   /* Zinc-50 high contrast */
  --accent-blue: #3b82f6;      /* Blue-500 interactive elements */
  --accent-gradient: linear-gradient(135deg, #fafafa 0%, #a1a1aa 100%);
  --accent-glow: rgba(255, 255, 255, 0.05);
  
  --text-primary: #fafafa;     /* High contrast white */
  --text-secondary: #a1a1aa;   /* Zinc-400 subtitle text */
  --text-muted: #71717a;       /* Zinc-500 placeholders */
  
  --success: #10b981;          /* Emerald (credits / active) */
  --warning: #f59e0b;          /* Amber (expiring soon) */
  --danger: #ef4444;           /* Rose (debits / overdue) */
  
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-display: 'Space Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  
  --border-radius-sm: 6px;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
  
  --transition-smooth: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### 4.2. Core PWA Views

```
┌─────────────────────────────────────────────────────────────┐
│  SpendSpace                  [+ Quick Log]  [🔔 Renewals]   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐   ┌─────────────────────────┐  │
│  │ 🏦 Actual Bank Outflow   │   │ 📉 True Monthly Burn    │  │
│  │   ₹3,705.16             │   │   ₹7,156.59 / mo        │  │
│  │   Inflow: ₹287.00       │   │   Regular: ₹3,705.16    │  │
│  │   Net: -₹3,418.16       │   │   Subs: ₹3,451.43/mo    │  │
│  └─────────────────────────┘   └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ⏳ Upcoming Renewals & Amortized Subscriptions             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 🟡 Internet Jio (3 Months)       • Due: 01/12/2026    │  │
│  │    ₹900 total (₹300.00/mo)       • 63 days left       │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ 🟢 Wifi Worldspace (6 Months)    • Due: 25/02/2027    │  │
│  │    ₹2,500 total (₹416.67/mo)     • 149 days left      │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ 🟢 Mediclaim (12 Months)         • Due: 22/08/2027    │  │
│  │    ₹8,000 total (₹666.67/mo)     • 327 days left      │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  📋 Recent Activity (Ledger)            [🔍 Search spends]  │
│  • Swiggy                        -₹420.00   Food            │
│  • Petrol                        -₹500.00   Commute         │
│  • Client Payment                +₹287.00   Credit          │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. PWA Manifest & Installation (`manifest.json`)

To enable native-like installation on iOS Safari and Android Chrome:

```json
{
  "id": "/",
  "short_name": "SpendSpace",
  "name": "SpendSpace — Financial Command & Renewal Engine",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#09090b",
  "theme_color": "#09090b",
  "description": "Bank-grade personal finance ledger, true monthly burn calculator, and subscription renewal tracker.",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

---

## 6. Calculation Logic: Real Cash Flow vs. True Monthly Burn

The MongoDB aggregation pipeline calculates both metrics simultaneously with zero ambiguity:

### 1. Bank Cash Flow (Cash Basis)
```typescript
// Query: All transactions where date falls in the current month
const actualBankDebits = transactions
  .filter(t => t.type === 'debit' && t.tag !== 'Transfer')
  .reduce((sum, t) => sum + t.amount, 0);

const actualBankCredits = transactions
  .filter(t => t.type === 'credit')
  .reduce((sum, t) => sum + t.amount, 0);

const netCashFlow = actualBankCredits - actualBankDebits;
```

### 2. True Lifestyle Burn Rate (Accrual / Operating Cost)
```typescript
// Sum all active subscriptions' monthlyCost
const subscriptionsMonthlyBaseline = activeSubscriptions
  .reduce((sum, s) => sum + s.monthlyCost, 0); // ₹3,451.43

// Regular day-to-day spending (excluding one-off amortized purchases)
const regularDayToDaySpends = transactions
  .filter(t => t.type === 'debit' && t.tag === 'Normal')
  .reduce((sum, t) => sum + t.amount, 0);

const trueMonthlyBurn = regularDayToDaySpends + subscriptionsMonthlyBaseline;
```

---

## 7. Migration Plan from Google Sheets to MongoDB

We will create a standalone script: `scripts/migrate-from-sheet.ts`.

1. **Step 1:** Fetch all rows from Google Sheets via the existing read-only GET endpoint (`?action=get_recent&limit=1000`).
2. **Step 2:**
   - Filter out all future amortized split rows (`Split M/N`).
   - Extract the 13 historical subscriptions directly into the `subscriptions` collection with their exact amounts, start dates, and calculated renewal dates:
     1. `Wifi Worldspace` (₹2500 / 6m &rarr; 25/02/2027)
     2. `Internet Jio` (₹900 / 3m &rarr; 01/12/2026)
     3. `Water Tank Cleaning` (₹1500 / 12m &rarr; 01/09/2027)
     4. `Mediclaim` (₹8000 / 12m &rarr; 22/08/2027)
     5. `House Insurance` (₹4000 / 12m &rarr; 24/05/2027)
     6. `Water Filter Servicing` (₹2200 / 12m &rarr; 01/04/2027)
     7. `Chacha Mediclaim` (₹5000 / 12m &rarr; 21/08/2027)
     8. `Property Tax` (₹1500 / 12m &rarr; 01/04/2027)
     9. `GST Filing` (₹500/mo &rarr; 01/04/2027)
     10. `ITR Filing` (₹2000 / 12m &rarr; 30/08/2027)
     11. `Domain curiouslymotivated.com` (₹977 / 12m &rarr; 08/02/2027)
     12. `Domain spwn.in` (₹572 / 12m &rarr; 10/08/2027)
     13. `YouTube Premium` (₹89/mo &rarr; 01/01/2027)
3. **Step 3:** Insert all past real transactions (the 24 bank SMS records) into `transactions`.
4. **Step 4:** Verify that `/summary` outputs the exact ₹3,705.16 bank debit and ₹7,156.59 true burn rate.

---

## 8. Step-by-Step Implementation Roadmap

### Phase 1: MongoDB Scaffolding & Connection Pooling
- Install `mongoose` and `mongodb`.
- Create `src/db/connection.ts` with Vercel serverless connection caching (preventing connection exhaustion across lambdas).
- Create `src/models/Transaction.ts` and `src/models/Subscription.ts`.

### Phase 2: Sheet-to-Mongo Migration Script
- Run `scripts/migrate-from-sheet.ts` to populate all 13 subscriptions and existing real spends into MongoDB Atlas.
- Verify data integrity with diagnostic queries.

### Phase 3: Update Backend Webhooks & Telegram Bot
- **MacroDroid Webhook (`src/routes/webhooks/macrodroid.ts`):** Writes directly to MongoDB in <50ms.
- **Telegram Webhook (`src/services/telegram.ts`):** 
  - Tagging callbacks (3m, 6m, 12m) create/update subscriptions and link the transaction.
  - `/summary` reads MongoDB directly.
  - `/renewals` reads MongoDB directly with countdown badges.
- **Cron routes:** `/api/cron/finance/renewals` checks MongoDB for expiring subscriptions.

### Phase 4: Build React PWA Frontend (`frontend/`)
- Initialize Vite + React + TypeScript inside `frontend/` matching `@keepspace` structure.
- Copy KeepSpace design tokens (`index.css`), Plus Jakarta Sans, Space Grotesk, Lucide icons.
- Build components:
  - `HeroMetrics.tsx` (Cash Flow vs True Burn)
  - `RenewalCard.tsx` (Countdown badge, cycle, cost)
  - `LedgerTable.tsx` (Real-time transaction search, category tagger)
  - `QuickAddModal.tsx` (Manual cash spend input with amortize buttons)
- Configure `manifest.json` and service worker for PWA installation.

### Phase 5: Unified Vercel Configuration & Deployment
- Configure root `vercel.json` rewrites:
  ```json
  {
    "rewrites": [
      { "source": "/api/(.*)", "destination": "/api/$1" },
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  }
  ```
- Build script: builds `frontend/` to `dist/`, builds Express API for serverless.
- Push to GitHub and deploy to Vercel.

---

## 9. Next Steps to Kick Off Execution

1. Add your `MONGODB_URI` to `.env`.
2. Run Phase 1 & 2 to scaffold MongoDB models and migrate all existing data from Google Sheets.
3. Build the frontend PWA with KeepSpace aesthetics.
