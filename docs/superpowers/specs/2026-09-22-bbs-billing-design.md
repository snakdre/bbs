---
title: Brice Beauty Supply Billing — Design Spec
date: 2026-09-22
status: approved
---

# Brice Beauty Supply Billing

A production-ready business billing application for a solo beauty supply business. Used exclusively to bill customers for product and service purchases. Fast, secure, and operable by non-technical staff.

---

## Assumptions

1. **Business name:** Brice Beauty Supply. Invoice prefix: `BBS`.
2. **Brand:** Gold `#D4B44A` on near-black `#0F0F0F`.
3. **Default currency:** USD (`$`).
4. **Scale:** Solo business — single location, small staff, no multi-tenant requirements.
5. **Payment processor:** Not connected at launch. Adapter interface stubbed for future Stripe integration. Manual payment recording only initially.
6. **Email delivery:** Not connected at launch. "Send to customer" queued for future SMTP/SendGrid integration.
7. **No mobile app** required. Responsive web only.
8. **Hosting:** Vercel + Supabase/Neon (PostgreSQL). Documented in deployment guide.

---

## Information Architecture

### Routes

| Route | Description |
|---|---|
| `/login` | Credential auth |
| `/dashboard` | KPIs, revenue chart, recent activity |
| `/bills/new` | Primary create-bill workflow |
| `/invoices` | History list with search and filters |
| `/invoices/[id]` | View · print · PDF · void · refund |
| `/customers` | List · search · create |
| `/customers/[id]` | Profile · billing history |
| `/catalog` | Products & services |
| `/reports` | Revenue, taxes, refunds, CSV export |
| `/settings` | Business info · taxes · appearance · numbering |
| `/staff` | Staff accounts and roles (admin only) |

### Navigation

Persistent left sidebar on desktop, bottom nav on mobile. "Create Bill" always prominently accessible.

---

## Data Model

All monetary values stored as **integer cents** in PostgreSQL `INT` columns. No floating-point money anywhere.

### User
```
id, name, email, passwordHash, role (ADMIN | STAFF | VIEWER), active, createdAt
```

### Customer
```
id, name, company, email, phone, billingAddress, taxId, notes, archived, createdAt, updatedAt
```

### CatalogItem
```
id, name, description, sku, unitPriceCents (INT), taxRateId (nullable FK → TaxRate), active
```

### TaxRate
```
id, name, ratePercent (Decimal), active, isDefault
```

### Invoice
```
id, invoiceNumber (unique), customerId, issuedAt, dueAt
status: DRAFT | UNPAID | PARTIAL | PAID | OVERDUE | VOID | REFUNDED
subtotalCents, discountCents, taxCents, totalCents, paidCents, balanceCents
currency (default: USD), notes, paymentTerms, createdById, updatedAt
```

### InvoiceLine
```
id, invoiceId, catalogItemId (nullable), description, quantity (Decimal),
unitPriceCents, discountType (PERCENT | FIXED | NONE), discountValue,
taxRateId (nullable), lineTotalCents
```

### Payment
```
id, invoiceId, amountCents, method (CASH | CARD | BANK | CHECK | MOBILE | OTHER),
paidAt, referenceNumber, staffId, note, idempotencyKey (unique)
```

### Refund
```
id, invoiceId, paymentId (nullable), amountCents, reason, refundedAt, staffId, note
```

### BusinessSettings (singleton)
```
id (always 1), name, logoUrl, address, phone, email, website, taxId,
currency, locale, timezone, dateFormat,
invoicePrefix, nextInvoiceSeq,
defaultPaymentTerms, defaultNotes, footer,
receiptAppearance (JSON)
```

### AuditLog
```
id, action, entityType, entityId, userId, before (JSON), after (JSON), ip, createdAt
```

---

## Design System

### Colors
| Token | Value | Use |
|---|---|---|
| `bg` | `#0F0F0F` | Page background |
| `surface` | `#1A1A1A` | Cards, panels |
| `surface-raised` | `#242424` | Inputs, hover states |
| `border` | `#2A2A2A` | Dividers, card borders |
| `gold` | `#D4B44A` | Primary actions, key numbers |
| `gold-hover` | `#B8973A` | Gold hover state |
| `text` | `#F5F0E8` | Primary text |
| `muted` | `#8A8580` | Secondary text, labels |
| `success` | `#2D6A4F` / `#52B788` | Paid status |
| `danger` | `#C0392B` / `#E74C3C` | Overdue, void, error |
| `warning` | `#B7860B` / `#F4C430` | Unpaid status |

### Typography
- Font: Geist (primary) or Inter (fallback) — system stack for body
- Monetary values: tabular-nums, never proportional
- Invoice numbers: monospace

### Status Badges
Color + text label always. Never color alone.

| Status | Color |
|---|---|
| PAID | Green |
| UNPAID | Amber |
| PARTIAL | Gold |
| OVERDUE | Red |
| DRAFT | Muted gray |
| VOID | Muted gray |
| REFUNDED | Purple |

---

## Feature Specifications

### Dashboard
- KPI cards: Today's Revenue, Outstanding, Completed Transactions, Overdue count
- Revenue chart: daily/weekly/monthly toggle, lightweight SVG bar chart (no heavy charting lib)
- Recent activity feed: last 10 transactions with customer, invoice number, amount, status
- Prominent "Create Bill" CTA always visible

### Create Bill Workflow (target: < 60 seconds)
1. **Customer step** — combobox search; create inline if not found; duplicate detection by email
2. **Items step** — add from catalog (search by name/SKU) or enter custom line item; quantity, unit price, per-item discount (% or fixed), per-item tax rate
3. **Review step** — live totals panel: subtotal, discount, tax, total; invoice-level discount option; notes and due date
4. **Payment step** — method selector (Cash / Card / Bank / Check / Mobile / Other); amount field; reference number; complete or save as draft

Totals recalculate on every line item change. All calculation in `lib/money.ts` using integer cent arithmetic.

**Calculation order:** Per-item discounts applied first to each line → line totals summed to subtotal → invoice-level discount applied to subtotal → tax applied to discounted subtotal → total = discounted subtotal + tax.

### Customers
- Create, view, edit, archive (soft delete)
- Fields: name, company, email, phone, billing address, tax ID, notes
- Duplicate detection: warn if email already exists
- Customer detail page: profile + full invoice history with running balance

### Catalog
- Create, edit, archive catalog items
- Fields: name, description, SKU, unit price, tax category, active status
- Used as quick-add in bill builder; custom ad-hoc items always allowed

### Invoices
- Auto-generated invoice number: `{prefix}-{YYYY}-{seq}` e.g. `BBS-2026-0001`
- Sequence managed with `SELECT ... FOR UPDATE` in DB transaction — no gaps, no duplicates
- View: full itemized detail, payment history, status timeline
- Actions: Edit (DRAFT only), Void (with confirmation), Refund (with amount + reason), Duplicate, Download PDF, Print, Send (stub)
- OVERDUE status: computed on read — any UNPAID or PARTIAL invoice where `dueAt < now()` is surfaced as OVERDUE. No background cron required.

### Payments
- Record full or partial payment against any unpaid/partial invoice
- Fields: amount, method, date, reference number, staff, note
- Idempotency key (client UUID) — unique constraint prevents duplicate submissions
- On payment: recalculate `paidCents`, `balanceCents`; update invoice status atomically in one DB transaction
- Immutable: payments cannot be edited, only refunded

### Receipts & Invoices (PDF)
- Generated server-side with `@react-pdf/renderer`
- Two layouts:
  - **A4/Letter invoice**: logo, business info, customer info, itemized table, totals, payment method, terms, footer
  - **Compact thermal receipt**: ~80mm width, minimal layout for point-of-sale printing
- Streamed as `application/pdf` — no temp files

### Reports
- Revenue by date range
- Paid vs outstanding totals
- Taxes collected (by tax rate)
- Discounts issued
- Payment methods breakdown
- Refunds and voids
- Top products/services by revenue
- All reports exportable as CSV

### Settings
- Business info: name, logo (compressed on upload), address, phone, email, website, tax ID
- Tax rates: create/edit/archive named rates with percent
- Invoice numbering: prefix, current sequence number
- Payment terms and default notes
- Receipt appearance: font size, show/hide fields
- Available payment methods: toggle which appear in bill builder
- Currency, locale, timezone, date format

### Staff & RBAC

| Permission | ADMIN | STAFF | VIEWER |
|---|---|---|---|
| Create/edit bills | ✓ | ✓ | — |
| Record payments | ✓ | ✓ | — |
| Void invoices | ✓ | — | — |
| Issue refunds | ✓ | — | — |
| Manage customers | ✓ | ✓ | — |
| Manage catalog | ✓ | ✓ | — |
| View reports | ✓ | ✓ | ✓ |
| View transactions | ✓ | ✓ | ✓ |
| Manage settings | ✓ | — | — |
| Manage staff | ✓ | — | — |

### Audit Log
Records: invoice creation, edits, status changes, payments, refunds, voids, settings changes, staff changes. Stores before/after JSON snapshots. Written inside same DB transaction as the mutation. Viewable by ADMIN only.

---

## Technical Architecture

### Stack
- **Framework:** Next.js 14 App Router, TypeScript strict mode
- **Styling:** Tailwind CSS with custom design tokens
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** NextAuth v5, credentials provider, bcrypt cost 12
- **Validation:** Zod (server-side authoritative; client mirrors for UX)
- **PDF:** `@react-pdf/renderer` (server-side only)
- **Charts:** Lightweight SVG — no heavy charting library
- **Testing:** Vitest (unit), Playwright (E2E)

### Project Structure
```
bbs/
  prisma/schema.prisma, seed.ts
  src/
    app/
      (auth)/login/
      (app)/layout.tsx          ← sidebar, auth check
      (app)/dashboard/
      (app)/bills/new/
      (app)/invoices/[id]/
      (app)/customers/[id]/
      (app)/catalog/
      (app)/reports/
      (app)/settings/
      (app)/staff/
      api/auth/[...nextauth]/
    lib/
      prisma.ts                 ← singleton client
      auth.ts                   ← NextAuth config
      money.ts                  ← toCents, fromCents, formatUSD
      invoice-number.ts         ← atomic sequence generation
      audit.ts                  ← write audit log entries
      pdf.ts                    ← invoice + receipt renderers
      permissions.ts            ← requireRole, can()
    components/
      ui/                       ← Button, Input, Badge, Dialog, Toast
      billing/                  ← BillBuilder, LineItemRow, TotalsPanel
      invoice/                  ← InvoiceView, InvoicePDF, ReceiptPDF
      charts/                   ← RevenueChart (SVG)
      layout/                   ← Sidebar, MobileNav
    actions/                    ← Server Actions (invoice, payment, customer, catalog)
    schemas/                    ← Zod schemas
    __tests__/                  ← unit + e2e
```

### Key Invariants
- **Money:** Integer cents only. `lib/money.ts` is the sole location for cent/dollar conversion and formatting.
- **Invoice numbers:** Atomic. `SELECT ... FOR UPDATE` on `BusinessSettings.nextInvoiceSeq` inside a Prisma transaction.
- **Payments:** Idempotency key (UUID) with DB unique constraint. Double-submit returns existing record.
- **Immutability:** Payments are never mutated. Corrections are refunds or new payments.
- **Audit:** Written in the same DB transaction as the event it records.
- **Authorization:** `requireRole()` called at the top of every Server Action and API route handler. Middleware protects all `(app)/*` routes.

### Security
- CSRF: built into Next.js Server Actions
- XSS: React output escaping + Content-Security-Policy header
- SQL injection: Prisma parameterized queries — no raw SQL
- Auth: NextAuth session + server-side role check on every action
- Passwords: bcrypt, cost factor 12
- No card data stored — payment processor adapter interface only
- Rate limiting: 5 login attempts per 15 min per IP
- Secrets: environment variables only, never logged

---

## UI States

- **Loading:** Skeleton on dashboard/list pages. Spinner on submit buttons only. No full-page spinners.
- **Empty:** Contextual CTA prompts ("No invoices yet — Create your first bill").
- **Error:** Inline field errors. Toast for server errors. `error.tsx` boundary for crashes.
- **Offline:** Banner when `navigator.onLine` is false.
- **Success:** Full-screen confirmation after payment with Print / Download PDF / New Bill actions.
- **Confirmation:** Modal dialog required before void, refund, archive, or delete. Cancel is default focus.
- **Accessibility:** WCAG 2.2 AA. `aria-live` on totals and toasts. Focus trap in modals. 44×44px touch targets. Keyboard-navigable bill builder.
- **Motion:** All animations use CSS transitions. `prefers-reduced-motion` respected throughout.

---

## Performance Targets

- Lighthouse performance ≥ 90 (production)
- Lighthouse accessibility ≥ 95
- Dashboard and invoice list: Server Components — zero client JS for initial render
- Search: debounced 300ms
- Invoice list: paginated 25/page
- Dashboard chart data: `unstable_cache` with 5-min TTL
- Bundle: Tailwind purged, no duplicate libraries, tree-shaken

---

## Testing Plan

### Unit (Vitest)
- `money.ts` — all cent/dollar helpers, edge cases
- Invoice total calculation: subtotals, per-item discounts, invoice-level discounts, tax rounding
- Partial and full payment logic, balance recalculation
- Invoice number uniqueness under concurrent generation
- Zod schema validation — valid and invalid inputs
- Permission helper — all role/action combinations

### E2E (Playwright)
- Complete create-bill → record payment → print receipt flow
- Duplicate payment submission prevention (idempotency)
- Void invoice confirmation flow
- Refund flow with reason
- RBAC: VIEWER cannot access create/edit routes
- Invoice search and filter by status, date, customer
- PDF download response headers and content
- Settings update persists across reload

---

## Build Phases

| Phase | Scope |
|---|---|
| 1 — Foundation | Repo, Prisma schema, migrations, NextAuth, seed data, Tailwind config, sidebar layout, `lib/money.ts`, unit test setup |
| 2 — Core Billing | Create Bill flow, line items, totals engine, customer search/create, catalog CRUD, invoice status, draft save |
| 3 — Payments & Documents | Payment recording, partial payments, idempotency, invoice PDF, thermal receipt, print layout, success screen |
| 4 — History, Reports & Search | Invoice list, filters, search, void & refund flows, dashboard KPIs, revenue chart, reports, CSV export |
| 5 — Settings, Polish & Deploy | Business settings, tax config, staff RBAC, audit log, a11y pass, E2E tests, Lighthouse audit, production build, deployment guide |

---

## Deployment

### Recommended
- **App:** Vercel (Node 20+)
- **Database:** Supabase or Neon (managed PostgreSQL)
- **File storage:** Vercel Blob or Cloudflare R2 (logo uploads)

### Environment Variables
```
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
BLOB_READ_WRITE_TOKEN=

# Future payment processor
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
```

### Initial Setup
```bash
npm install
npx prisma migrate deploy
npx prisma db seed        # creates admin user + sample data
npm run dev
```

---

## Out of Scope (explicitly excluded)

- CRM, payroll, inventory management, project management, social features
- Stock/warehouse tracking
- Raw card number or CVV handling
- Multi-location / multi-tenant
- Mobile native app
- Accounting/bookkeeping (beyond billing reports)
- Email delivery (stubbed for future connection)
- Online payment processing at launch (adapter interface provided)
