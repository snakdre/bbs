---
title: Phase 4 — Reports, Revenue Chart, CSV Export — Design Spec
date: 2026-09-26
status: approved
extends: 2026-09-22-bbs-billing-design.md
supersedes: none
---

# Phase 4 — Reports, Revenue Chart, CSV Export

Adds `/reports` (a single scrolling page with seven report sections), a reusable revenue-over-time bar chart displayed on both `/dashboard` and `/reports`, and per-report CSV export.

Phase 4 does **not** touch the schema or add any dependencies. All data derives from Payment, Refund, Invoice, InvoiceLine, TaxRate, CatalogItem, and BusinessSettings rows already present. The invoice list, invoice-detail dashboard KPIs, void, and refund flows the original spec originally slated for this phase were shipped in Phases 2 and 3.

---

## Assumptions carried in from brainstorming

1. **Single scrolling page** at `/reports`. Sticky date-range picker at the top drives every section on the page.
2. **Preset dropdown + custom range** for date filtering (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, This year, All time, Custom). Custom reveals two date inputs.
3. **Timezone comes from `BusinessSettings.timezone`** (default `America/New_York`). All preset and custom ranges resolve in that TZ, then convert to UTC before hitting Prisma.
4. **Cash-basis accounting.** Revenue = `Payment.amountCents` summed by `paidAt` minus `Refund.amountCents` by `refundedAt`. Matches the existing dashboard "Today's Revenue" KPI.
5. **Drafts excluded from reports.** DRAFT invoices never appear in report totals; they still show in `/invoices` where they belong to the working state.
6. **Revenue chart is pure SVG** with the "Solid gold bars" layout from the design pass. Two variants:
   - Compact (dashboard): fixed 30-day daily view, no toggle.
   - Full (reports): daily / weekly / monthly toggle that also updates the URL param and re-renders the whole reports page.
7. **Toggle auto-adjusts default range** when the current range doesn't fit the granularity (Daily → 30d, Weekly → 12w, Monthly → 12mo). Explicit custom ranges override this.
8. **Per-report CSV** downloads driven by URL param + current date range. Filename encodes the report name and the range. UTF-8 with BOM, RFC 4180 quoting, headers on row 1, money as plain dollar strings (no `$`).
9. **Report page layout** uses the "B · Big header total + long detail table" pattern: report name + total + Export CSV button in the header row, table below, no separate KPI cards.
10. **Access:** `requireRole(ADMIN, STAFF, VIEWER)` — VIEWER can see and export reports, per the RBAC table in the original spec.

---

## Information Architecture

### New routes

| Route | Method | Purpose |
|---|---|---|
| `/reports` | GET | Reports page (all seven sections) |
| `/reports/revenue.csv` | GET | Revenue CSV (daily/weekly/monthly buckets per current toggle) |
| `/reports/aging.csv` | GET | Outstanding balance by aging bucket |
| `/reports/payment-methods.csv` | GET | Payment methods breakdown |
| `/reports/taxes.csv` | GET | Taxes collected by rate |
| `/reports/discounts.csv` | GET | Discounts issued per invoice |
| `/reports/refunds.csv` | GET | Refunds (and voided-invoice auto-refunds) |
| `/reports/top-items.csv` | GET | Top catalog items by revenue |

### Modified routes

| Route | Change |
|---|---|
| `/dashboard` | Add a full-width `RevenueChart` card below the KPI row, plus a "View full reports →" link |

### Sidebar

No changes. `/reports` already appears in Phase 1's sidebar nav; the link now goes somewhere.

---

## URL parameter contract

Every report route (page and CSVs) accepts the same params:

| Param | Values | Default |
|---|---|---|
| `range` | `today`, `yesterday`, `last-7d`, `last-30d`, `this-month`, `last-month`, `this-year`, `all-time`, `custom` | `last-30d` |
| `from` | `YYYY-MM-DD` (only when `range=custom`) | — |
| `to` | `YYYY-MM-DD` (only when `range=custom`) | — |
| `granularity` | `daily`, `weekly`, `monthly` | `daily` |

The reports page and every CSV route interpret these identically.

---

## Data Model

**No schema changes.** All required rows and columns exist from Phase 1.

### `lib/timezone.ts` — pure range interpretation

```ts
export interface ResolvedRange {
  from: Date;   // UTC
  to: Date;     // UTC (exclusive upper bound: the instant after the last covered day)
  label: string; // human-readable summary
}

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  tz: string,
  now: Date = new Date()
): ResolvedRange | { error: "invalid_range" };
```

- Reads the preset name or custom `from`/`to`.
- Interprets in the supplied TZ (via `Intl.DateTimeFormat` with the `timeZone` option).
- Returns UTC `Date` bounds and a display label like `"Sep 1 – Sep 30, 2026"`.
- Returns `{ error }` when `from > to` or the strings are unparseable.

Timezone-only helper functions are pure (no I/O), unit-tested exhaustively including DST transitions.

### `lib/reports.ts` — typed report data functions

Each function is Prisma-adjacent (it queries the DB) but takes plain typed inputs and returns typed rows. Signatures:

```ts
export interface ReportRange { from: Date; to: Date; }
export type Granularity = "daily" | "weekly" | "monthly";

export interface RevenueBucket { label: string; startDate: Date; paymentsCents: number; refundsCents: number; netCents: number; }
export async function getRevenueReport(range: ReportRange, granularity: Granularity, tz: string): Promise<RevenueBucket[]>;

export interface AgingBucket { bucket: string; invoiceCount: number; balanceCents: number; }
export async function getAgingReport(now: Date): Promise<AgingBucket[]>;

export interface PaymentMethodRow { method: PaymentMethod; count: number; amountCents: number; percentOfTotal: number; }
export async function getPaymentMethodsReport(range: ReportRange): Promise<PaymentMethodRow[]>;

export interface TaxRateRow { taxRateId: string; name: string; ratePercent: string; taxableBaseCents: number; taxCents: number; }
export async function getTaxesReport(range: ReportRange): Promise<TaxRateRow[]>;

export interface DiscountRow { invoiceId: string; invoiceNumber: string; customerName: string; issuedAt: Date; invoiceDiscountCents: number; lineDiscountCents: number; totalDiscountCents: number; }
export async function getDiscountsReport(range: ReportRange): Promise<DiscountRow[]>;

export interface RefundRow { refundedAt: Date; invoiceNumber: string; customerName: string; amountCents: number; reason: string; staffName: string; }
export async function getRefundsReport(range: ReportRange): Promise<RefundRow[]>;

export interface TopItemRow { catalogItemId: string | null; itemName: string; sku: string | null; qtySold: string; revenueCents: number; }
export async function getTopItemsReport(range: ReportRange, limit: number = 20): Promise<TopItemRow[]>;
```

**All revenue-facing reports filter by cash-basis payment date**: an invoice appears in the report only if it has at least one `Payment` whose `paidAt` falls within the range. Refunds are attributed by `refundedAt`.

**Tax attribution simplification:** the taxes report attributes the *full invoice tax* to the range containing the invoice's *most recent payment that brought it to PAID*. For invoices still PARTIAL, tax is attributed proportionally to the range each payment covers. This matches how a solo business would file quarterly tax reports.

**Top items filtering:** an invoice line's revenue is counted if the invoice has any payment in the range. Ad-hoc lines with `catalogItemId: null` collapse into a single "Uncategorized" row.

### `lib/csv.ts` — RFC 4180 serialization

```ts
export function toCsv(headers: string[], rows: string[][]): string;
```

- Prepends UTF-8 BOM (`﻿`)
- Quotes fields containing `,`, `"`, `\n`, or `\r`
- Escapes embedded `"` as `""`
- CRLF row terminators

---

## Feature Specifications

### 1. `/reports` page structure

Server Component. Renders (top to bottom):

1. **Page header** — title `"Reports"`, subtitle showing the resolved date range label
2. **Sticky filter bar** — `DateRangePicker` (client) with preset dropdown, custom-range inputs, granularity toggle. All state lives in URL params.
3. **Revenue chart** — `RevenueChart` (server-rendered SVG) with header total and its own "Export CSV" button. Same bar-chart component as dashboard, `variant="full"`.
4. **Section 2: Revenue** table — one row per bucket (daily / weekly / monthly). Columns: Date · Payments · Refunds · Net. Big header total in `$` gold. Export CSV button.
5. **Section 3: Paid vs Outstanding** (aging) — five rows for `Not yet due`, `1–30 days`, `31–60`, `61–90`, `90+`. Columns: Aging bucket · Invoice count · Balance. **This section ignores the date range** (snapshot as of now); a small `"(as of {now})"` label indicates this.
6. **Section 4: Payment methods** — one row per method with data in range. Columns: Method · Count · Amount · % of total.
7. **Section 5: Taxes collected** — one row per tax rate. Columns: Tax rate name · Rate % · Taxable base · Tax collected.
8. **Section 6: Discounts issued** — one row per invoice with discount + payment in range. Columns: Invoice # · Customer · Date · Invoice discount · Line discounts · Total discount.
9. **Section 7: Refunds and voids** — one row per Refund. Columns: Date · Invoice # · Customer · Amount · Reason · Staff.
10. **Section 8: Top items** — top 20 catalog items by revenue in range. Columns: Item · SKU · Qty sold · Revenue.

Each section (2-8) header row: `<section name>  ·  {N} rows  ·  <big header total>  [Export CSV]`.

All Prisma queries run in parallel via `Promise.all` inside the Server Component.

### 2. Date-range picker

**File:** `src/components/reports/DateRangePicker.tsx` (client).

**UI:**
```
Range: [ Last 30 days ▾ ]  From: [ ____ ]  To: [ ____ ]   [ Daily | Weekly | Monthly ]
```

- Preset dropdown; `from` / `to` inputs shown only when `Custom` selected.
- Granularity is a 3-way pill toggle.
- Every change writes the corresponding URL params and calls `router.push`. Page re-renders on the server with the new range.
- **Auto-range on toggle:** switching granularity when the current range is a preset auto-updates the preset: `daily→last-30d`, `weekly→last-90d` (last 12 weeks approx), `monthly→last-year`. When `range=custom`, the custom range is preserved.

### 3. Revenue chart component

**File:** `src/components/charts/RevenueChart.tsx` (server, pure SVG).

**Props:**
```ts
interface Props {
  buckets: { label: string; valueCents: number }[];
  variant: "compact" | "full";
  totalLabel: string;        // "$4,382.50"
  rangeLabel: string;        // "Last 30 days"
}
```

- Layout matches the approved "A · Solid gold bars" mockup.
- Header shows the range label + big gold total.
- Bar heights normalized against the max bucket value in the array (or 100 if all zero).
- Empty state: if `buckets.every(b => b.valueCents === 0)`, replace SVG with `"No revenue in this range yet"` message.
- Zero-value buckets render at ~5% height with `opacity: 0.5` (matches mockup).
- Each `<rect>` has a `<title>` with the exact date + amount for hover tooltip and screen-reader announcement.
- **Compact variant:** no granularity toggle (fixed 30d daily), ~200px tall, includes a "View full reports →" link below the chart.
- **Full variant:** shows the granularity pill toggle (visual only — actual toggle lives in `DateRangePicker`). ~300px tall.

### 4. Dashboard integration

Add a new row on `/dashboard` below the existing 4 KPI cards:
- Full-width `bg-surface` card
- Inside: `RevenueChart` with `variant="compact"`, fixed 30-day daily bucketing
- Below: right-aligned link `"View full reports →"` to `/reports`

Existing KPI cards stay unchanged. Dashboard fetches its own 30-day chart data via a call to `getRevenueReport({ from: now-30d, to: now }, "daily", tz)`.

### 5. CSV export routes

Each CSV route is a `GET` handler with this shape:

```
1. requireRole(ADMIN, STAFF, VIEWER)
2. Load BusinessSettings.timezone
3. resolveRange(searchParams, tz) → range or error
4. If error, return 400
5. Call the matching lib/reports.ts function
6. Serialize via toCsv(headers, rows)
7. Return NextResponse with:
   - Content-Type: text/csv; charset=utf-8
   - Content-Disposition: attachment; filename="bbs-{report}-{from}_to_{to}.csv"
   - Cache-Control: private, no-store
```

**CSV column specs:**

- **revenue.csv:** `Date, Payments, Refunds, Net` — money as plain dollar strings (`154.72`)
- **aging.csv:** `Aging bucket, Invoice count, Balance` — ignores date range, uses snapshot
- **payment-methods.csv:** `Method, Count, Amount, Percent of total`
- **taxes.csv:** `Tax rate, Rate percent, Taxable base, Tax collected`
- **discounts.csv:** `Invoice number, Customer, Issued date, Invoice discount, Line discounts, Total discount`
- **refunds.csv:** `Date, Invoice number, Customer, Amount, Reason, Staff`
- **top-items.csv:** `Item, SKU, Quantity sold, Revenue`

Money values in CSVs never include the `$` symbol. Dates are `YYYY-MM-DD`. Empty string for null values.

---

## Technical Architecture

### File Structure additions

```
bbs/
  src/
    lib/
      timezone.ts                                ← pure TZ range resolution (TDD)
      reports.ts                                 ← report data queries (Prisma-adjacent)
      csv.ts                                     ← pure RFC 4180 serialization (TDD)
    __tests__/
      timezone.test.ts
      csv.test.ts
    components/
      charts/
        RevenueChart.tsx                         ← server SVG
      reports/
        DateRangePicker.tsx                      ← client, URL-driven
        RevenueSection.tsx                       ← server, one per report section
        AgingSection.tsx
        PaymentMethodsSection.tsx
        TaxesSection.tsx
        DiscountsSection.tsx
        RefundsSection.tsx
        TopItemsSection.tsx
    app/
      (app)/
        reports/
          page.tsx                                ← MODIFIED: full reports page (was placeholder in Phase 1)
          revenue.csv/route.ts
          aging.csv/route.ts
          payment-methods.csv/route.ts
          taxes.csv/route.ts
          discounts.csv/route.ts
          refunds.csv/route.ts
          top-items.csv/route.ts
        dashboard/
          page.tsx                                ← MODIFIED: add compact RevenueChart card
```

### Key invariants

- `lib/timezone.ts` and `lib/csv.ts` are pure — no Prisma, no side effects, exhaustively unit-tested.
- `lib/reports.ts` queries Prisma but returns plain typed shapes — no client-side concerns.
- `RevenueChart` renders on the server, no client JS required for initial paint.
- CSV routes reuse the same `lib/reports.ts` functions the page uses — one source of truth per report.
- Every report filters draft invoices out.
- `Cache-Control: private, no-store` on CSV responses.

### Security

- `requireRole(ADMIN, STAFF, VIEWER)` on the page and every CSV route.
- Zod is not required for GET params here since values map to a small enum plus two `YYYY-MM-DD` strings; the resolver validates and rejects malformed inputs at `resolveRange`.
- No user input reaches SQL — all filters are typed enum/Date values through Prisma parameters.

---

## UI States

- **Empty range (no data):** each section shows `"No {section name} in this range"` empty state instead of the table. Header total displays `$0.00`.
- **Invalid custom range:** banner at top of `/reports` — `"Invalid date range"`; sections don't render.
- **Loading:** Server Components render synchronously on server. No loading spinners visible to the user.
- **CSV error:** 400 response with plain text body; user sees the browser's default download error (rare in practice — the picker validates before submit).
- **Chart no data:** replaces the SVG with a centered `"No revenue in this range yet"` message; header still shows `$0.00`.

---

## Performance Targets

- `/reports` page load: < 800ms on Supabase pooler for a solo shop's data volumes (six parallel Prisma queries).
- CSV generation: < 500ms for typical ranges. Streamed as soon as the query completes.
- Chart render: < 50ms server-side (pure SVG string generation).

---

## Testing Plan

### Unit (Vitest)

- `lib/timezone.test.ts`:
  - Every preset resolves correctly in `America/New_York` at a fixed reference time
  - DST transition tests (spring-forward and fall-back)
  - Custom `YYYY-MM-DD` strings parsed correctly
  - `from > to` returns error
  - Malformed strings return error
- `lib/csv.test.ts`:
  - Simple rows serialize without quotes
  - Fields with commas get quoted
  - Fields with quotes get quoted with `"` doubled
  - Fields with newlines get quoted
  - UTF-8 BOM prepended
  - CRLF row separators

### Integration (Playwright — deferred to Phase 5)

Reports and CSV UI is best covered by the Phase 5 E2E pass. Phase 4 relies on unit tests + manual smoke.

### Manual smoke (Phase 4 verification)

1. Create three payments across three days in the local dev DB (already exists from prior smokes)
2. Visit `/reports` with default range (Last 30 days) — verify all seven sections render, revenue chart shows the three bars, revenue table sums correctly
3. Change granularity to Weekly — verify chart re-buckets and range auto-adjusts
4. Change granularity to Monthly — same
5. Switch to Custom range with `from` and `to` spanning the payments — verify same data appears
6. Set `from > to` — verify the "Invalid date range" banner
7. Click "Export CSV" on Revenue section — download opens, file opens in Excel with correct columns and money as plain numbers
8. Click "Export CSV" on Refunds — download works
9. Visit `/dashboard` — verify the compact chart appears below the KPI cards with a "View full reports" link
10. Sign in as VIEWER — verify /reports loads, CSVs download

---

## Build Phases

Phase 4 does not sub-phase. Implementation tasks are:

1. **Pure engines** (TDD): `lib/timezone.ts` (resolveRange), `lib/csv.ts` (toCsv)
2. **Report queries:** `lib/reports.ts` — all seven functions
3. **Chart component:** `RevenueChart.tsx`
4. **Date-range picker:** `DateRangePicker.tsx`
5. **Report section components:** one per report (seven small server components)
6. **Reports page:** `/reports/page.tsx` composing everything
7. **CSV routes:** seven route handlers
8. **Dashboard integration:** compact chart card
9. **End-to-end smoke verification**

Each task ships one commit (except the CSV routes which bundle since they're near-identical).

---

## Out of Scope

- **Email delivery of reports** (Phase 5 or later, along with SMTP integration)
- **Scheduled reports** (send-me-a-weekly-CSV) — not modeled
- **Multi-currency in reports** — USD only, per spec
- **Custom report builder** (user picks columns / groupings) — Phase 4 uses fixed report definitions
- **Chart interactivity beyond tooltips** (zoom, brush, click-to-drill) — not needed for daily use
- **PDF export of reports** — CSV only
- **Comparison views** (this month vs last month side-by-side) — future work
