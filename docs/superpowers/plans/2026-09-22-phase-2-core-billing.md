# Phase 2 — Core Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the single-page Create Bill workflow — customer picker, decimal-quantity line items with per-line discounts and per-line tax rates, live totals, atomic invoice numbering on draft creation — backed by Customer and Catalog CRUD and an Invoice list.

**Architecture:** Server Components for pages and lists; one client component (`BillBuilder`) that owns bill-form state and calls Server Actions. All mutating work goes through Server Actions in `src/actions/*`, each gated by `requireRole(...)` from Phase 1. The totals engine is a pure, TDD'd module in `src/lib/billing.ts` that operates only on integer cents (via `lib/money.ts`) and typed inputs — never touching Prisma. Invoice numbering is atomic via `SELECT ... FOR UPDATE` inside a Prisma `$transaction`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 (Postgres/Supabase), Zod, NextAuth v5 (already wired), Tailwind, Vitest.

---

## Decisions carried in from brainstorming

1. **Single-page bill builder** (not a wizard). Customer + line items + totals + actions all visible on one screen.
2. **Explicit "Save Draft" button** only — no autosave.
3. **Invoice number assigned on draft creation.** Voided drafts leave visible gaps in the sequence; this is acceptable per spec (audit trail preferred over cosmetic contiguity).
4. **Integer default quantity, decimal allowed** — schema stays `Decimal(12,4)`; UI shows `1` by default, accepts `0.5`, `2.5`, etc.
5. **Discounts:** both `PERCENT` and `FIXED` supported at line and invoice level.
6. **Search:** server-side, debounced ~250ms — Server Actions returning up to 20 results.
7. **Tax model:** per-line tax rate, sourced from the catalog item's default and overridable per line.

Calculation order (from the spec, restated for clarity — enforced in `lib/billing.ts`):
1. For each line: `lineDiscountedSubtotal = round(unitPriceCents × qty)` then apply per-line discount (PERCENT|FIXED|NONE) → `lineTotalCents` **before tax**.
2. `subtotalCents = sum(lineTotalCents)` across all lines.
3. Apply invoice-level discount (PERCENT|FIXED|NONE) to `subtotalCents` → `discountedSubtotalCents`.
4. For each line: `lineTaxCents = round(lineTotalCents × (line.taxRatePercent / 100))`. `taxCents = sum(lineTaxCents)`.
   *Note:* invoice-level discount does **not** proportionally reduce line tax bases — this is a deliberate simplification. If we wanted invoice-level discounts to pass through to tax, we'd need to prorate. Spec is silent; this is the simpler read and is called out in `billing.ts` tests.
5. `totalCents = discountedSubtotalCents + taxCents`.
6. Persisted fields on `Invoice`: `subtotalCents`, `discountCents` (invoice-level), `taxCents`, `totalCents`, `paidCents (=0 for draft)`, `balanceCents (= totalCents)`.

---

## File Structure

**New files created in Phase 2:**

```
bbs/
  src/
    lib/
      billing.ts                        ← pure totals engine (TDD)
      invoice-number.ts                 ← atomic sequence generation (integration-tested via seed DB)
      dates.ts                          ← small helper for due-date defaults (2-3 fns)
    schemas/
      customer.ts                       ← create/update Zod schemas
      catalog.ts                        ← create/update Zod schemas
      bill.ts                           ← create-draft-bill payload schema
    actions/
      customers.ts                      ← createCustomer, updateCustomer, archiveCustomer, searchCustomers
      catalog.ts                        ← createCatalogItem, updateCatalogItem, archiveCatalogItem, searchCatalog, listTaxRates
      bills.ts                          ← createDraftBill (atomic invoice number + lines + totals)
    __tests__/
      billing.test.ts                   ← unit tests for the totals engine
    components/
      ui/
        Input.tsx                       ← text input primitive (shared)
        Select.tsx                      ← native <select> primitive (shared)
        Combobox.tsx                    ← generic async-search combobox (customer + catalog)
        Dialog.tsx                      ← modal primitive (used by inline create-customer)
      billing/
        BillBuilder.tsx                 ← client, top-level bill-form owner
        LineItemRow.tsx                 ← per-line editor
        TotalsPanel.tsx                 ← reactive totals display
        CustomerPicker.tsx              ← combobox + inline create-customer
        CatalogPicker.tsx               ← combobox that emits a Line prefill
        DiscountPicker.tsx              ← percent/fixed/none control
    app/
      (app)/
        bills/
          new/
            page.tsx                    ← server: fetch tax rates & user, render BillBuilder
        customers/
          page.tsx                      ← server: list + search
          new/page.tsx                  ← server: render CustomerForm
          [id]/
            page.tsx                    ← server: customer detail + invoice history
            edit/page.tsx               ← server: render CustomerForm in edit mode
        catalog/
          page.tsx                      ← server: list + search
          new/page.tsx                  ← server: render CatalogItemForm
          [id]/edit/page.tsx            ← server: render CatalogItemForm in edit mode
        invoices/
          page.tsx                      ← server: paginated list w/ filters
          [id]/page.tsx                 ← server: minimal detail (Phase 2 read-only)
      not-authorized/
        page.tsx                        ← rendered when Server Action throws ForbiddenError
    components/
      customers/
        CustomerForm.tsx                ← client, shared create/edit form
        CustomerTable.tsx               ← server, list rendering
      catalog/
        CatalogItemForm.tsx             ← client, shared create/edit form
        CatalogTable.tsx                ← server, list rendering
      invoices/
        InvoiceListTable.tsx            ← server, list rendering
        InvoiceStatusBadge.tsx          ← server, small pill
```

Each file has one responsibility. The totals engine (`lib/billing.ts`) is deliberately Prisma-free so it can be exhaustively unit-tested. Server Actions in `actions/*` are thin: parse input with Zod → gate with `requireRole` → call Prisma → call `billing.ts` if needed → return typed result.

**Naming convention:** All Server Action files export a namespace-like object OR named functions; components import functions directly by name. Zod schemas live under `schemas/` and are the source of truth for input types.

---

## Task 1: Domain Types Shared by Billing Engine

**Files:**
- Create: `bbs/src/lib/billing-types.ts`

This is a small types-only file so `lib/billing.ts` and the Server Actions share a vocabulary without importing Prisma types into pure code.

- [ ] **Step 1: Create `bbs/src/lib/billing-types.ts`**

```ts
export type DiscountKind = "PERCENT" | "FIXED" | "NONE";

export interface DiscountInput {
  kind: DiscountKind;
  /** For PERCENT: 0..100 (e.g., 10 = 10%). For FIXED: integer cents. Ignored when NONE. */
  value: number;
}

export interface LineInput {
  /** Integer cents per unit. */
  unitPriceCents: number;
  /** Decimal quantity as a plain JS number. Callers must clamp precision before passing. */
  quantity: number;
  /** Per-line discount (before tax). */
  discount: DiscountInput;
  /** Tax rate applied to this line, expressed as percent (e.g., 7.0000). 0 = no tax. */
  taxRatePercent: number;
}

export interface LineTotals {
  /** unitPrice * qty, rounded to cents. Pre-discount, pre-tax. */
  grossCents: number;
  /** Cents subtracted by the line's own discount. Never exceeds grossCents. */
  lineDiscountCents: number;
  /** grossCents - lineDiscountCents. This is what accumulates into subtotal. */
  lineTotalCents: number;
  /** Tax computed on lineTotalCents. */
  lineTaxCents: number;
}

export interface InvoiceTotals {
  lines: LineTotals[];
  subtotalCents: number;
  /** Invoice-level discount applied to subtotalCents. Never exceeds subtotalCents. */
  invoiceDiscountCents: number;
  /** Sum of lineTaxCents across all lines. */
  taxCents: number;
  /** subtotalCents - invoiceDiscountCents + taxCents. */
  totalCents: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/lib/billing-types.ts
git commit -m "feat: add shared billing input/output types"
```

---

## Task 2: Billing Engine — Failing Tests

**Files:**
- Create: `bbs/src/__tests__/billing.test.ts`

- [ ] **Step 1: Create `bbs/src/__tests__/billing.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeLineTotals, computeInvoiceTotals } from "@/lib/billing";
import type { LineInput } from "@/lib/billing-types";

function line(overrides: Partial<LineInput> = {}): LineInput {
  return {
    unitPriceCents: 1000,
    quantity: 1,
    discount: { kind: "NONE", value: 0 },
    taxRatePercent: 0,
    ...overrides
  };
}

describe("computeLineTotals", () => {
  it("computes gross by multiplying unit price by quantity", () => {
    const totals = computeLineTotals(line({ unitPriceCents: 1000, quantity: 3 }));
    expect(totals.grossCents).toBe(3000);
    expect(totals.lineDiscountCents).toBe(0);
    expect(totals.lineTotalCents).toBe(3000);
    expect(totals.lineTaxCents).toBe(0);
  });

  it("rounds gross half away from zero", () => {
    const totals = computeLineTotals(line({ unitPriceCents: 333, quantity: 3 }));
    expect(totals.grossCents).toBe(999);
  });

  it("applies a PERCENT discount to gross", () => {
    const totals = computeLineTotals(
      line({ unitPriceCents: 1000, quantity: 2, discount: { kind: "PERCENT", value: 10 } })
    );
    expect(totals.grossCents).toBe(2000);
    expect(totals.lineDiscountCents).toBe(200);
    expect(totals.lineTotalCents).toBe(1800);
  });

  it("applies a FIXED discount to gross in cents", () => {
    const totals = computeLineTotals(
      line({ unitPriceCents: 1000, quantity: 1, discount: { kind: "FIXED", value: 250 } })
    );
    expect(totals.lineDiscountCents).toBe(250);
    expect(totals.lineTotalCents).toBe(750);
  });

  it("clamps FIXED discount to never exceed gross", () => {
    const totals = computeLineTotals(
      line({ unitPriceCents: 500, quantity: 1, discount: { kind: "FIXED", value: 999 } })
    );
    expect(totals.lineDiscountCents).toBe(500);
    expect(totals.lineTotalCents).toBe(0);
  });

  it("clamps PERCENT discount at 100 percent", () => {
    const totals = computeLineTotals(
      line({ unitPriceCents: 500, quantity: 2, discount: { kind: "PERCENT", value: 150 } })
    );
    expect(totals.lineDiscountCents).toBe(1000);
    expect(totals.lineTotalCents).toBe(0);
  });

  it("computes tax against post-discount lineTotal", () => {
    const totals = computeLineTotals(
      line({
        unitPriceCents: 1000,
        quantity: 1,
        discount: { kind: "PERCENT", value: 10 },
        taxRatePercent: 7
      })
    );
    expect(totals.lineTotalCents).toBe(900);
    expect(totals.lineTaxCents).toBe(63); // round(900 * 0.07) = 63
  });

  it("throws on negative unit price", () => {
    expect(() => computeLineTotals(line({ unitPriceCents: -100 }))).toThrow();
  });

  it("throws on negative quantity", () => {
    expect(() => computeLineTotals(line({ quantity: -1 }))).toThrow();
  });

  it("throws on negative discount value", () => {
    expect(() => computeLineTotals(line({ discount: { kind: "PERCENT", value: -5 } }))).toThrow();
  });

  it("throws on negative tax rate", () => {
    expect(() => computeLineTotals(line({ taxRatePercent: -1 }))).toThrow();
  });
});

describe("computeInvoiceTotals", () => {
  it("returns zeros for an empty invoice", () => {
    const totals = computeInvoiceTotals([], { kind: "NONE", value: 0 });
    expect(totals).toEqual({
      lines: [],
      subtotalCents: 0,
      invoiceDiscountCents: 0,
      taxCents: 0,
      totalCents: 0
    });
  });

  it("sums line totals into subtotal", () => {
    const totals = computeInvoiceTotals(
      [
        line({ unitPriceCents: 1000, quantity: 2 }),
        line({ unitPriceCents: 500, quantity: 1 })
      ],
      { kind: "NONE", value: 0 }
    );
    expect(totals.subtotalCents).toBe(2500);
    expect(totals.totalCents).toBe(2500);
  });

  it("applies invoice-level PERCENT discount to subtotal", () => {
    const totals = computeInvoiceTotals(
      [line({ unitPriceCents: 1000, quantity: 1 })],
      { kind: "PERCENT", value: 10 }
    );
    expect(totals.invoiceDiscountCents).toBe(100);
    expect(totals.totalCents).toBe(900);
  });

  it("applies invoice-level FIXED discount to subtotal", () => {
    const totals = computeInvoiceTotals(
      [line({ unitPriceCents: 1000, quantity: 1 })],
      { kind: "FIXED", value: 250 }
    );
    expect(totals.invoiceDiscountCents).toBe(250);
    expect(totals.totalCents).toBe(750);
  });

  it("clamps invoice-level FIXED discount to subtotal", () => {
    const totals = computeInvoiceTotals(
      [line({ unitPriceCents: 500, quantity: 1 })],
      { kind: "FIXED", value: 9999 }
    );
    expect(totals.invoiceDiscountCents).toBe(500);
    expect(totals.totalCents).toBe(0);
  });

  it("sums per-line tax and adds it AFTER invoice discount (documented behavior)", () => {
    // Two $10 lines, each with 7% tax; 10% invoice discount.
    // Per-line: lineTotal=1000, lineTax=70 each. Sum tax = 140.
    // Subtotal = 2000. Invoice discount = 200. Total = 1800 + 140 = 1940.
    const totals = computeInvoiceTotals(
      [
        line({ unitPriceCents: 1000, quantity: 1, taxRatePercent: 7 }),
        line({ unitPriceCents: 1000, quantity: 1, taxRatePercent: 7 })
      ],
      { kind: "PERCENT", value: 10 }
    );
    expect(totals.subtotalCents).toBe(2000);
    expect(totals.invoiceDiscountCents).toBe(200);
    expect(totals.taxCents).toBe(140);
    expect(totals.totalCents).toBe(1940);
  });

  it("handles mixed tax rates across lines", () => {
    const totals = computeInvoiceTotals(
      [
        line({ unitPriceCents: 1000, quantity: 1, taxRatePercent: 7 }),
        line({ unitPriceCents: 1000, quantity: 1, taxRatePercent: 0 })
      ],
      { kind: "NONE", value: 0 }
    );
    expect(totals.taxCents).toBe(70);
    expect(totals.totalCents).toBe(2070);
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run in `bbs/`:

```bash
npm test
```

Expected: FAIL with "Cannot find module '@/lib/billing'".

---

## Task 3: Billing Engine — Implementation

**Files:**
- Create: `bbs/src/lib/billing.ts`

- [ ] **Step 1: Create `bbs/src/lib/billing.ts`**

```ts
import { multiplyCents } from "@/lib/money";
import type {
  DiscountInput,
  InvoiceTotals,
  LineInput,
  LineTotals
} from "@/lib/billing-types";

function assertNonNegative(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number, got ${value}`);
  }
}

function applyDiscount(baseCents: number, discount: DiscountInput): number {
  if (discount.kind === "NONE") return 0;
  assertNonNegative("discount.value", discount.value);
  if (discount.kind === "PERCENT") {
    const capped = Math.min(discount.value, 100);
    return Math.min(baseCents, multiplyCents(baseCents, capped / 100));
  }
  // FIXED
  return Math.min(baseCents, Math.trunc(discount.value));
}

export function computeLineTotals(input: LineInput): LineTotals {
  assertNonNegative("unitPriceCents", input.unitPriceCents);
  assertNonNegative("quantity", input.quantity);
  assertNonNegative("taxRatePercent", input.taxRatePercent);

  const grossCents = multiplyCents(input.unitPriceCents, input.quantity);
  const lineDiscountCents = applyDiscount(grossCents, input.discount);
  const lineTotalCents = grossCents - lineDiscountCents;
  const lineTaxCents = multiplyCents(lineTotalCents, input.taxRatePercent / 100);

  return { grossCents, lineDiscountCents, lineTotalCents, lineTaxCents };
}

export function computeInvoiceTotals(
  lines: LineInput[],
  invoiceDiscount: DiscountInput
): InvoiceTotals {
  const lineTotals = lines.map(computeLineTotals);
  const subtotalCents = lineTotals.reduce((s, l) => s + l.lineTotalCents, 0);
  const invoiceDiscountCents = applyDiscount(subtotalCents, invoiceDiscount);
  const taxCents = lineTotals.reduce((s, l) => s + l.lineTaxCents, 0);
  const totalCents = subtotalCents - invoiceDiscountCents + taxCents;

  return {
    lines: lineTotals,
    subtotalCents,
    invoiceDiscountCents,
    taxCents,
    totalCents
  };
}
```

- [ ] **Step 2: Run tests, expect pass**

Run in `bbs/`:

```bash
npm test
```

Expected: all billing tests PASS. Existing money tests should still pass.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/__tests__/billing.test.ts bbs/src/lib/billing.ts
git commit -m "feat: add pure totals engine with per-line and invoice-level discounts"
```

---

## Task 4: Atomic Invoice Number Generator

**Files:**
- Create: `bbs/src/lib/invoice-number.ts`

- [ ] **Step 1: Create `bbs/src/lib/invoice-number.ts`**

```ts
import type { Prisma } from "@prisma/client";

/**
 * Reserve the next invoice number using SELECT ... FOR UPDATE on BusinessSettings.
 * MUST be called inside a Prisma $transaction so the row lock is released
 * atomically with the caller's other writes.
 *
 * Format: {prefix}-{YYYY}-{seq:04}, e.g. BBS-2026-0001.
 */
export async function reserveInvoiceNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date()
): Promise<string> {
  const rows = await tx.$queryRaw<
    { id: number; invoicePrefix: string; nextInvoiceSeq: number }[]
  >`SELECT id, "invoicePrefix", "nextInvoiceSeq" FROM "BusinessSettings" WHERE id = 1 FOR UPDATE`;

  if (rows.length === 0) {
    throw new Error("BusinessSettings row (id=1) not found — seed the database first");
  }
  const row = rows[0];
  const seq = row.nextInvoiceSeq;
  const year = now.getUTCFullYear();
  const number = `${row.invoicePrefix}-${year}-${seq.toString().padStart(4, "0")}`;

  await tx.businessSettings.update({
    where: { id: 1 },
    data: { nextInvoiceSeq: seq + 1 }
  });

  return number;
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/lib/invoice-number.ts
git commit -m "feat: add atomic invoice-number reservation with FOR UPDATE"
```

*(Integration coverage for concurrency is exercised later by the create-bill Server Action against the seeded DB. A dedicated concurrency test suite is a Phase 5 hardening task.)*

---

## Task 5: UI Primitives — Input, Select, Dialog

**Files:**
- Create: `bbs/src/components/ui/Input.tsx`
- Create: `bbs/src/components/ui/Select.tsx`
- Create: `bbs/src/components/ui/Dialog.tsx`

- [ ] **Step 1: Create `bbs/src/components/ui/Input.tsx`**

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = "", ...props },
  ref
) {
  const inputId = id ?? props.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm text-muted mb-1">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={[
          "w-full h-11 px-3 rounded bg-surface-raised border border-border text-text",
          "focus:outline-none focus:ring-2 focus:ring-gold",
          error ? "border-danger-bright" : "",
          className
        ].join(" ")}
        {...props}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-bright">
          {error}
        </p>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Create `bbs/src/components/ui/Select.tsx`**

```tsx
import { forwardRef, type SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id, className = "", children, ...props },
  ref
) {
  const selectId = id ?? props.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="block text-sm text-muted mb-1">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={[
          "w-full h-11 px-3 rounded bg-surface-raised border border-border text-text",
          "focus:outline-none focus:ring-2 focus:ring-gold",
          error ? "border-danger-bright" : "",
          className
        ].join(" ")}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-bright">
          {error}
        </p>
      )}
    </div>
  );
});
```

- [ ] **Step 3: Create `bbs/src/components/ui/Dialog.tsx`**

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="bg-surface border border-border rounded-lg p-6 max-w-lg w-[calc(100%-2rem)] text-text backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="text-muted hover:text-text text-xl leading-none"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add bbs/src/components/ui/Input.tsx bbs/src/components/ui/Select.tsx bbs/src/components/ui/Dialog.tsx
git commit -m "feat: add Input, Select, and Dialog UI primitives"
```

---

## Task 6: Customer Schemas and Actions

**Files:**
- Create: `bbs/src/schemas/customer.ts`
- Create: `bbs/src/actions/customers.ts`

- [ ] **Step 1: Create `bbs/src/schemas/customer.ts`**

```ts
import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .email("Enter a valid email")
  .max(255)
  .or(z.literal(""))
  .transform((v) => (v === "" ? null : v));

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  company: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
  email: emailField.nullable().optional(),
  phone: z.string().trim().max(40).optional().transform((v) => (v ? v : null)),
  billingAddress: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
  taxId: z.string().trim().max(50).optional().transform((v) => (v ? v : null)),
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null))
});

export const customerUpdateSchema = customerCreateSchema;

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
```

- [ ] **Step 2: Create `bbs/src/actions/customers.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { customerCreateSchema, customerUpdateSchema } from "@/schemas/customer";

export async function searchCustomers(query: string) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const q = query.trim();
  if (q.length === 0) return [];
  return prisma.customer.findMany({
    where: {
      archived: false,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } }
      ]
    },
    orderBy: { name: "asc" },
    take: 20
  });
}

export async function createCustomer(raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = customerCreateSchema.parse(raw);

  if (data.email) {
    const existing = await prisma.customer.findFirst({
      where: { email: data.email, archived: false }
    });
    if (existing) {
      return { ok: false as const, error: "duplicate_email", existingId: existing.id };
    }
  }

  const created = await prisma.customer.create({ data });
  revalidatePath("/customers");
  return { ok: true as const, customer: created };
}

export async function updateCustomer(id: string, raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = customerUpdateSchema.parse(raw);
  const updated = await prisma.customer.update({ where: { id }, data });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  return { ok: true as const, customer: updated };
}

export async function archiveCustomer(id: string) {
  await requireRole(Role.ADMIN, Role.STAFF);
  await prisma.customer.update({ where: { id }, data: { archived: true } });
  revalidatePath("/customers");
  return { ok: true as const };
}
```

- [ ] **Step 3: Commit**

```bash
git add bbs/src/schemas/customer.ts bbs/src/actions/customers.ts
git commit -m "feat: add customer schemas and Server Actions with duplicate email detection"
```

---

## Task 7: Not-Authorized Page + Server Action Error Boundary

**Files:**
- Create: `bbs/src/app/not-authorized/page.tsx`
- Create: `bbs/src/app/(app)/error.tsx`

- [ ] **Step 1: Create `bbs/src/app/not-authorized/page.tsx`**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotAuthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-gold mb-2">Not authorized</h1>
        <p className="text-muted mb-6">
          Your account doesn&apos;t have permission to view that page.
        </p>
        <Link href="/dashboard">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `bbs/src/app/(app)/error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-semibold text-danger-bright mb-2">Something went wrong</h1>
      <p className="text-muted mb-6">{error.message || "An unexpected error occurred."}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add bbs/src/app/not-authorized/page.tsx "bbs/src/app/(app)/error.tsx"
git commit -m "feat: add not-authorized page and (app) error boundary"
```

---

## Task 8: Combobox Primitive

**Files:**
- Create: `bbs/src/components/ui/Combobox.tsx`

- [ ] **Step 1: Create `bbs/src/components/ui/Combobox.tsx`**

```tsx
"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from "react";

export interface ComboboxItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface ComboboxProps<T extends ComboboxItem> {
  label: string;
  placeholder?: string;
  value: T | null;
  onSelect: (item: T | null) => void;
  onSearch: (query: string) => Promise<T[]>;
  emptyState?: ReactNode;
  debounceMs?: number;
}

export function Combobox<T extends ComboboxItem>({
  label,
  placeholder,
  value,
  onSelect,
  onSearch,
  emptyState,
  debounceMs = 250
}: ComboboxProps<T>) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await onSearch(query.trim());
        setResults(r);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, debounceMs, onSearch]);

  return (
    <div className="w-full relative">
      <label className="block text-sm text-muted mb-1">{label}</label>
      {value ? (
        <div className="flex items-center justify-between h-11 px-3 rounded bg-surface-raised border border-border">
          <div>
            <div className="text-text">{value.label}</div>
            {value.sublabel && (
              <div className="text-xs text-muted">{value.sublabel}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-muted hover:text-text text-sm"
            aria-label="Clear selection"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="w-full h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
          />
          {open && (query.length > 0 || results.length > 0) && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded border border-border bg-surface shadow-2xl"
            >
              {loading && (
                <li className="px-3 py-2 text-sm text-muted">Searching…</li>
              )}
              {!loading && results.length === 0 && query.trim().length > 0 && (
                <li className="px-3 py-2 text-sm text-muted">
                  {emptyState ?? "No matches"}
                </li>
              )}
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSelect(r);
                      setOpen(false);
                      setQuery("");
                      setResults([]);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-surface-raised text-text"
                  >
                    <div>{r.label}</div>
                    {r.sublabel && (
                      <div className="text-xs text-muted">{r.sublabel}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/components/ui/Combobox.tsx
git commit -m "feat: add async-search Combobox primitive"
```

---

## Task 9: Customer List, New, and Detail Pages

**Files:**
- Create: `bbs/src/components/customers/CustomerForm.tsx`
- Create: `bbs/src/components/customers/CustomerTable.tsx`
- Create: `bbs/src/app/(app)/customers/page.tsx`
- Create: `bbs/src/app/(app)/customers/new/page.tsx`
- Create: `bbs/src/app/(app)/customers/[id]/page.tsx`
- Create: `bbs/src/app/(app)/customers/[id]/edit/page.tsx`

- [ ] **Step 1: Create `bbs/src/components/customers/CustomerForm.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createCustomer, updateCustomer } from "@/actions/customers";

interface FormValues {
  name: string;
  company: string;
  email: string;
  phone: string;
  billingAddress: string;
  taxId: string;
  notes: string;
}

interface CustomerFormProps {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<FormValues>;
  onSaved?: (customer: { id: string; name: string; email: string | null }) => void;
}

export function CustomerForm({ mode, id, initial, onSaved }: CustomerFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    name: initial?.name ?? "",
    company: initial?.company ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    billingAddress: initial?.billingAddress ?? "",
    taxId: initial?.taxId ?? "",
    notes: initial?.notes ?? ""
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function bind<K extends keyof FormValues>(name: K) {
    return {
      name,
      value: values[name],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setValues((v) => ({ ...v, [name]: e.target.value })),
      error: errors[name]
    };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setBanner(null);
    startTransition(async () => {
      try {
        const res =
          mode === "create"
            ? await createCustomer(values)
            : await updateCustomer(id!, values);
        if (!res.ok) {
          setBanner("A customer with that email already exists.");
          return;
        }
        onSaved?.(res.customer);
        if (mode === "create") {
          router.push(`/customers/${res.customer.id}`);
        } else {
          router.push(`/customers/${id}`);
        }
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      {banner && (
        <div role="alert" className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2">
          {banner}
        </div>
      )}
      <Input label="Name *" required {...bind("name")} />
      <Input label="Company" {...bind("company")} />
      <Input label="Email" type="email" {...bind("email")} />
      <Input label="Phone" {...bind("phone")} />
      <Input label="Billing address" {...bind("billingAddress")} />
      <Input label="Tax ID" {...bind("taxId")} />
      <Input label="Notes" {...bind("notes")} />
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create customer" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create `bbs/src/components/customers/CustomerTable.tsx`**

```tsx
import Link from "next/link";
import type { Customer } from "@prisma/client";

export function CustomerTable({ customers }: { customers: Customer[] }) {
  if (customers.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
        No customers yet.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-muted uppercase text-xs">
          <tr>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">Company</th>
            <th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Phone</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-surface-raised">
              <td className="px-4 py-3">
                <Link href={`/customers/${c.id}`} className="text-gold hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-text">{c.company ?? "—"}</td>
              <td className="px-4 py-3 text-text">{c.email ?? "—"}</td>
              <td className="px-4 py-3 text-text">{c.phone ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create `bbs/src/app/(app)/customers/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { CustomerTable } from "@/components/customers/CustomerTable";

export default async function CustomersPage({
  searchParams
}: {
  searchParams: { q?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const q = searchParams.q?.trim() ?? "";
  const customers = await prisma.customer.findMany({
    where: {
      archived: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: { name: "asc" },
    take: 100
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted mt-1">{customers.length} shown</p>
        </div>
        <Link href="/customers/new">
          <Button>New customer</Button>
        </Link>
      </div>
      <form className="mb-4" action="/customers" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, email, company…"
          className="w-full max-w-md h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </form>
      <CustomerTable customers={customers} />
    </div>
  );
}
```

- [ ] **Step 4: Create `bbs/src/app/(app)/customers/new/page.tsx`**

```tsx
import { requireRole, Role } from "@/lib/permissions";
import { CustomerForm } from "@/components/customers/CustomerForm";

export default async function NewCustomerPage() {
  await requireRole(Role.ADMIN, Role.STAFF);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">New customer</h1>
      <CustomerForm mode="create" />
    </div>
  );
}
```

- [ ] **Step 5: Create `bbs/src/app/(app)/customers/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { formatUSD } from "@/lib/money";

export default async function CustomerDetailPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      invoices: {
        orderBy: { issuedAt: "desc" },
        take: 50
      }
    }
  });
  if (!customer) notFound();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
          {customer.company && (
            <p className="text-sm text-muted mt-1">{customer.company}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/customers/${customer.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-surface border border-border rounded-lg p-5 space-y-2">
          <div className="text-xs text-muted uppercase tracking-wide">Contact</div>
          <div className="text-text">{customer.email ?? "—"}</div>
          <div className="text-text">{customer.phone ?? "—"}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-5 space-y-2">
          <div className="text-xs text-muted uppercase tracking-wide">Billing</div>
          <div className="text-text whitespace-pre-line">
            {customer.billingAddress ?? "—"}
          </div>
          <div className="text-text">Tax ID: {customer.taxId ?? "—"}</div>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-3">Invoice history</h2>
      {customer.invoices.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
          No invoices yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-muted uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Number</th>
                <th className="text-left px-4 py-3">Issued</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody>
              {customer.invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-border hover:bg-surface-raised">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="text-gold hover:underline font-mono">
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text">
                    {inv.issuedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-text">{inv.status}</td>
                  <td className="px-4 py-3 text-right text-text tabular">
                    {formatUSD(inv.totalCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-text tabular">
                    {formatUSD(inv.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create `bbs/src/app/(app)/customers/[id]/edit/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { CustomerForm } from "@/components/customers/CustomerForm";

export default async function EditCustomerPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF);

  const customer = await prisma.customer.findUnique({
    where: { id: params.id }
  });
  if (!customer) notFound();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Edit customer</h1>
      <CustomerForm
        mode="edit"
        id={customer.id}
        initial={{
          name: customer.name,
          company: customer.company ?? "",
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          billingAddress: customer.billingAddress ?? "",
          taxId: customer.taxId ?? "",
          notes: customer.notes ?? ""
        }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add bbs/src/components/customers "bbs/src/app/(app)/customers"
git commit -m "feat: add customer list, detail, create, and edit pages"
```

---

## Task 10: Catalog Schemas, Actions, and Pages

**Files:**
- Create: `bbs/src/schemas/catalog.ts`
- Create: `bbs/src/actions/catalog.ts`
- Create: `bbs/src/components/catalog/CatalogItemForm.tsx`
- Create: `bbs/src/components/catalog/CatalogTable.tsx`
- Create: `bbs/src/app/(app)/catalog/page.tsx`
- Create: `bbs/src/app/(app)/catalog/new/page.tsx`
- Create: `bbs/src/app/(app)/catalog/[id]/edit/page.tsx`

- [ ] **Step 1: Create `bbs/src/schemas/catalog.ts`**

```ts
import { z } from "zod";

export const catalogCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  sku: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v ? v : null)),
  /** Dollar string (e.g. "12.50"). Converted to cents by the action. */
  unitPrice: z.string().trim().min(1, "Price is required"),
  taxRateId: z.string().trim().min(1).optional().transform((v) => (v ? v : null)),
  active: z.boolean().default(true)
});

export const catalogUpdateSchema = catalogCreateSchema;

export type CatalogCreateInput = z.infer<typeof catalogCreateSchema>;
```

- [ ] **Step 2: Create `bbs/src/actions/catalog.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { toCents } from "@/lib/money";
import { catalogCreateSchema, catalogUpdateSchema } from "@/schemas/catalog";

export async function searchCatalog(query: string) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const q = query.trim();
  if (q.length === 0) return [];
  return prisma.catalogItem.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } }
      ]
    },
    include: { taxRate: true },
    orderBy: { name: "asc" },
    take: 20
  });
}

export async function listTaxRates() {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  return prisma.taxRate.findMany({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }]
  });
}

export async function createCatalogItem(raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = catalogCreateSchema.parse(raw);
  const item = await prisma.catalogItem.create({
    data: {
      name: data.name,
      description: data.description,
      sku: data.sku,
      unitPriceCents: toCents(data.unitPrice),
      taxRateId: data.taxRateId,
      active: data.active
    }
  });
  revalidatePath("/catalog");
  return { ok: true as const, item };
}

export async function updateCatalogItem(id: string, raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = catalogUpdateSchema.parse(raw);
  const item = await prisma.catalogItem.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      sku: data.sku,
      unitPriceCents: toCents(data.unitPrice),
      taxRateId: data.taxRateId,
      active: data.active
    }
  });
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${id}/edit`);
  return { ok: true as const, item };
}

export async function archiveCatalogItem(id: string) {
  await requireRole(Role.ADMIN, Role.STAFF);
  await prisma.catalogItem.update({ where: { id }, data: { active: false } });
  revalidatePath("/catalog");
  return { ok: true as const };
}
```

- [ ] **Step 3: Create `bbs/src/components/catalog/CatalogItemForm.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import {
  createCatalogItem,
  updateCatalogItem
} from "@/actions/catalog";

interface FormValues {
  name: string;
  description: string;
  sku: string;
  unitPrice: string;
  taxRateId: string;
  active: boolean;
}

interface Props {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<FormValues>;
  taxRates: { id: string; name: string; ratePercent: string }[];
}

export function CatalogItemForm({ mode, id, initial, taxRates }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    sku: initial?.sku ?? "",
    unitPrice: initial?.unitPrice ?? "",
    taxRateId: initial?.taxRateId ?? "",
    active: initial?.active ?? true
  });
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const payload = {
          ...values,
          taxRateId: values.taxRateId || undefined
        };
        if (mode === "create") {
          await createCatalogItem(payload);
        } else {
          await updateCatalogItem(id!, payload);
        }
        router.push("/catalog");
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      {banner && (
        <div role="alert" className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2">
          {banner}
        </div>
      )}
      <Input
        label="Name *"
        required
        value={values.name}
        onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
      />
      <Input
        label="Description"
        value={values.description}
        onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
      />
      <Input
        label="SKU"
        value={values.sku}
        onChange={(e) => setValues((v) => ({ ...v, sku: e.target.value }))}
      />
      <Input
        label="Unit price (USD) *"
        required
        inputMode="decimal"
        placeholder="e.g. 12.50"
        value={values.unitPrice}
        onChange={(e) => setValues((v) => ({ ...v, unitPrice: e.target.value }))}
      />
      <Select
        label="Tax rate"
        value={values.taxRateId}
        onChange={(e) => setValues((v) => ({ ...v, taxRateId: e.target.value }))}
      >
        <option value="">None</option>
        {taxRates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.ratePercent}%)
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
          className="h-4 w-4"
        />
        Active
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create item" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Create `bbs/src/components/catalog/CatalogTable.tsx`**

```tsx
import Link from "next/link";
import type { CatalogItem, TaxRate } from "@prisma/client";
import { formatUSD } from "@/lib/money";

type Item = CatalogItem & { taxRate: TaxRate | null };

export function CatalogTable({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
        No items yet.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-muted uppercase text-xs">
          <tr>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">SKU</th>
            <th className="text-right px-4 py-3">Price</th>
            <th className="text-left px-4 py-3">Tax rate</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-surface-raised">
              <td className="px-4 py-3 text-text">{c.name}</td>
              <td className="px-4 py-3 text-muted font-mono">{c.sku ?? "—"}</td>
              <td className="px-4 py-3 text-right text-text tabular">
                {formatUSD(c.unitPriceCents)}
              </td>
              <td className="px-4 py-3 text-text">
                {c.taxRate ? `${c.taxRate.name}` : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/catalog/${c.id}/edit`} className="text-gold hover:underline">
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Create `bbs/src/app/(app)/catalog/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { CatalogTable } from "@/components/catalog/CatalogTable";

export default async function CatalogPage({
  searchParams
}: {
  searchParams: { q?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const q = searchParams.q?.trim() ?? "";
  const items = await prisma.catalogItem.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: { taxRate: true },
    orderBy: { name: "asc" },
    take: 200
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="text-sm text-muted mt-1">{items.length} shown</p>
        </div>
        <Link href="/catalog/new">
          <Button>New item</Button>
        </Link>
      </div>
      <form className="mb-4" action="/catalog" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or SKU…"
          className="w-full max-w-md h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </form>
      <CatalogTable items={items} />
    </div>
  );
}
```

- [ ] **Step 6: Create `bbs/src/app/(app)/catalog/new/page.tsx`**

```tsx
import { requireRole, Role } from "@/lib/permissions";
import { listTaxRates } from "@/actions/catalog";
import { CatalogItemForm } from "@/components/catalog/CatalogItemForm";

export default async function NewCatalogItemPage() {
  await requireRole(Role.ADMIN, Role.STAFF);
  const rates = await listTaxRates();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">New catalog item</h1>
      <CatalogItemForm
        mode="create"
        taxRates={rates.map((r) => ({
          id: r.id,
          name: r.name,
          ratePercent: r.ratePercent.toString()
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 7: Create `bbs/src/app/(app)/catalog/[id]/edit/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { listTaxRates } from "@/actions/catalog";
import { fromCents } from "@/lib/money";
import { CatalogItemForm } from "@/components/catalog/CatalogItemForm";

export default async function EditCatalogItemPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const item = await prisma.catalogItem.findUnique({ where: { id: params.id } });
  if (!item) notFound();
  const rates = await listTaxRates();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Edit catalog item</h1>
      <CatalogItemForm
        mode="edit"
        id={item.id}
        initial={{
          name: item.name,
          description: item.description ?? "",
          sku: item.sku ?? "",
          unitPrice: fromCents(item.unitPriceCents),
          taxRateId: item.taxRateId ?? "",
          active: item.active
        }}
        taxRates={rates.map((r) => ({
          id: r.id,
          name: r.name,
          ratePercent: r.ratePercent.toString()
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add bbs/src/schemas/catalog.ts bbs/src/actions/catalog.ts bbs/src/components/catalog "bbs/src/app/(app)/catalog"
git commit -m "feat: add catalog schemas, actions, and CRUD pages"
```

---

## Task 11: Bill Schema and Create-Draft Action

**Files:**
- Create: `bbs/src/schemas/bill.ts`
- Create: `bbs/src/actions/bills.ts`

- [ ] **Step 1: Create `bbs/src/schemas/bill.ts`**

```ts
import { z } from "zod";

const discountSchema = z.object({
  kind: z.enum(["PERCENT", "FIXED", "NONE"]),
  /** For PERCENT: 0..100. For FIXED: dollar string. For NONE: ignored. */
  value: z.string().default("0")
});

export const billLineSchema = z.object({
  catalogItemId: z.string().nullable(),
  description: z.string().trim().min(1, "Description required").max(500),
  /** Decimal quantity as a string, e.g. "1", "2.5". */
  quantity: z.string().trim().min(1),
  /** Dollar string, e.g. "12.50". */
  unitPrice: z.string().trim().min(1),
  discount: discountSchema,
  taxRateId: z.string().nullable()
});

export const createDraftBillSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  lines: z.array(billLineSchema).min(1, "At least one line item is required"),
  invoiceDiscount: discountSchema,
  notes: z.string().trim().max(2000).nullable().default(null),
  dueAt: z.string().nullable().default(null) // ISO date string or null
});

export type CreateDraftBillInput = z.infer<typeof createDraftBillSchema>;
export type BillLineInput = z.infer<typeof billLineSchema>;
```

- [ ] **Step 2: Create `bbs/src/actions/bills.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { toCents } from "@/lib/money";
import { createDraftBillSchema } from "@/schemas/bill";
import { computeInvoiceTotals } from "@/lib/billing";
import type { DiscountInput, LineInput } from "@/lib/billing-types";
import { reserveInvoiceNumber } from "@/lib/invoice-number";

function normalizeDiscount(d: { kind: "PERCENT" | "FIXED" | "NONE"; value: string }): DiscountInput {
  if (d.kind === "NONE") return { kind: "NONE", value: 0 };
  if (d.kind === "PERCENT") {
    const n = Number(d.value);
    if (!Number.isFinite(n) || n < 0) throw new Error("Invalid percent discount");
    return { kind: "PERCENT", value: n };
  }
  return { kind: "FIXED", value: toCents(d.value) };
}

export async function createDraftBill(raw: unknown) {
  const user = await requireRole(Role.ADMIN, Role.STAFF);
  const input = createDraftBillSchema.parse(raw);

  const taxRateIds = Array.from(
    new Set(input.lines.map((l) => l.taxRateId).filter((id): id is string => !!id))
  );
  const taxRates = taxRateIds.length
    ? await prisma.taxRate.findMany({ where: { id: { in: taxRateIds } } })
    : [];
  const taxPercentById = new Map(taxRates.map((r) => [r.id, Number(r.ratePercent)]));

  const engineLines: LineInput[] = input.lines.map((l) => ({
    unitPriceCents: toCents(l.unitPrice),
    quantity: Number(l.quantity),
    discount: normalizeDiscount(l.discount),
    taxRatePercent: l.taxRateId ? taxPercentById.get(l.taxRateId) ?? 0 : 0
  }));
  const totals = computeInvoiceTotals(engineLines, normalizeDiscount(input.invoiceDiscount));

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await reserveInvoiceNumber(tx);

    return tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: input.customerId,
        issuedAt: new Date(),
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: "DRAFT",
        subtotalCents: totals.subtotalCents,
        discountCents: totals.invoiceDiscountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        paidCents: 0,
        balanceCents: totals.totalCents,
        currency: "USD",
        notes: input.notes,
        createdById: user.id,
        lines: {
          create: input.lines.map((l, idx) => {
            const totalsForLine = totals.lines[idx];
            const d = normalizeDiscount(l.discount);
            return {
              catalogItemId: l.catalogItemId,
              description: l.description,
              quantity: Number(l.quantity),
              unitPriceCents: toCents(l.unitPrice),
              discountType: d.kind,
              discountValue:
                d.kind === "PERCENT"
                  ? d.value
                  : d.kind === "FIXED"
                  ? d.value
                  : 0,
              taxRateId: l.taxRateId,
              lineTotalCents: totalsForLine.lineTotalCents
            };
          })
        }
      },
      include: { lines: true }
    });
  });

  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  return { ok: true as const, invoice };
}
```

- [ ] **Step 3: Commit**

```bash
git add bbs/src/schemas/bill.ts bbs/src/actions/bills.ts
git commit -m "feat: add create-draft-bill Server Action with atomic invoice numbering"
```

---

## Task 12: Bill Builder Client Component

**Files:**
- Create: `bbs/src/components/billing/CustomerPicker.tsx`
- Create: `bbs/src/components/billing/CatalogPicker.tsx`
- Create: `bbs/src/components/billing/DiscountPicker.tsx`
- Create: `bbs/src/components/billing/LineItemRow.tsx`
- Create: `bbs/src/components/billing/TotalsPanel.tsx`
- Create: `bbs/src/components/billing/BillBuilder.tsx`

- [ ] **Step 1: Create `bbs/src/components/billing/CustomerPicker.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Combobox, type ComboboxItem } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { searchCustomers, createCustomer } from "@/actions/customers";
import { CustomerForm } from "@/components/customers/CustomerForm";

export interface PickedCustomer {
  id: string;
  name: string;
  email: string | null;
}

interface Props {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
}

export function CustomerPicker({ value, onChange }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  async function search(q: string): Promise<(ComboboxItem & PickedCustomer)[]> {
    const results = await searchCustomers(q);
    return results.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: r.email ?? r.phone ?? undefined,
      name: r.name,
      email: r.email
    }));
  }

  return (
    <div className="space-y-2">
      <Combobox
        label="Customer"
        placeholder="Search by name, email, phone…"
        value={
          value
            ? { id: value.id, label: value.name, sublabel: value.email ?? undefined }
            : null
        }
        onSelect={(item) => onChange(item ? { id: item.id, name: item.label, email: item.sublabel ?? null } : null)}
        onSearch={search}
      />
      {!value && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="text-sm text-gold hover:underline"
        >
          + New customer
        </button>
      )}

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="New customer">
        <CustomerForm
          mode="create"
          onSaved={(c) => {
            onChange({ id: c.id, name: c.name, email: c.email });
            setShowCreate(false);
          }}
        />
      </Dialog>
    </div>
  );
}

// Suppress unused import warnings for the create helper (used indirectly through CustomerForm).
void createCustomer;
```

- [ ] **Step 2: Create `bbs/src/components/billing/CatalogPicker.tsx`**

```tsx
"use client";

import { Combobox } from "@/components/ui/Combobox";
import { searchCatalog } from "@/actions/catalog";
import { fromCents } from "@/lib/money";

export interface CatalogPick {
  id: string;
  name: string;
  unitPrice: string;
  taxRateId: string | null;
}

interface Props {
  onPick: (item: CatalogPick) => void;
}

export function CatalogPicker({ onPick }: Props) {
  async function search(q: string) {
    const results = await searchCatalog(q);
    return results.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: `${r.sku ?? "—"} · $${fromCents(r.unitPriceCents)}`,
      name: r.name,
      unitPrice: fromCents(r.unitPriceCents),
      taxRateId: r.taxRateId
    }));
  }

  return (
    <Combobox
      label="Add from catalog"
      placeholder="Search catalog…"
      value={null}
      onSelect={(item) => {
        if (item) {
          onPick({
            id: item.id,
            name: item.label,
            unitPrice: (item as unknown as { unitPrice: string }).unitPrice,
            taxRateId: (item as unknown as { taxRateId: string | null }).taxRateId
          });
        }
      }}
      onSearch={search}
    />
  );
}
```

- [ ] **Step 3: Create `bbs/src/components/billing/DiscountPicker.tsx`**

```tsx
"use client";

import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

export type DiscountValue = { kind: "PERCENT" | "FIXED" | "NONE"; value: string };

interface Props {
  label?: string;
  value: DiscountValue;
  onChange: (v: DiscountValue) => void;
}

export function DiscountPicker({ label = "Discount", value, onChange }: Props) {
  return (
    <div>
      <label className="block text-sm text-muted mb-1">{label}</label>
      <div className="flex gap-2">
        <Select
          value={value.kind}
          onChange={(e) =>
            onChange({
              kind: e.target.value as DiscountValue["kind"],
              value: e.target.value === "NONE" ? "0" : value.value
            })
          }
        >
          <option value="NONE">None</option>
          <option value="PERCENT">Percent</option>
          <option value="FIXED">Amount</option>
        </Select>
        {value.kind !== "NONE" && (
          <Input
            inputMode="decimal"
            placeholder={value.kind === "PERCENT" ? "e.g. 10" : "e.g. 5.00"}
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `bbs/src/components/billing/LineItemRow.tsx`**

```tsx
"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { DiscountPicker, type DiscountValue } from "./DiscountPicker";

export interface DraftLine {
  key: string; // client-side stable key
  catalogItemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: DiscountValue;
  taxRateId: string | null;
}

interface Props {
  line: DraftLine;
  taxRates: { id: string; name: string; ratePercent: string }[];
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}

export function LineItemRow({ line, taxRates, onChange, onRemove }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start bg-surface-raised border border-border rounded p-3">
      <div className="md:col-span-4">
        <Input
          label="Description"
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="md:col-span-2">
        <Input
          label="Qty"
          inputMode="decimal"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
        />
      </div>
      <div className="md:col-span-2">
        <Input
          label="Unit price"
          inputMode="decimal"
          value={line.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value })}
        />
      </div>
      <div className="md:col-span-2">
        <DiscountPicker value={line.discount} onChange={(v) => onChange({ discount: v })} />
      </div>
      <div className="md:col-span-2">
        <Select
          label="Tax"
          value={line.taxRateId ?? ""}
          onChange={(e) => onChange({ taxRateId: e.target.value || null })}
        >
          <option value="">None</option>
          {taxRates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.ratePercent}%)
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-12 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `bbs/src/components/billing/TotalsPanel.tsx`**

```tsx
"use client";

import { formatUSD } from "@/lib/money";
import type { InvoiceTotals } from "@/lib/billing-types";

export function TotalsPanel({ totals }: { totals: InvoiceTotals }) {
  return (
    <div
      aria-live="polite"
      className="bg-surface border border-border rounded-lg p-5 space-y-2 sticky top-4"
    >
      <div className="text-xs uppercase text-muted tracking-wide mb-2">Totals</div>
      <Row label="Subtotal" value={formatUSD(totals.subtotalCents)} />
      <Row label="Discount" value={`-${formatUSD(totals.invoiceDiscountCents)}`} />
      <Row label="Tax" value={formatUSD(totals.taxCents)} />
      <div className="border-t border-border pt-2 mt-2">
        <Row label="Total" value={formatUSD(totals.totalCents)} strong />
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? "text-text font-semibold" : "text-muted"}>{label}</span>
      <span className={"tabular " + (strong ? "text-gold font-semibold text-lg" : "text-text")}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Create `bbs/src/components/billing/BillBuilder.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { computeInvoiceTotals } from "@/lib/billing";
import { toCents } from "@/lib/money";
import type { DiscountInput, LineInput } from "@/lib/billing-types";
import { CustomerPicker, type PickedCustomer } from "./CustomerPicker";
import { CatalogPicker, type CatalogPick } from "./CatalogPicker";
import { DiscountPicker, type DiscountValue } from "./DiscountPicker";
import { LineItemRow, type DraftLine } from "./LineItemRow";
import { TotalsPanel } from "./TotalsPanel";
import { createDraftBill } from "@/actions/bills";

interface Props {
  taxRates: { id: string; name: string; ratePercent: string }[];
  defaultTaxRateId: string | null;
}

function makeKey() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyDiscount(): DiscountValue {
  return { kind: "NONE", value: "0" };
}

function safeToCents(s: string): number {
  try {
    return toCents(s);
  } catch {
    return 0;
  }
}

function toEngineLine(
  line: DraftLine,
  taxPercentById: Map<string, number>
): LineInput {
  const qty = Number(line.quantity);
  const discount: DiscountInput =
    line.discount.kind === "NONE"
      ? { kind: "NONE", value: 0 }
      : line.discount.kind === "PERCENT"
      ? { kind: "PERCENT", value: Number(line.discount.value) || 0 }
      : { kind: "FIXED", value: safeToCents(line.discount.value) };
  return {
    unitPriceCents: safeToCents(line.unitPrice),
    quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
    discount,
    taxRatePercent: line.taxRateId ? taxPercentById.get(line.taxRateId) ?? 0 : 0
  };
}

export function BillBuilder({ taxRates, defaultTaxRateId }: Props) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState<DiscountValue>(emptyDiscount());
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const taxPercentById = useMemo(
    () => new Map(taxRates.map((t) => [t.id, Number(t.ratePercent)])),
    [taxRates]
  );

  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        lines.map((l) => toEngineLine(l, taxPercentById)),
        invoiceDiscount.kind === "NONE"
          ? { kind: "NONE", value: 0 }
          : invoiceDiscount.kind === "PERCENT"
          ? { kind: "PERCENT", value: Number(invoiceDiscount.value) || 0 }
          : { kind: "FIXED", value: safeToCents(invoiceDiscount.value) }
      ),
    [lines, invoiceDiscount, taxPercentById]
  );

  function addBlankLine() {
    setLines((prev) => [
      ...prev,
      {
        key: makeKey(),
        catalogItemId: null,
        description: "",
        quantity: "1",
        unitPrice: "0.00",
        discount: emptyDiscount(),
        taxRateId: defaultTaxRateId
      }
    ]);
  }

  function addCatalogLine(pick: CatalogPick) {
    setLines((prev) => [
      ...prev,
      {
        key: makeKey(),
        catalogItemId: pick.id,
        description: pick.name,
        quantity: "1",
        unitPrice: pick.unitPrice,
        discount: emptyDiscount(),
        taxRateId: pick.taxRateId
      }
    ]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function canSubmit(): boolean {
    if (!customer) return false;
    if (lines.length === 0) return false;
    if (lines.some((l) => !l.description.trim())) return false;
    return true;
  }

  function onSubmit() {
    setBanner(null);
    if (!canSubmit() || !customer) {
      setBanner("Add a customer and at least one line item.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await createDraftBill({
          customerId: customer.id,
          lines: lines.map((l) => ({
            catalogItemId: l.catalogItemId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
            taxRateId: l.taxRateId
          })),
          invoiceDiscount,
          notes: notes.trim() ? notes.trim() : null,
          dueAt: dueAt ? dueAt : null
        });
        router.push(`/invoices/${res.invoice.id}`);
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {banner && (
          <div role="alert" className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2">
            {banner}
          </div>
        )}

        <section className="bg-surface border border-border rounded-lg p-5">
          <h2 className="text-sm uppercase text-muted tracking-wide mb-3">Customer</h2>
          <CustomerPicker value={customer} onChange={setCustomer} />
        </section>

        <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase text-muted tracking-wide">Line items</h2>
            <Button type="button" size="sm" variant="ghost" onClick={addBlankLine}>
              + Custom line
            </Button>
          </div>
          <CatalogPicker onPick={addCatalogLine} />
          <div className="space-y-3">
            {lines.map((line) => (
              <LineItemRow
                key={line.key}
                line={line}
                taxRates={taxRates}
                onChange={(patch) => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
              />
            ))}
            {lines.length === 0 && (
              <div className="text-center text-muted text-sm py-6 border border-dashed border-border rounded">
                No items yet. Pick from catalog above or add a custom line.
              </div>
            )}
          </div>
        </section>

        <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm uppercase text-muted tracking-wide">Invoice-level</h2>
          <DiscountPicker
            label="Invoice discount"
            value={invoiceDiscount}
            onChange={setInvoiceDiscount}
          />
          <Input label="Due date" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <div>
            <label htmlFor="notes" className="block text-sm text-muted mb-1">
              Notes
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <TotalsPanel totals={totals} />
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !canSubmit()}
          className="w-full"
        >
          {isPending ? "Saving draft…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add bbs/src/components/billing
git commit -m "feat: add BillBuilder client component with customer, catalog, discounts, and live totals"
```

---

## Task 13: Bill New Page

**Files:**
- Create: `bbs/src/app/(app)/bills/new/page.tsx`

- [ ] **Step 1: Create `bbs/src/app/(app)/bills/new/page.tsx`**

```tsx
import { requireRole, Role } from "@/lib/permissions";
import { listTaxRates } from "@/actions/catalog";
import { BillBuilder } from "@/components/billing/BillBuilder";

export default async function NewBillPage() {
  await requireRole(Role.ADMIN, Role.STAFF);
  const rates = await listTaxRates();
  const defaultRate = rates.find((r) => r.isDefault) ?? rates[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Create bill</h1>
      <BillBuilder
        taxRates={rates.map((r) => ({
          id: r.id,
          name: r.name,
          ratePercent: r.ratePercent.toString()
        }))}
        defaultTaxRateId={defaultRate?.id ?? null}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "bbs/src/app/(app)/bills/new/page.tsx"
git commit -m "feat: add /bills/new page rendering the BillBuilder"
```

---

## Task 14: Invoice Status Badge and List Table

**Files:**
- Create: `bbs/src/components/invoices/InvoiceStatusBadge.tsx`
- Create: `bbs/src/components/invoices/InvoiceListTable.tsx`

- [ ] **Step 1: Create `bbs/src/components/invoices/InvoiceStatusBadge.tsx`**

```tsx
import type { InvoiceStatus } from "@prisma/client";

const styles: Record<InvoiceStatus, string> = {
  DRAFT: "bg-muted/20 text-muted",
  UNPAID: "bg-warning/20 text-warning-bright",
  PARTIAL: "bg-gold/20 text-gold",
  PAID: "bg-success/20 text-success-bright",
  OVERDUE: "bg-danger/20 text-danger-bright",
  VOID: "bg-muted/20 text-muted",
  REFUNDED: "bg-danger/20 text-danger-bright"
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Create `bbs/src/components/invoices/InvoiceListTable.tsx`**

```tsx
import Link from "next/link";
import type { Invoice, Customer } from "@prisma/client";
import { formatUSD } from "@/lib/money";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

type Row = Invoice & { customer: Customer };

export function InvoiceListTable({ invoices }: { invoices: Row[] }) {
  if (invoices.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
        No invoices yet — create your first bill.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-muted uppercase text-xs">
          <tr>
            <th className="text-left px-4 py-3">Number</th>
            <th className="text-left px-4 py-3">Customer</th>
            <th className="text-left px-4 py-3">Issued</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Total</th>
            <th className="text-right px-4 py-3">Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-border hover:bg-surface-raised">
              <td className="px-4 py-3">
                <Link href={`/invoices/${inv.id}`} className="text-gold hover:underline font-mono">
                  {inv.invoiceNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-text">{inv.customer.name}</td>
              <td className="px-4 py-3 text-text">
                {inv.issuedAt.toISOString().slice(0, 10)}
              </td>
              <td className="px-4 py-3">
                <InvoiceStatusBadge status={inv.status} />
              </td>
              <td className="px-4 py-3 text-right text-text tabular">
                {formatUSD(inv.totalCents)}
              </td>
              <td className="px-4 py-3 text-right text-text tabular">
                {formatUSD(inv.balanceCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add bbs/src/components/invoices
git commit -m "feat: add invoice status badge and list table components"
```

---

## Task 15: Invoice List and Detail Pages

**Files:**
- Create: `bbs/src/app/(app)/invoices/page.tsx`
- Create: `bbs/src/app/(app)/invoices/[id]/page.tsx`

- [ ] **Step 1: Create `bbs/src/app/(app)/invoices/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { InvoiceListTable } from "@/components/invoices/InvoiceListTable";
import type { InvoiceStatus } from "@prisma/client";

const PAGE_SIZE = 25;

export default async function InvoicesPage({
  searchParams
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const status = (searchParams.status ?? "").toUpperCase() as InvoiceStatus | "";
  const q = searchParams.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.page ?? "1") | 0);

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" as const } },
            { customer: { name: { contains: q, mode: "insensitive" as const } } }
          ]
        }
      : {})
  };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { customer: true },
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    }),
    prisma.invoice.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted mt-1">
            {total} total · page {page} of {totalPages}
          </p>
        </div>
        <Link href="/bills/new">
          <Button>Create bill</Button>
        </Link>
      </div>

      <form className="mb-4 flex gap-2 flex-wrap" action="/invoices" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search invoice # or customer…"
          className="flex-1 min-w-[240px] h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <select
          name="status"
          defaultValue={status}
          className="h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="VOID">Void</option>
          <option value="REFUNDED">Refunded</option>
        </select>
      </form>

      <InvoiceListTable invoices={invoices} />

      {totalPages > 1 && (
        <nav className="mt-4 flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={{
                pathname: "/invoices",
                query: { ...(q ? { q } : {}), ...(status ? { status } : {}), page: p }
              }}
              className={
                "px-3 py-1 rounded border text-sm " +
                (p === page
                  ? "bg-gold text-bg border-gold"
                  : "border-border text-text hover:bg-surface-raised")
              }
            >
              {p}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `bbs/src/app/(app)/invoices/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD, fromCents } from "@/lib/money";
import { InvoiceStatusBadge } from "@/components/invoices/InvoiceStatusBadge";

export default async function InvoiceDetailPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      lines: { include: { taxRate: true } }
    }
  });
  if (!invoice) notFound();

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-mono text-gold">
              {invoice.invoiceNumber}
            </h1>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-muted mt-1">
            Issued {invoice.issuedAt.toISOString().slice(0, 10)}
            {invoice.dueAt ? ` · Due ${invoice.dueAt.toISOString().slice(0, 10)}` : ""}
          </p>
        </div>
        <Link href="/invoices" className="text-sm text-muted hover:text-text">
          ← All invoices
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5 mb-6">
        <div className="text-xs uppercase text-muted tracking-wide mb-2">Bill to</div>
        <div className="text-text font-medium">{invoice.customer.name}</div>
        {invoice.customer.email && (
          <div className="text-sm text-muted">{invoice.customer.email}</div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-muted uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-right px-4 py-3">Qty</th>
              <th className="text-right px-4 py-3">Unit</th>
              <th className="text-right px-4 py-3">Line total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-4 py-3 text-text">
                  {l.description}
                  {l.taxRate && (
                    <div className="text-xs text-muted">Tax: {l.taxRate.name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {l.quantity.toString()}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  ${fromCents(l.unitPriceCents)}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {formatUSD(l.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5 max-w-sm ml-auto space-y-2">
        <Row label="Subtotal" value={formatUSD(invoice.subtotalCents)} />
        <Row label="Discount" value={`-${formatUSD(invoice.discountCents)}`} />
        <Row label="Tax" value={formatUSD(invoice.taxCents)} />
        <div className="border-t border-border pt-2">
          <Row label="Total" value={formatUSD(invoice.totalCents)} strong />
        </div>
      </div>

      {invoice.notes && (
        <div className="mt-6 bg-surface border border-border rounded-lg p-5">
          <div className="text-xs uppercase text-muted tracking-wide mb-2">Notes</div>
          <div className="text-text whitespace-pre-line">{invoice.notes}</div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? "text-text font-semibold" : "text-muted"}>{label}</span>
      <span className={"tabular " + (strong ? "text-gold font-semibold text-lg" : "text-text")}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "bbs/src/app/(app)/invoices"
git commit -m "feat: add invoice list with filters/pagination and read-only detail page"
```

---

## Task 16: End-to-End Phase 2 Verification

- [ ] **Step 1: Run all unit tests**

Run in `bbs/`:

```bash
npm test
```

Expected: 14 money tests + billing tests (approximately 18) all PASS.

- [ ] **Step 2: Run the production build**

Run in `bbs/`:

```bash
npm run build
```

Expected: build succeeds, all routes compile, no TypeScript errors.

- [ ] **Step 3: Start the dev server**

Run in `bbs/`:

```bash
npm run dev
```

- [ ] **Step 4: Sign in and walk the golden path**

Manually or via cURL (see Phase 1 smoke pattern in commit `c04a8e5`):

1. Visit `/login`, sign in as `admin@bricebeauty.example` / `admin1234`.
2. Navigate to `/customers` — list should render the empty state (no customers seeded).
3. Click **New customer**. Fill in Name = "Acme LLC", Email = "acme@example.test". Submit. Expect redirect to `/customers/{id}` with the profile showing.
4. Navigate to `/catalog` — should show 4 seeded items (HHB-14, LFW-001, EC-4OZ, SVC-BRAID).
5. Navigate to `/bills/new`.
6. In **Customer**, search "Acme" → select the customer.
7. In **Add from catalog**, search "Lace" → pick "Lace Front Wig". A line item should appear at $125.00, qty 1, with the seeded 7% tax rate selected.
8. Add another item via search: "Edge" → "Edge Control 4oz". Change its qty to `3`. Set a per-line PERCENT discount of `10`.
9. Set an invoice-level FIXED discount of `5.00`.
10. Watch the **Totals** panel update live. Expected math:
    - Line 1: 12500 × 1 = 12500 gross, 0 discount, tax = round(12500 × 0.07) = 875
    - Line 2: 899 × 3 = 2697 gross, 10% discount = round(2697 × 0.10) = 270 → lineTotal = 2427, tax = round(2427 × 0.07) = 170
    - Subtotal = 12500 + 2427 = 14927
    - Invoice discount = 500
    - Tax = 875 + 170 = 1045
    - Total = 14927 - 500 + 1045 = **15472** → displayed as `$154.72`
11. Click **Save draft**. Expect redirect to `/invoices/{id}` showing the invoice detail with number `BBS-2026-0001`, status `DRAFT`, and matching totals.
12. Visit `/invoices` — the new DRAFT row is present.
13. Visit `/customers/{acmeId}` — invoice history shows the new draft.

- [ ] **Step 5: Verify invoice number atomicity in DB**

Run from `bbs/`:

```bash
node -e "
require('fs').readFileSync('.env','utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)=\"?([^\"]*)\"?\s*\$/); if (m) process.env[m[1]] = m[2]; });
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
Promise.all([p.businessSettings.findUnique({where:{id:1}}), p.invoice.count()])
  .then(([s, c]) => console.log({nextSeq: s.nextInvoiceSeq, invoices: c}))
  .finally(() => p.\$disconnect());
"
```

Expected: `nextInvoiceSeq === invoices + 1` (i.e., BusinessSettings advanced by exactly the number of created invoices).

- [ ] **Step 6: Stop the dev server; commit any generated lockfile updates if present**

```bash
git status
```

If anything is modified beyond your working state, review and commit or discard as appropriate.

---

## Phase 2 Done When

- All unit tests pass (money + billing)
- `npm run build` completes without errors
- A logged-in ADMIN can create a customer, browse the catalog, and build & save a draft bill with mixed catalog + custom lines, per-line discounts, per-line tax rates, and an invoice-level discount
- The invoice detail page shows the correct math computed by the pure engine
- `BusinessSettings.nextInvoiceSeq` matches the invoice count + 1
- VIEWER role can read all list pages but cannot open `/bills/new`, `/customers/new`, or `/catalog/new` (Server Action `requireRole` throws → `(app)/error.tsx` renders)
- All the following commits exist on the branch (16 total):
  1. feat: add shared billing input/output types
  2. feat: add pure totals engine with per-line and invoice-level discounts
  3. feat: add atomic invoice-number reservation with FOR UPDATE
  4. feat: add Input, Select, and Dialog UI primitives
  5. feat: add customer schemas and Server Actions with duplicate email detection
  6. feat: add not-authorized page and (app) error boundary
  7. feat: add async-search Combobox primitive
  8. feat: add customer list, detail, create, and edit pages
  9. feat: add catalog schemas, actions, and CRUD pages
  10. feat: add create-draft-bill Server Action with atomic invoice numbering
  11. feat: add BillBuilder client component with customer, catalog, discounts, and live totals
  12. feat: add /bills/new page rendering the BillBuilder
  13. feat: add invoice status badge and list table components
  14. feat: add invoice list with filters/pagination and read-only detail page

---

## What Phase 3 Will Build On

- `lib/billing.ts` totals engine — Phase 3's payment recording will use it in combination with `Payment` records to recompute balances
- `lib/invoice-number.ts` — same pattern applies to any future sequential-ID needs
- `InvoiceStatusBadge` — reused everywhere status is shown
- BillBuilder's data model — Phase 3 adds a payment step but does not alter the draft flow
- All Server Actions gate on `requireRole` — Phase 3 adds Payment/Refund gates for ADMIN-only mutations
