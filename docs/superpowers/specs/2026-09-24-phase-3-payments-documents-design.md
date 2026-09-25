---
title: Phase 3 — Payments & Documents — Design Spec
date: 2026-09-24
status: approved
supersedes: none
extends: 2026-09-22-bbs-billing-design.md
---

# Phase 3 — Payments & Documents

Extends the Brice Beauty Supply billing app with payment recording, void, refund, PDF invoices and thermal receipts, a fast-path "Save & charge" from the bill builder, and OVERDUE surfacing on read.

Phase 3 does **not** alter the Phase 2 draft flow or any Phase 1 primitive. It adds new Server Actions, one new pure library module (`lib/payments.ts`), two PDF renderers, four modals, and two new pages (`/invoices/[id]/paid`, plus GET endpoints for the PDFs).

---

## Assumptions carried in from brainstorming

1. **Payment entry is a modal from `/invoices/[id]`.** No dedicated `/pay` route.
2. **BillBuilder gets a second submit button.** "Save draft" (existing) stays; "Save & charge" creates the invoice as `UNPAID` and immediately opens the payment modal.
3. **Change/tender is displayed but not persisted as a separate field.** `Payment.amountCents` records only what applies to the balance; overage is shown to the cashier and optionally prepended to `Payment.note`.
4. **Voiding a paid or partial invoice auto-refunds** all unrefunded payment amounts in the same transaction. Reason required.
5. **Refunds are always tied to a specific `Payment.id`.** Amount clamped to the payment's unrefunded portion.
6. **OVERDUE is computed on read only.** DB `Invoice.status` is never overwritten to `OVERDUE`. Derived by `lib/status.ts::deriveDisplayStatus`.
7. **A4 invoice PDF** uses the "clean corporate" layout: white paper, black text, gold accents on the header rule and total.
8. **Thermal receipt PDF** uses the "modern minimal" layout: sans-serif body, monospace only for the invoice code, ~80mm width, solid black bars as dividers.
9. **Post-payment success screen** is a full-screen takeover with a large gold total, method + change readout, and three actions (Print receipt, Download PDF, New bill).

---

## Information Architecture

### New routes

| Route | Method | Purpose |
|---|---|---|
| `/invoices/[id]/paid` | GET | Full-screen success confirmation (requires `?receipt=1` query param) |
| `/invoices/[id]/pdf` | GET | A4/Letter invoice PDF (streamed) |
| `/invoices/[id]/receipt` | GET | Thermal receipt PDF (streamed) |

### Modified pages

| Route | Change |
|---|---|
| `/invoices/[id]` | Adds Payments section, Record Payment / Void / Refund modals, Print/Download buttons |
| `/bills/new` | BillBuilder gets a "Save & charge" primary button next to "Save draft" |
| `/invoices` | Filter dropdown gains a synthetic "OVERDUE" option; badges use derived status |
| `/dashboard` | "Overdue" KPI counts derived-overdue invoices |
| `/customers/[id]` | Invoice history rows use derived status badges |

### Sidebar/nav

No changes. `/bills/new` remains the primary CTA.

---

## Data Model

**No schema migrations.** All required fields already exist from Phase 1:

- `Payment.idempotencyKey` is `@unique`
- `Payment.amountCents`, `method`, `paidAt`, `referenceNumber`, `staffId`, `note`, `invoiceId`
- `Refund.paymentId` is nullable and FK-linked to `Payment`
- `Refund.amountCents`, `reason`, `refundedAt`, `staffId`, `note`, `invoiceId`
- `Invoice.paidCents`, `balanceCents`, `status`
- `Invoice.status` enum includes `PARTIAL`, `PAID`, `VOID`, `REFUNDED`, `OVERDUE`

### Reconciliation function (`lib/payments.ts`)

```ts
export function reconcileInvoice(
  invoice: { totalCents: number; status: InvoiceStatus },
  payments: { amountCents: number }[],
  refunds: { amountCents: number }[]
): { paidCents: number; balanceCents: number; status: InvoiceStatus }
```

**Rules:**

- `paidCents = max(0, sum(payments) - sum(refunds))` — clamped to zero, never negative
- `balanceCents = totalCents - paidCents` — may be negative in edge cases (over-payment), clamped to 0
- Status transitions:
  - `VOID` → stays `VOID` (terminal)
  - Previously `PAID` invoice with all payments fully refunded → `REFUNDED` (terminal)
  - `paidCents === 0` → keep previous status (DRAFT stays DRAFT; UNPAID stays UNPAID)
  - `0 < paidCents < totalCents` → `PARTIAL`
  - `paidCents >= totalCents` → `PAID`

The function is **pure** — no Prisma import. Callers pass plain shapes. Enables exhaustive unit testing.

### OVERDUE derivation (`lib/status.ts`)

```ts
export function deriveDisplayStatus(
  invoice: { status: InvoiceStatus; dueAt: Date | null },
  now: Date = new Date()
): InvoiceStatus
```

- If `status === "UNPAID"` or `"PARTIAL"` AND `dueAt` is set AND `dueAt < now` → returns `"OVERDUE"`
- Otherwise returns `invoice.status` unchanged
- Never mutates the DB. Applied only when rendering a badge or counting KPIs.

---

## Feature Specifications

### Record payment (STAFF + ADMIN)

**Trigger:** button on `/invoices/[id]` when `status IN (DRAFT, UNPAID, PARTIAL)` and `balanceCents > 0`. Also the endpoint invoked from BillBuilder's "Save & charge".

**Modal fields:**

| Field | Type | Default | Required |
|---|---|---|---|
| Amount tendered | Dollar string | balance amount | Yes |
| Method | Enum select | Cash | Yes |
| Reference # | String | "" | No |
| Date | Date | today | Yes |
| Note | String | "" | No |

**Client-side derived display:**

- **Applied to invoice:** `min(tendered, balanceCents)`
- **Change due:** `max(0, tendered - balanceCents)` — shown only when > 0

**Submission:**

- Idempotency key generated once when the modal mounts via `crypto.randomUUID()`, held in `useMemo`
- Same key survives re-submit attempts in one modal session
- On success:
  - If new status is `PAID` → navigate to `/invoices/[id]/paid?receipt=1`
  - Else → close modal, refresh `/invoices/[id]` in place

**Server behavior:** `recordPayment(input)` — see Server Actions section.

### Void invoice (ADMIN only)

**Trigger:** button on `/invoices/[id]` when `status NOT IN (VOID, REFUNDED)`.

**Confirmation modal:**

- Warning banner (danger-tinted): "Voiding cancels this invoice. If payments exist, they will be automatically refunded."
- Reason (required, min 3 chars, max 500)
- Cancel is default-focused (spec §UI States)
- Void button styled `danger`

**Server behavior** (`voidInvoice(id, reason)`):

1. `requireRole(ADMIN)`
2. Load invoice with payments and refunds
3. Guard: if invoice is already `VOID` or `REFUNDED`, return `{ ok: false, error: "already_terminal" }`
4. Inside a Prisma `$transaction`:
   - For each payment, compute `unrefunded = amountCents - sum(refunds.where(paymentId).amountCents)`
   - If `unrefunded > 0`, insert a Refund row with `amountCents = unrefunded`, `reason = "Invoice voided: {input reason}"`, `staffId = user.id`, `paymentId = payment.id`
   - Update invoice: `status = VOID`, `paidCents = 0`, `balanceCents = 0`
   - Write AuditLog entry with `before`/`after` snapshots

Return updated invoice. Revalidate `/invoices`, `/invoices/[id]`, `/customers/[id]`, `/dashboard`.

### Refund payment (ADMIN only)

**Trigger:** "Refund" button on each Payment row within `/invoices/[id]`, shown only when `payment.amountCents - alreadyRefunded > 0`.

**Modal fields:**

- Read-only summary: `"$X.YZ — {method} — {date}"`, `"Already refunded: $A.BC"`, `"Refundable: $R.ST"`
- Amount (dollar string, defaults to refundable balance)
- Reason (required, min 3 chars, max 500)
- Note (optional, max 500)

**Server behavior** (`refundPayment(paymentId, {amount, reason, note})`):

1. `requireRole(ADMIN)`
2. Load payment + its refunds + parent invoice
3. Compute `refundable = payment.amountCents - sum(existing refunds where paymentId)`
4. Clamp `refundCents = min(toCents(amount), refundable)`. If `refundCents === 0`, return `{ ok: false, error: "nothing_to_refund" }`
5. Transaction:
   - Insert Refund with `paymentId`, `invoiceId`, `amountCents = refundCents`, `reason`, `note`, `staffId`
   - Recompute reconciliation against all payments/refunds for this invoice
   - Special transition: if previous invoice status was `PAID` and new `paidCents === 0` (i.e., every payment fully refunded) → set status to `REFUNDED`
   - Otherwise apply the normal status rules from `reconcileInvoice`
   - Write AuditLog
6. Revalidate `/invoices`, `/invoices/[id]`, `/customers/[id]`, `/dashboard`

### Save & charge (STAFF + ADMIN)

**BillBuilder change:** add a second submit button "Save & charge" beside the existing "Save draft".

**Server behavior:** `createDraftBill` gains an optional `chargeImmediately: boolean` in its schema. When `true`:

- Same transaction creates the invoice with `status = UNPAID` (instead of `DRAFT`)
- Response returns `{ ok: true, invoice, mode: "charge" }`
- Client immediately opens the payment modal targeting `invoice.id`; the modal's tendered amount defaults to `invoice.totalCents`

When `false` (default): behavior identical to Phase 2.

**If the cashier closes the payment modal without submitting:** the invoice already exists as `UNPAID` (the invoice number was reserved, the transaction committed). The user lands on `/invoices/[id]` normally and can retry the payment via the standard "Record payment" button. No cleanup or rollback — this is deliberate, matches how in-person sales fail (customer leaves to grab their wallet).

### Success screen — `/invoices/[id]/paid`

**Layout** (mockup "A · Centered receipt-first"):

- Full-screen centered content
- Large green circular ✓ (72×72, background `success` DEFAULT)
- "Payment received" — 20px semibold text
- Sub-line: `"{invoiceNumber} · {customerName}"` in monospace muted
- Elevated total card: label "TOTAL PAID", large gold `$X.YZ`, sub-line `"{method} · {change note if any}"`
- Primary actions row: **Print receipt** (gold), **Download PDF** (secondary)
- Secondary: **+ New bill** (full-width outline button)
- Small "View invoice" link at the bottom

**Guards:**

- Requires `?receipt=1` query param. Without it, redirect to `/invoices/[id]`.
- If `invoice.status !== PAID`, redirect to `/invoices/[id]`.
- `requireRole(ADMIN, STAFF, VIEWER)` — everyone with dashboard access can see the confirmation.

**Print behavior:** "Print receipt" opens `/invoices/[id]/receipt` in a new tab; browser handles native print dialog if user chooses.

### PDF renderers

**Two GET routes**, both stream `application/pdf`.

#### `/invoices/[id]/pdf` — A4/Letter invoice ("clean corporate")

- Paper size: 8.5 × 11 inches (US Letter). Fits A4 with minor margin variance.
- Header: business info left (name, address, phone, email), invoice metadata right (label "INVOICE", monospace number, issued date, due date). Gold horizontal rule separator below.
- Bill-to block left, "Balance due" callout right (small label, large plain-text amount).
- Line items table: Description / Qty / Unit / Total columns. Per-line discount noted inline as "(10% off)" next to description. Zebra striping optional (skip for simplicity).
- Totals block, right-aligned: Subtotal / Discount / Tax (with rate) / **Total** (bold, gold underline).
- Payments summary (only if payments exist): a compact list "Paid {method} $X.YZ on {date}" followed by "Balance $Y.YY".
- Footer: BusinessSettings `defaultPaymentTerms` + custom `footer` text.

#### `/invoices/[id]/receipt` — Thermal receipt ("modern minimal")

- Width: 80mm (~226 points). Height: dynamic.
- Business block centered (name, address, phone) using sans-serif.
- Compact monospace line: `"{invoiceNumber} · MM/dd HH:mm"`
- Solid 2pt black bars as section dividers (not dashed).
- Line items: each line is "Name" (sans-serif) with a smaller-muted "qty × unit — discount note" line beneath, and total right-aligned.
- Totals stacked: Subtotal / Discount / Tax / **Total** (bold, ~12pt).
- Tender + change if applicable: `"{method} $tendered"` and `"Change $X.XX"` lines.
- Footer: "Thank you for your business" — small, centered.

Both renderers take fully-materialized typed props (no Prisma imports inside JSX). Data-loading happens in the route handler:

```ts
GET /invoices/[id]/pdf =>
  requireRole → prisma.invoice.findUnique({...include}) → renderToStream(<InvoicePdfA4 {...props} />) → stream response
```

Response headers:

- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename="{invoiceNumber}.pdf"` (for A4) / `"{invoiceNumber}-receipt.pdf"` (for thermal)
- `Cache-Control: private, no-store` (financial documents should not be cached)

### OVERDUE handling

- **List query:** the filter dropdown gains an "OVERDUE" option. Selecting it maps to `where: { status: { in: ["UNPAID", "PARTIAL"] }, dueAt: { lt: new Date() } }`.
- **Row rendering:** every list/detail badge is wrapped by `deriveDisplayStatus`.
- **Dashboard KPI:** the "Overdue" tile counts `where: { status: { in: ["UNPAID", "PARTIAL"] }, dueAt: { lt: new Date() } }`.
- **No writes.** DB `Invoice.status` is never set to `OVERDUE`.

### Invoice detail page updates

**Action bar** (top of `/invoices/[id]`):

- Left: `[← All invoices]` link (existing)
- Center (STAFF+, only when `balanceCents > 0`): `[Record payment]` primary gold
- Right group: `[Print receipt]`, `[Download PDF]`, and (ADMIN-only) `[Void invoice]` styled `danger` outline

**New Payments section** below the totals block:

```
Payments
────────────────────────────────
$154.72   Cash   2026-09-24    BBS Admin    Ref: 4521    [Refund]
  ↳ Refund $10.00   "Damaged product"   2026-09-25   BBS Admin
────────────────────────────────
```

- Refund button is ADMIN-only and only rendered when payment has refundable balance
- Empty state: `"No payments recorded."` with a `[Record payment]` primary CTA for STAFF+

---

## Server Actions

All actions live in `bbs/src/actions/payments.ts` and share these patterns:

- `"use server"` module directive
- Zod parse the input first — no direct property access on `unknown`
- `requireRole(...)` early — throws `ForbiddenError` before touching DB
- All financial writes inside `prisma.$transaction`
- All monetary math via `lib/money.ts` and `lib/payments.ts` — never bare floats

### `recordPayment(input)`

**Input schema:**

```ts
{
  invoiceId: string;
  tendered: string;              // dollar string, refined to positive & <= 9,999,999
  method: PaymentMethod enum;
  paidAt: string | null;         // ISO date or null (defaults to now)
  referenceNumber: string | null;
  note: string | null;
  idempotencyKey: string;         // UUID from client
}
```

**Steps:**

1. Gate on `STAFF | ADMIN`, parse input
2. Load invoice
3. If invoice `status IN (VOID, REFUNDED, PAID)` → return `{ ok: false, error: "invoice_terminal" }`
4. Compute `tenderedCents = toCents(tendered)`, `appliedCents = min(tenderedCents, invoice.balanceCents)`, `changeCents = tenderedCents - appliedCents`
5. If `changeCents > 0`, prepend `"Tendered: {tendered}, change ${change}. "` to `note`
6. Transaction:
   - Insert Payment with `amountCents = appliedCents`, all fields, `idempotencyKey`. Catch `P2002` and return existing payment.
   - Load all payments + refunds for this invoice
   - Compute new `{paidCents, balanceCents, status}` via `reconcileInvoice`
   - Update Invoice with those values
   - Write AuditLog
7. Revalidate paths; return `{ ok: true, payment, invoice }`

### `voidInvoice(id, reason)` and `refundPayment(paymentId, input)`

See "Void invoice" and "Refund payment" sections above for full spec.

### `createDraftBill` update (extends Phase 2)

Add `chargeImmediately?: boolean` (default `false`) to the schema. When `true`, set `status = "UNPAID"` on the created Invoice (instead of `DRAFT`). No other changes to Phase 2 behavior.

---

## Technical Architecture

### Stack additions

- **PDF:** `@react-pdf/renderer` (server-side only). No new runtime deps; installed if not present. Version pinned in `package.json`.
- **UUID for idempotency:** `crypto.randomUUID()` in the client (native browser API; no npm dep).

### File Structure additions

```
bbs/
  src/
    lib/
      payments.ts                       ← pure reconcileInvoice (TDD)
      status.ts                         ← pure deriveDisplayStatus (TDD)
      pdf/
        InvoicePdfA4.tsx                ← @react-pdf React component
        ReceiptPdfThermal.tsx           ← @react-pdf React component
        types.ts                        ← shared props types for PDF renderers
    __tests__/
      payments.test.ts
      status.test.ts
    schemas/
      payment.ts                        ← Zod for recordPayment, refund, void
    actions/
      payments.ts                       ← recordPayment, voidInvoice, refundPayment
    components/
      billing/
        BillBuilder.tsx                 ← MODIFIED: adds "Save & charge"
        PaymentModal.tsx                ← client, opens over invoice detail or after Save & charge
        VoidModal.tsx                   ← client, ADMIN only
        RefundModal.tsx                 ← client, ADMIN only, per-payment
      invoices/
        PaymentsSection.tsx             ← server, renders payment rows + Refund buttons
        InvoiceActionBar.tsx            ← server, wires up the modals
    app/
      (app)/
        invoices/
          [id]/
            page.tsx                    ← MODIFIED: wires action bar + payments section
            paid/page.tsx               ← success screen (?receipt=1 guarded)
            pdf/route.ts                ← A4 GET stream
            receipt/route.ts            ← thermal GET stream
      api/
        (none new — Server Actions cover all mutations)
```

### Key invariants (extends Phase 1's list)

- **Payment immutability:** no update path exists. Corrections are new Payments or Refunds.
- **Idempotency:** every payment insert must include the client-generated `idempotencyKey`. Duplicate submissions are silent successes.
- **Reconciliation is pure:** `lib/payments.ts` has zero Prisma imports.
- **PDFs are stateless:** renderers take fully-materialized props; no DB access inside JSX.
- **OVERDUE never persisted:** DB `Invoice.status` column is never written with `OVERDUE`.
- **Audit trail:** every void/refund/payment writes an `AuditLog` row inside the same transaction as the mutation.

### Security

- `requireRole` on every action (STAFF+ for payments; ADMIN-only for void/refund)
- Zod validates every input at the boundary; refined string schemas reject scientific notation
- PDF routes gated by `requireRole(ADMIN, STAFF, VIEWER)` — VIEWER can already read invoices
- `Cache-Control: private, no-store` on PDF responses
- No card data ever stored; `method` is an enum, `referenceNumber` is opaque text

---

## UI States (extends Phase 1)

- **Payment modal loading:** spinner on submit button only; other fields disabled until server response
- **Payment modal error:** field-level errors from Zod; red banner for server errors; modal stays open, idempotency key preserved
- **Void modal confirmation:** Cancel is default focus; Void button `danger`; warns about auto-refund if payments exist
- **Refund modal:** amount defaults to full refundable; reason required; modal closes on success
- **Success screen:** full-screen only; no sidebar; Print/Download open in new tabs
- **Overdue badge:** red `danger-bright` background — visually distinct from `UNPAID` amber
- **PDF errors:** if renderer throws, route returns a 500 with a small text body; page-level errors surface through `(app)/error.tsx` if triggered from a link

---

## Performance Targets

- Payment modal open → save: < 500ms round trip on Supabase pooler
- PDF generation: < 1s for typical invoice (< 20 lines); streamed so the browser starts receiving bytes immediately
- Idempotency dedup path: < 200ms (single unique-constraint check)
- Invoice detail with 50+ payments: renders in one paint; Payments section paginated at 100 (out-of-scope for Phase 3 if not needed)

---

## Testing Plan

### Unit (Vitest)

- `lib/payments.test.ts`:
  - `reconcileInvoice`: zero payments → keep status; single full payment → PAID; two partial payments → PARTIAL then PAID; over-payment via multiple partials → PAID + clamped balance; refund reducing paid to zero → REFUNDED (when transitioning from PAID); refund partial → PARTIAL; refund of a partial → still PARTIAL; refund larger than paidCents → clamped
- `lib/status.test.ts`:
  - `deriveDisplayStatus`: all 7 statuses × (dueAt null / future / past) — only UNPAID/PARTIAL + past dueAt → OVERDUE
- Existing suites (`money.test.ts`, `billing.test.ts`) stay green — no changes to Phase 1/2 modules

### Integration (manual smoke, run at end of Phase 3)

- Create bill via Save & charge → payment modal opens → record cash payment with change → success screen shows → thermal PDF opens with correct total and change readout → A4 PDF opens with correct format → invoice status is `PAID`, balance `$0.00`
- Record partial payment → status transitions to `PARTIAL` → record second payment → transitions to `PAID`
- Duplicate submission (double-click "Record payment"): Payment table has one row, not two — verify by counting via Prisma
- Void a paid invoice as ADMIN → auto-refund rows created; invoice status `VOID`
- Refund $10 of a $154.72 payment → invoice status stays `PAID` (still fully paid, since refund is against a specific payment; balance stays 0). Then refund the rest of the same payment → invoice transitions to `REFUNDED`
- Set an invoice's `dueAt` to yesterday via SQL → verify OVERDUE badge appears without persisting; dashboard "Overdue" KPI counts it
- VIEWER can download PDFs, cannot open Record Payment modal, cannot see Void or Refund buttons

---

## Build Phases

Phase 3 itself does not further sub-phase. Implementation tasks are:

1. **Pure engines** (TDD): `reconcileInvoice`, `deriveDisplayStatus`
2. **Payment schema and Server Action**: `recordPayment` with idempotency
3. **Payment modal** (client) + wire into `/invoices/[id]`
4. **Void action + modal**
5. **Refund action + modal**
6. **Save & charge** — `createDraftBill` extension + BillBuilder button + auto-open modal
7. **Success screen** (`/invoices/[id]/paid`)
8. **Payments section** on invoice detail (list + refund buttons)
9. **OVERDUE surfacing** — apply `deriveDisplayStatus` at list/detail/dashboard
10. **A4 invoice PDF** renderer + GET route
11. **Thermal receipt PDF** renderer + GET route
12. **End-to-end smoke verification**

Each task ships one commit.

---

## Out of Scope

- Email delivery (still stubbed — Phase 5)
- Online payment processing (Stripe integration — post-launch)
- Multi-currency (spec is USD only for Phase 3)
- Deposits / prepayments (creating a Payment before an Invoice exists) — not modeled
- Split tender (multiple methods on one payment) — future extension via multiple Payment rows already covers it, but no dedicated UI in Phase 3
- Recurring invoices — future work
- Refund reversal (un-refunding) — refunds are terminal; issue a new Payment if needed
- Adjusting payments after creation — payments are immutable per spec
