# Spends & Subscriptions Platform — Architectural Blueprint & Implementation Specification

> **Target:** Replace brittle Google Apps Script / Google Sheets with a high-performance, bank-grade personal finance PWA powered by MongoDB, Express, and React (Vite), matching the dark-mode aesthetic of `@keepspace`.

---

## 1. Executive Summary & Problem Diagnosis

### 1.1 The Limitations of the Google Sheets Engine
The Google Sheets + Apps Script implementation successfully validated the core concept of automated SMS tracking, AI categorization, and Telegram alerting. However, it reached hard architectural limits:

| Dimension | Google Sheets + Apps Script | MongoDB + Native PWA Engine |
| :--- | :--- | :--- |
| **Data Integrity** | Ghost rows for future months (e.g. July 2027) clutter the ledger and pollute deduplication queries (`get_recent`). | Strict append-only ledger for past/present spends; dedicated collection for recurring subscriptions. |
| **Latency** | 2.5s – 6.0s round-trip execution on Google's cloud. | Sub-50ms query execution via MongoDB connection pooling and indexed collections. |
| **HTTP Reliability** | Google Web Apps execute 302 Found redirects that fail with HTML error pages on standard POST clients. | Standard RFC-compliant HTTP REST API hosted directly on Vercel Serverless. |
| **User Experience** | Manual scrolling through rows on a mobile spreadsheet; fragile formatting. | Installable Progressive Web App (PWA) with tactile micro-interactions, dark mode, and instant search. |

---

## 2. System Architecture & Information Architecture

```mermaid
graph TD
    subgraph Ingestion Layer
        A[MacroDroid Android SMS Webhook] -->|Raw Bank SMS| C[Vercel Serverless Express API]
        B[Telegram Direct Message / Cash Entry] -->|Manual Spend / Command| C
    end

    subgraph Processing & Intelligence Layer
        C -->|Categorize & Classify| D[Jev API / DeepInfra LLM]
        D -->|Parsed & Tagged Entity| C
    end

    subgraph Persistence Layer (MongoDB Atlas)
        C -->|Write real spend| E[(transactions)]
        C -->|Query / Update| F[(subscriptions)]
    end

    subgraph User Experience & Notification Layer
        C -->|Interactive Buttons & Summaries| G[Telegram Bot]
        H[PWA Mobile / Desktop App (KeepSpace UI)] <-->|REST API JSON| C
    end
```

---

## 3. KeepSpace Design System & Aesthetics Specification

The user interface adopts the identical visual hierarchy, typography, and palette found in `@keepspace`:

### 3.1 Design Tokens (CSS Variables)

```css
:root {
  /* KeepSpace Shadcn-Inspired Dark Theme */
  --bg-primary: #09090b;       /* Deep Zinc-950 canvas */
  --bg-secondary: #121215;     /* Zinc-900 elevated surface */
  --bg-tertiary: #18181b;      /* Input fields & sub-cards */
  --card-bg: #141417;          /* Primary card containers */
  
  --border-color: #27272a;     /* Zinc-800 subtle borders */
  --border-light: rgba(255, 255, 255, 0.07);
  --hover-bg: rgba(255, 255, 255, 0.04);
  
  --accent-primary: #fafafa;   /* High-contrast crisp text */
  --accent-blue: #3b82f6;      /* Brand accent / action trigger */
  --accent-blue-glow: rgba(59, 130, 246, 0.15);
  
  --text-primary: #fafafa;     /* Primary headings and amounts */
  --text-secondary: #a1a1aa;   /* Metadata and labels */
  --text-muted: #71717a;       /* Timestamps and placeholders */
  
  --success: #10b981;          /* Credited / Active / Safe */
  --warning: #f59e0b;          /* Expiring soon (< 30 days) */
  --danger: #ef4444;           /* Overdue / High spend */
  
  --font-sans: 'Plus Jakarta Sans', -apple-system, sans-serif;
  --font-display: 'Space Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
}
```

---

## 4. MongoDB Database Schemas

### 4.1 `transactions` Collection
Represents the **immutable ledger** of actual financial transactions.

```typescript
import { ObjectId } from 'mongodb';

export interface TransactionDocument {
  _id?: ObjectId;
  date: Date;                         // Actual transaction timestamp
  title: string;                      // Merchant or description (e.g., "Swiggy", "Shell Petrol")
  type: 'debit' | 'credit' | 'transfer';
  amount: number;                     // Real currency transferred (in INR)
  category: string;                   // "Food & Dining", "Utilities", "Health", "Investments", etc.
  tag: 'Normal' | 'Amortized' | 'Emergency' | 'Transfer';
  
  // Amortization metadata (if converted to a monthly split)
  amortization?: {
    isAmortized: boolean;
    durationMonths: number;           // 3, 6, 12
    monthlyShare: number;             // amount / durationMonths
    subscriptionId?: ObjectId;        // Linked subscription if applicable
  };

  rawSms?: string;                    // Preserved raw SMS content for auditing
  source: 'sms_macrodroid' | 'telegram' | 'manual_pwa' | 'sheet_migration';
  createdAt: Date;
  updatedAt: Date;
}
```

**Indexes:**
- `{ date: -1 }` (Optimizes chronological ledger listing)
- `{ type: 1, date: -1 }` (Optimizes monthly burn and cash flow calculations)
- `{ title: 'text', rawSms: 'text' }` (Full-text search across spends)

---

### 4.2 `subscriptions` Collection
Represents the **recurring schedule and renewal registry**. This eliminates all phantom rows from the daily ledger.

```typescript
export interface SubscriptionDocument {
  _id?: ObjectId;
  title: string;                      // "Wifi Worldspace", "Internet Jio", "Mediclaim"
  category: 'Utilities' | 'Health' | 'Insurance' | 'Domains' | 'Tax' | 'Streaming' | 'Other';
  totalAmount: number;                // Full renewal cost (e.g. ₹8,000 for 12m)
  billingCycleMonths: number;         // 1, 3, 6, 12
  monthlyBaselineCost: number;        // totalAmount / billingCycleMonths (e.g. ₹666.67/mo)
  
  startDate: Date;                    // Initial purchase date
  nextRenewalDate: Date;              // Computed expiry date
  remindDaysBefore: number;           // Days prior to alert (default: 30)
  
  status: 'active' | 'paused' | 'cancelled';
  autoRenew: boolean;
  notes?: string;                     // e.g. "curiouslymotivated.com on Namecheap"
  
  lastPaidTransactionId?: ObjectId;   // Reference to actual spend record
  createdAt: Date;
  updatedAt: Date;
}
```

**Indexes:**
- `{ nextRenewalDate: 1, status: 1 }` (Instant query for upcoming renewals)
- `{ status: 1 }` (Quick sum for total monthly recurring baseline)

---

## 5. Seed Registry: The 13 Historical Subscriptions

| Service | Category | Total Amount | Cycle | Monthly Share | Start Date | Next Renewal Date |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Internet Jio** | Utilities | ₹900.00 | 3 months | ₹300.00/mo | 01/09/2026 | **01/12/2026** *(in 57d)* |
| **YouTube Premium** | Streaming | ₹89.00 | 1 month | ₹89.00/mo | 01/01/2026 | **01/11/2026** *(Monthly)* |
| **curiouslymotivated.com** | Domains | ₹977.00 | 12 months | ₹81.42/mo | 08/02/2026 | **08/02/2027** |
| **Wifi Worldspace** | Utilities | ₹2,500.00 | 6 months | ₹416.67/mo | 25/08/2026 | **25/02/2027** |
| **Water Filter Servicing** | Utilities | ₹2,200.00 | 12 months | ₹183.33/mo | 01/04/2026 | **01/04/2027** |
| **Property Tax** | Tax | ₹1,500.00 | 12 months | ₹125.00/mo | 01/04/2026 | **01/04/2027** |
| **GST Filing** | Tax | ₹500.00 | 1 month | ₹500.00/mo | 01/04/2026 | **01/11/2026** *(Monthly)* |
| **House Insurance** | Insurance | ₹4,000.00 | 12 months | ₹333.33/mo | 24/05/2026 | **24/05/2027** |
| **spwn.in** | Domains | ₹572.00 | 12 months | ₹47.67/mo | 10/08/2026 | **10/08/2027** |
| **Chacha Mediclaim** | Health | ₹5,000.00 | 12 months | ₹416.67/mo | 21/08/2026 | **21/08/2027** |
| **Mediclaim** | Health | ₹8,000.00 | 12 months | ₹666.67/mo | 22/08/2026 | **22/08/2027** |
| **ITR Filing** | Tax | ₹2,000.00 | 12 months | ₹166.67/mo | 30/08/2026 | **30/08/2027** |
| **Water Tank Cleaning** | Utilities | ₹1,500.00 | 12 months | ₹125.00/mo | 01/09/2026 | **01/09/2027** |
| **TOTALS** | — | — | — | **₹3,451.43/mo** | — | — |

---

## 6. PWA User Experience & Screens

### 6.1 View 1: Executive Financial Dashboard
- **Cash Flow Hero Gauge:**
  - `Actual Bank Outflow` (Real money spent) vs. `Actual Inflow` (Credits received) &rarr; `Net Bank Balance`.
  - Fully decoupled from amortized commitments so you never see inflated cash outflow.
- **Operating Burn Card:**
  - `True Monthly Burn Rate = Regular Spends + Subscriptions Baseline (₹3,451.43/mo)`.
  - Visual breakdown bar chart by category (Health, Utilities, Taxes, Food).
- **Fast Action Bar:**
  - Floating bottom drawer for instant manual transaction entry with keyboard shortcuts.

### 6.2 View 2: Subscriptions & Renewal Radar
- **Countdown Cards:** Cards ordered by urgency with dynamic status badges:
  - 🔴 `Overdue by X days`
  - 🟡 `Expiring Soon (X days remaining)`
  - 🟢 `Active (X months remaining)`
- **Sinking Fund Indicator:** Displays the exact liquid amount (₹3,451.43) recommended to reserve this month to prevent lump-sum shock when annual insurance/mediclaim bills arrive.
- **Quick Controls:** [Mark Renewed] &bull; [Edit Cycle] &bull; [Pause/Cancel].

### 6.3 View 3: Searchable Ledger
- Instant debounced search across titles, merchants, notes, and raw SMS.
- Filter chips: `All`, `Debit`, `Credit`, `Amortized`, `Emergency`.
- One-tap Split Modal: convert any debit into a 3, 6, or 12-month amortization.

---

## 7. REST API Endpoints Specification

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/transactions` | Paginated transactions with filtering by month, year, type, and search query. |
| `POST` | `/api/transactions` | Manual spend creation from PWA. |
| `PATCH` | `/api/transactions/:id/amortize` | Convert an existing debit into an amortized schedule. |
| `GET` | `/api/subscriptions` | List all tracked subscriptions with calculated countdowns and monthly baseline. |
| `POST` | `/api/subscriptions` | Add a new recurring subscription. |
| `PATCH` | `/api/subscriptions/:id/renew` | Advance renewal date by the billing cycle upon payment. |
| `GET` | `/api/finance/summary` | Returns Cash Flow and True Burn metrics for any month (e.g. `?month=9&year=2026`). |
| `POST` | `/api/webhooks/macrodroid` | Ingests SMS, performs Jev/DeepInfra extraction, writes directly to MongoDB, alerts Telegram. |
| `POST` | `/api/webhooks/telegram` | Telegram bot command handling (`/summary`, `/renewals`, callback buttons). |
| `ALL` | `/api/cron/finance/renewals` | Scheduled cron checking for subscriptions expiring within 30 days and alerting Telegram. |

---

## 8. Migration Blueprint: From Sheet to MongoDB

We will provide a zero-downtime migration script (`scripts/migrate-from-sheet.ts`):
1. **Fetch:** Pulls all rows via Google Apps Script `action=get_recent&limit=500`.
2. **Sanitize:**
   - Filters out all generated phantom rows (`Split M/N of...`).
   - Retains all genuine bank debits, credits, and cash entries.
3. **Seed Subscriptions:** Automatically seeds the 13 canonical subscriptions with their exact cycles, costs, and renewal dates into `subscriptions`.
4. **Seed Transactions:** Inserts all historical genuine transactions into `transactions`.
5. **Verify:** Validates that `actualCashDebited` for September 2026 matches ₹3,705.16 and credits match ₹287.00.

---

## 9. Next Steps for Execution

1. **Database Provisioning:** Provide MongoDB connection URI (MongoDB Atlas free M0 cluster is 100% sufficient).
2. **Schema & Client Scaffolding:** Add `mongodb` / `mongoose` to backend.
3. **Frontend PWA Scaffolding:** Initialize Vite + React PWA inside `frontend/` with KeepSpace design system tokens.
4. **Vercel Unified Monorepo Config:** Configure root `vercel.json` rewrites to serve PWA and API under the same domain.
