# Phase 3 — Payments & Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add payment recording (with idempotency, tender/change UX, and atomic status transitions), void and refund flows, A4 invoice + thermal receipt PDFs, a "Save & charge" fast path from BillBuilder, a post-payment success screen, and OVERDUE surfacing on read — all without a schema migration.

**Architecture:** Two new pure modules (`lib/payments.ts::reconcileInvoice`, `lib/status.ts::deriveDisplayStatus`) are TDD'd against no Prisma. Server Actions in `actions/payments.ts` orchestrate transactions, wrapping every mutation in `prisma.$transaction` with `AuditLog` writes. PDF renderers are stateless React components consumed by two GET routes that stream `application/pdf`. OVERDUE is derived at read time — the DB `Invoice.status` column is never overwritten.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5, Zod, NextAuth v5 (all wired from Phases 1–2), Tailwind, Vitest, `@react-pdf/renderer` (new).

---

## Decisions carried in from spec

Full spec: `docs/superpowers/specs/2026-09-24-phase-3-payments-documents-design.md`.

- Payment modal is launched from `/invoices/[id]` (no dedicated route).
- BillBuilder gets a **Save & charge** button beside **Save draft**; the former sets `status = "UNPAID"` and auto-opens the payment modal client-side.
- Tender/change: `Payment.amountCents` records only what applies to `balance`; overage displayed to cashier and, when nonzero, prepended to `Payment.note`.
- Void auto-refunds unrefunded payment portions inside the same transaction; sets `paidCents = 0`, `balanceCents = 0`, `status = VOID`.
- Refunds always link to a specific `Payment.id`. Amount clamped to remaining refundable portion.
- OVERDUE is computed on read via `lib/status.ts::deriveDisplayStatus`; the DB never sees `OVERDUE`.
- A4 = "clean corporate" (white paper, black text, gold accents). Thermal = "modern minimal" (sans-serif body, monospace only for invoice code, 80mm width).
- Success screen = full-screen centered "receipt-first" layout guarded by `?receipt=1`.

---

## File Structure

**New files:**

```
bbs/
  src/
    lib/
      payments.ts                          ← pure reconcileInvoice (TDD)
      status.ts                            ← pure deriveDisplayStatus (TDD)
      pdf/
        types.ts                           ← shared PDF props types
        InvoicePdfA4.tsx                   ← @react-pdf React component
        ReceiptPdfThermal.tsx              ← @react-pdf React component
    __tests__/
      payments.test.ts                     ← unit tests for reconcileInvoice
      status.test.ts                       ← unit tests for deriveDisplayStatus
    schemas/
      payment.ts                           ← Zod schemas for record/void/refund
    actions/
      payments.ts                          ← recordPayment, voidInvoice, refundPayment
    components/
      billing/
        PaymentModal.tsx                   ← client, opens over invoice detail or after Save & charge
      invoices/
        VoidModal.tsx                      ← client, ADMIN only
        RefundModal.tsx                    ← client, ADMIN only, per-payment
        PaymentsSection.tsx                ← server, renders payment rows + Refund buttons
        InvoiceActionBar.tsx               ← client, wires up the modals
    app/
      (app)/
        invoices/
          [id]/
            paid/page.tsx                  ← success screen (?receipt=1 guarded)
            pdf/route.ts                   ← A4 GET stream
            receipt/route.ts               ← thermal GET stream
```

**Modified files:**

```
bbs/
  package.json                             ← +@react-pdf/renderer dep
  src/
    schemas/bill.ts                        ← +chargeImmediately optional field
    actions/bills.ts                       ← chargeImmediately support
    components/billing/BillBuilder.tsx     ← Save & charge button, opens PaymentModal
    app/(app)/invoices/[id]/page.tsx       ← wires action bar, payments section, badge uses derived status
    app/(app)/invoices/page.tsx            ← filter dropdown adds OVERDUE, rows use derived status
    app/(app)/dashboard/page.tsx           ← Overdue KPI uses derived count
    app/(app)/customers/[id]/page.tsx      ← invoice history badges use derived status
    components/invoices/InvoiceListTable.tsx  ← uses derived status
```

Each file has one clear responsibility. `lib/payments.ts` is Prisma-free (like `lib/billing.ts`). PDF renderers take fully-materialized typed props — no Prisma imports inside JSX.

---

## Task 1: Install `@react-pdf/renderer`

**Files:**
- Modify: `bbs/package.json`

- [ ] **Step 1: Install the dependency**

Run in `bbs/`:

```bash
npm install @react-pdf/renderer@3.4.5
```

Expected: `package.json` gets a new entry under `dependencies`; `package-lock.json` updated. No install errors.

- [ ] **Step 2: Verify import works**

Run in `bbs/`:

```bash
node -e "const p = require('@react-pdf/renderer'); console.log(Object.keys(p).filter(k => ['Document','Page','View','Text','StyleSheet','renderToStream'].includes(k)).sort())"
```

Expected: `[ 'Document', 'Page', 'StyleSheet', 'Text', 'View', 'renderToStream' ]` (any order).

- [ ] **Step 3: Commit**

```bash
git add bbs/package.json bbs/package-lock.json
git commit -m "chore: add @react-pdf/renderer for invoice and receipt PDFs"
```

---

## Task 2: Payments Engine — Failing Tests

**Files:**
- Create: `bbs/src/__tests__/payments.test.ts`

- [ ] **Step 1: Create `bbs/src/__tests__/payments.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { reconcileInvoice } from "@/lib/payments";
import type { InvoiceStatus } from "@prisma/client";

function reconcile(
  totalCents: number,
  status: InvoiceStatus,
  payments: number[],
  refunds: number[] = []
) {
  return reconcileInvoice(
    { totalCents, status },
    payments.map((c) => ({ amountCents: c })),
    refunds.map((c) => ({ amountCents: c }))
  );
}

describe("reconcileInvoice", () => {
  it("keeps DRAFT with no payments", () => {
    const r = reconcile(1000, "DRAFT", []);
    expect(r).toEqual({ paidCents: 0, balanceCents: 1000, status: "DRAFT" });
  });

  it("keeps UNPAID with no payments", () => {
    const r = reconcile(1000, "UNPAID", []);
    expect(r).toEqual({ paidCents: 0, balanceCents: 1000, status: "UNPAID" });
  });

  it("marks PAID when a single payment covers the total", () => {
    const r = reconcile(1000, "UNPAID", [1000]);
    expect(r).toEqual({ paidCents: 1000, balanceCents: 0, status: "PAID" });
  });

  it("marks PARTIAL when payments cover only part of the total", () => {
    const r = reconcile(1000, "UNPAID", [400]);
    expect(r).toEqual({ paidCents: 400, balanceCents: 600, status: "PARTIAL" });
  });

  it("sums multiple payments toward PAID", () => {
    const r = reconcile(1000, "UNPAID", [400, 600]);
    expect(r).toEqual({ paidCents: 1000, balanceCents: 0, status: "PAID" });
  });

  it("clamps overpayment: paid never exceeds total, balance never negative", () => {
    const r = reconcile(1000, "UNPAID", [1500]);
    expect(r.paidCents).toBe(1000);
    expect(r.balanceCents).toBe(0);
    expect(r.status).toBe("PAID");
  });

  it("subtracts refunds from paid", () => {
    const r = reconcile(1000, "UNPAID", [1000], [400]);
    expect(r).toEqual({ paidCents: 600, balanceCents: 400, status: "PARTIAL" });
  });

  it("transitions PAID → REFUNDED when all payments fully refunded", () => {
    const r = reconcile(1000, "PAID", [1000], [1000]);
    expect(r).toEqual({ paidCents: 0, balanceCents: 1000, status: "REFUNDED" });
  });

  it("does NOT transition UNPAID → REFUNDED even if refunds >= payments", () => {
    // If the invoice was never PAID, refunding brings it back to UNPAID, not REFUNDED.
    const r = reconcile(1000, "UNPAID", [400], [400]);
    expect(r.status).toBe("UNPAID");
    expect(r.paidCents).toBe(0);
  });

  it("clamps paidCents at zero when refunds exceed payments", () => {
    const r = reconcile(1000, "PAID", [1000], [1500]);
    expect(r.paidCents).toBe(0);
    expect(r.balanceCents).toBe(1000);
  });

  it("keeps VOID terminal regardless of payments/refunds", () => {
    const r = reconcile(1000, "VOID", [1000], [500]);
    expect(r.status).toBe("VOID");
  });

  it("keeps REFUNDED terminal regardless of new payments", () => {
    const r = reconcile(1000, "REFUNDED", [1000, 500], [500]);
    expect(r.status).toBe("REFUNDED");
  });

  it("handles empty invoice (totalCents 0) as PAID with no payments", () => {
    // A zero-total invoice is trivially paid.
    const r = reconcile(0, "UNPAID", []);
    expect(r).toEqual({ paidCents: 0, balanceCents: 0, status: "PAID" });
  });

  it("preserves DRAFT when refunds bring paid back to zero", () => {
    // Refunding a draft's mistaken payment should not flip to UNPAID/REFUNDED.
    const r = reconcile(1000, "DRAFT", [500], [500]);
    expect(r.paidCents).toBe(0);
    expect(r.status).toBe("DRAFT");
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run in `bbs/`:

```bash
npm test
```

Expected: FAIL with "Cannot find module '@/lib/payments'". Existing money + billing tests should still pass.

---

## Task 3: Payments Engine — Implementation

**Files:**
- Create: `bbs/src/lib/payments.ts`

- [ ] **Step 1: Create `bbs/src/lib/payments.ts`**

```ts
import type { InvoiceStatus } from "@prisma/client";

export interface ReconcileInput {
  totalCents: number;
  status: InvoiceStatus;
}

export interface ReconcileResult {
  paidCents: number;
  balanceCents: number;
  status: InvoiceStatus;
}

export function reconcileInvoice(
  invoice: ReconcileInput,
  payments: { amountCents: number }[],
  refunds: { amountCents: number }[]
): ReconcileResult {
  // Terminal states are never re-computed.
  if (invoice.status === "VOID" || invoice.status === "REFUNDED") {
    return {
      paidCents: 0,
      balanceCents: 0,
      status: invoice.status
    };
  }

  const paymentsSum = payments.reduce((s, p) => s + p.amountCents, 0);
  const refundsSum = refunds.reduce((s, r) => s + r.amountCents, 0);
  const paidCents = Math.max(0, paymentsSum - refundsSum);
  const balanceCents = Math.max(0, invoice.totalCents - paidCents);

  // Zero-total invoices are trivially PAID.
  if (invoice.totalCents === 0) {
    return { paidCents: 0, balanceCents: 0, status: "PAID" };
  }

  // Only transition to REFUNDED if the invoice was previously PAID and all payments
  // have been fully refunded. This mirrors the spec's "refund reversal is terminal".
  if (invoice.status === "PAID" && paidCents === 0 && paymentsSum > 0) {
    return { paidCents, balanceCents, status: "REFUNDED" };
  }

  // DRAFT and UNPAID keep their status when paidCents is zero (draft protection).
  if (paidCents === 0) {
    return { paidCents, balanceCents, status: invoice.status };
  }

  if (paidCents >= invoice.totalCents) {
    return { paidCents: invoice.totalCents, balanceCents: 0, status: "PAID" };
  }

  return { paidCents, balanceCents, status: "PARTIAL" };
}
```

- [ ] **Step 2: Run tests, expect pass**

Run in `bbs/`:

```bash
npm test
```

Expected: all money + billing + payments tests PASS (32 + 14 payments = 46 total).

- [ ] **Step 3: Commit**

```bash
git add bbs/src/__tests__/payments.test.ts bbs/src/lib/payments.ts
git commit -m "feat: add pure payment reconciliation engine"
```

---

## Task 4: Status Derivation — Failing Tests

**Files:**
- Create: `bbs/src/__tests__/status.test.ts`

- [ ] **Step 1: Create `bbs/src/__tests__/status.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { deriveDisplayStatus } from "@/lib/status";
import type { InvoiceStatus } from "@prisma/client";

const NOW = new Date("2026-09-24T12:00:00Z");
const YESTERDAY = new Date("2026-09-23T12:00:00Z");
const TOMORROW = new Date("2026-09-25T12:00:00Z");

function derive(status: InvoiceStatus, dueAt: Date | null) {
  return deriveDisplayStatus({ status, dueAt }, NOW);
}

describe("deriveDisplayStatus", () => {
  it("returns OVERDUE for UNPAID with past dueAt", () => {
    expect(derive("UNPAID", YESTERDAY)).toBe("OVERDUE");
  });

  it("returns OVERDUE for PARTIAL with past dueAt", () => {
    expect(derive("PARTIAL", YESTERDAY)).toBe("OVERDUE");
  });

  it("keeps UNPAID when dueAt is future", () => {
    expect(derive("UNPAID", TOMORROW)).toBe("UNPAID");
  });

  it("keeps UNPAID when dueAt is null", () => {
    expect(derive("UNPAID", null)).toBe("UNPAID");
  });

  it("keeps PARTIAL when dueAt is future", () => {
    expect(derive("PARTIAL", TOMORROW)).toBe("PARTIAL");
  });

  it("keeps PARTIAL when dueAt is null", () => {
    expect(derive("PARTIAL", null)).toBe("PARTIAL");
  });

  it("does not overdue DRAFT even with past dueAt", () => {
    expect(derive("DRAFT", YESTERDAY)).toBe("DRAFT");
  });

  it("does not overdue PAID even with past dueAt", () => {
    expect(derive("PAID", YESTERDAY)).toBe("PAID");
  });

  it("does not overdue VOID even with past dueAt", () => {
    expect(derive("VOID", YESTERDAY)).toBe("VOID");
  });

  it("does not overdue REFUNDED even with past dueAt", () => {
    expect(derive("REFUNDED", YESTERDAY)).toBe("REFUNDED");
  });

  it("does not overdue OVERDUE input (pass-through)", () => {
    // OVERDUE never gets written to the DB, but the function should be a no-op if it is.
    expect(derive("OVERDUE", YESTERDAY)).toBe("OVERDUE");
  });

  it("uses new Date() when no now is supplied", () => {
    // Just verify the function runs without throwing when now defaults.
    expect(deriveDisplayStatus({ status: "UNPAID", dueAt: null })).toBe("UNPAID");
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run in `bbs/`:

```bash
npm test
```

Expected: FAIL with "Cannot find module '@/lib/status'".

---

## Task 5: Status Derivation — Implementation

**Files:**
- Create: `bbs/src/lib/status.ts`

- [ ] **Step 1: Create `bbs/src/lib/status.ts`**

```ts
import type { InvoiceStatus } from "@prisma/client";

export function deriveDisplayStatus(
  invoice: { status: InvoiceStatus; dueAt: Date | null },
  now: Date = new Date()
): InvoiceStatus {
  if (invoice.status !== "UNPAID" && invoice.status !== "PARTIAL") {
    return invoice.status;
  }
  if (invoice.dueAt && invoice.dueAt < now) {
    return "OVERDUE";
  }
  return invoice.status;
}
```

- [ ] **Step 2: Run tests, expect pass**

Run in `bbs/`:

```bash
npm test
```

Expected: all tests pass (money + billing + payments + status = 58 total).

- [ ] **Step 3: Commit**

```bash
git add bbs/src/__tests__/status.test.ts bbs/src/lib/status.ts
git commit -m "feat: add pure display-status derivation for OVERDUE"
```

---

## Task 6: Payment Zod Schemas

**Files:**
- Create: `bbs/src/schemas/payment.ts`

- [ ] **Step 1: Create `bbs/src/schemas/payment.ts`**

```ts
import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

const dollarString = z
  .string()
  .trim()
  .min(1, "Amount is required")
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Amount must be numeric")
  .refine((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 9_999_999;
  }, "Amount must be positive and reasonable");

export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "invoiceId required"),
  tendered: dollarString,
  method: z.nativeEnum(PaymentMethod),
  paidAt: z.string().nullable().optional(),
  referenceNumber: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v ? v : null))
    .nullable(),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .nullable(),
  idempotencyKey: z.string().uuid("idempotencyKey must be a UUID")
});

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(500)
});

export const refundPaymentSchema = z.object({
  paymentId: z.string().min(1),
  amount: dollarString,
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(500),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .nullable()
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/schemas/payment.ts
git commit -m "feat: add Zod schemas for recordPayment, voidInvoice, refundPayment"
```

---

## Task 7: Payments Server Actions

**Files:**
- Create: `bbs/src/actions/payments.ts`

- [ ] **Step 1: Create `bbs/src/actions/payments.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { toCents } from "@/lib/money";
import { reconcileInvoice } from "@/lib/payments";
import {
  recordPaymentSchema,
  refundPaymentSchema,
  voidInvoiceSchema
} from "@/schemas/payment";

async function writeAudit(
  tx: Prisma.TransactionClient,
  args: {
    action: string;
    entityType: string;
    entityId: string;
    userId: string;
    before?: unknown;
    after?: unknown;
  }
) {
  await tx.auditLog.create({
    data: {
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      userId: args.userId,
      before: args.before as Prisma.InputJsonValue | undefined,
      after: args.after as Prisma.InputJsonValue | undefined
    }
  });
}

export async function recordPayment(raw: unknown) {
  const user = await requireRole(Role.ADMIN, Role.STAFF);
  const input = recordPaymentSchema.parse(raw);

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId }
  });
  if (!invoice) {
    return { ok: false as const, error: "invoice_not_found" };
  }
  if (invoice.status === "VOID" || invoice.status === "REFUNDED" || invoice.status === "PAID") {
    return { ok: false as const, error: "invoice_terminal" };
  }

  const tenderedCents = toCents(input.tendered);
  const appliedCents = Math.min(tenderedCents, invoice.balanceCents);
  const changeCents = tenderedCents - appliedCents;

  let note = input.note;
  if (changeCents > 0) {
    const prefix = `Tendered $${input.tendered}, change $${(changeCents / 100).toFixed(2)}. `;
    note = note ? `${prefix}${note}` : prefix.trim();
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amountCents: appliedCents,
          method: input.method,
          paidAt,
          referenceNumber: input.referenceNumber,
          staffId: user.id,
          note,
          idempotencyKey: input.idempotencyKey
        }
      });

      const [payments, refunds] = await Promise.all([
        tx.payment.findMany({
          where: { invoiceId: invoice.id },
          select: { amountCents: true }
        }),
        tx.refund.findMany({
          where: { invoiceId: invoice.id },
          select: { amountCents: true }
        })
      ]);

      const reconciled = reconcileInvoice(
        { totalCents: invoice.totalCents, status: invoice.status },
        payments,
        refunds
      );

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidCents: reconciled.paidCents,
          balanceCents: reconciled.balanceCents,
          status: reconciled.status
        }
      });

      await writeAudit(tx, {
        action: "PAYMENT_RECORDED",
        entityType: "Invoice",
        entityId: invoice.id,
        userId: user.id,
        before: { status: invoice.status, paidCents: invoice.paidCents },
        after: {
          status: updated.status,
          paidCents: updated.paidCents,
          paymentId: payment.id,
          amountCents: payment.amountCents
        }
      });

      return { payment, invoice: updated };
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoice.id}`);
    revalidatePath(`/customers/${invoice.customerId}`);
    revalidatePath("/dashboard");
    return { ok: true as const, payment: result.payment, invoice: result.invoice };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Idempotency dedup: fetch existing payment.
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      const currentInvoice = await prisma.invoice.findUnique({
        where: { id: invoice.id }
      });
      return {
        ok: true as const,
        payment: existing!,
        invoice: currentInvoice!,
        deduplicated: true as const
      };
    }
    throw err;
  }
}

export async function voidInvoice(raw: unknown) {
  const user = await requireRole(Role.ADMIN);
  const input = voidInvoiceSchema.parse(raw);

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: {
      payments: { include: { refunds: true } }
    }
  });
  if (!invoice) return { ok: false as const, error: "invoice_not_found" };
  if (invoice.status === "VOID" || invoice.status === "REFUNDED") {
    return { ok: false as const, error: "already_terminal" };
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const p of invoice.payments) {
      const alreadyRefunded = p.refunds.reduce((s, r) => s + r.amountCents, 0);
      const unrefunded = p.amountCents - alreadyRefunded;
      if (unrefunded > 0) {
        await tx.refund.create({
          data: {
            invoiceId: invoice.id,
            paymentId: p.id,
            amountCents: unrefunded,
            reason: `Invoice voided: ${input.reason}`,
            staffId: user.id
          }
        });
      }
    }

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "VOID",
        paidCents: 0,
        balanceCents: 0
      }
    });

    await writeAudit(tx, {
      action: "INVOICE_VOIDED",
      entityType: "Invoice",
      entityId: invoice.id,
      userId: user.id,
      before: { status: invoice.status, paidCents: invoice.paidCents },
      after: { status: updated.status, reason: input.reason }
    });

    return updated;
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);
  revalidatePath(`/customers/${invoice.customerId}`);
  revalidatePath("/dashboard");
  return { ok: true as const, invoice: result };
}

export async function refundPayment(raw: unknown) {
  const user = await requireRole(Role.ADMIN);
  const input = refundPaymentSchema.parse(raw);

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { refunds: true, invoice: true }
  });
  if (!payment) return { ok: false as const, error: "payment_not_found" };

  const alreadyRefunded = payment.refunds.reduce((s, r) => s + r.amountCents, 0);
  const refundable = payment.amountCents - alreadyRefunded;
  const requestedCents = toCents(input.amount);
  const refundCents = Math.min(requestedCents, refundable);
  if (refundCents <= 0) {
    return { ok: false as const, error: "nothing_to_refund" };
  }

  const invoiceId = payment.invoiceId;
  const invoice = payment.invoice;

  const result = await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.create({
      data: {
        invoiceId,
        paymentId: payment.id,
        amountCents: refundCents,
        reason: input.reason,
        note: input.note,
        staffId: user.id
      }
    });

    const [payments, refunds] = await Promise.all([
      tx.payment.findMany({
        where: { invoiceId },
        select: { amountCents: true }
      }),
      tx.refund.findMany({
        where: { invoiceId },
        select: { amountCents: true }
      })
    ]);

    const reconciled = reconcileInvoice(
      { totalCents: invoice.totalCents, status: invoice.status },
      payments,
      refunds
    );

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidCents: reconciled.paidCents,
        balanceCents: reconciled.balanceCents,
        status: reconciled.status
      }
    });

    await writeAudit(tx, {
      action: "PAYMENT_REFUNDED",
      entityType: "Payment",
      entityId: payment.id,
      userId: user.id,
      before: { paidCents: invoice.paidCents, status: invoice.status },
      after: {
        refundId: refund.id,
        refundedCents: refundCents,
        newStatus: updated.status,
        reason: input.reason
      }
    });

    return { refund, invoice: updated };
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/customers/${invoice.customerId}`);
  revalidatePath("/dashboard");
  return { ok: true as const, refund: result.refund, invoice: result.invoice };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/actions/payments.ts
git commit -m "feat: add recordPayment, voidInvoice, refundPayment Server Actions"
```

---

## Task 8: Extend BillBuilder — Save & Charge Support

**Files:**
- Modify: `bbs/src/schemas/bill.ts`
- Modify: `bbs/src/actions/bills.ts`

- [ ] **Step 1: Modify `bbs/src/schemas/bill.ts` to add `chargeImmediately`**

Add `chargeImmediately` to the schema. The final `createDraftBillSchema` should look like:

```ts
export const createDraftBillSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  lines: z.array(billLineSchema).min(1, "At least one line item is required"),
  invoiceDiscount: discountSchema,
  notes: z.string().trim().max(2000).nullable().default(null),
  dueAt: z.string().nullable().default(null),
  chargeImmediately: z.boolean().default(false)
});
```

Also re-export the input type as-is (the added field flows through via `z.infer`).

- [ ] **Step 2: Modify `bbs/src/actions/bills.ts`**

Change the invoice creation's `status` field from the literal `"DRAFT"` to `input.chargeImmediately ? "UNPAID" : "DRAFT"`. The relevant block should read:

```ts
    return tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: input.customerId,
        issuedAt: new Date(),
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: input.chargeImmediately ? "UNPAID" : "DRAFT",
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
          // ... unchanged
        }
      },
      include: { lines: true }
    });
```

Everything else in the file stays the same.

- [ ] **Step 3: Verify TypeScript compiles and tests still pass**

Run in `bbs/`:

```bash
npx tsc --noEmit && npm test
```

Expected: zero tsc errors; all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add bbs/src/schemas/bill.ts bbs/src/actions/bills.ts
git commit -m "feat: createDraftBill supports chargeImmediately for UNPAID invoices"
```

---

## Task 9: PaymentModal Client Component

**Files:**
- Create: `bbs/src/components/billing/PaymentModal.tsx`

- [ ] **Step 1: Create `bbs/src/components/billing/PaymentModal.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { formatUSD, fromCents, toCents } from "@/lib/money";
import { recordPayment } from "@/actions/payments";

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: {
    id: string;
    invoiceNumber: string;
    balanceCents: number;
  };
}

const METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK", "CHECK", "MOBILE", "OTHER"];
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK: "Bank transfer",
  CHECK: "Check",
  MOBILE: "Mobile payment",
  OTHER: "Other"
};

function safeToCents(s: string): number {
  try {
    return toCents(s);
  } catch {
    return 0;
  }
}

export function PaymentModal({ open, onClose, invoice }: Props) {
  const router = useRouter();
  // One idempotency key per modal instance, generated at mount.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const [tendered, setTendered] = useState<string>(fromCents(invoice.balanceCents));
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tenderedCents = safeToCents(tendered);
  const appliedCents = Math.min(tenderedCents, invoice.balanceCents);
  const changeCents = Math.max(0, tenderedCents - invoice.balanceCents);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await recordPayment({
          invoiceId: invoice.id,
          tendered,
          method,
          paidAt: null,
          referenceNumber: referenceNumber || null,
          note: note || null,
          idempotencyKey
        });
        if (!res.ok) {
          setBanner(
            res.error === "invoice_terminal"
              ? "This invoice can no longer accept payments."
              : "Payment failed. Please try again."
          );
          return;
        }
        onClose();
        if (res.invoice.status === "PAID") {
          router.push(`/invoices/${invoice.id}/paid?receipt=1`);
        } else {
          router.refresh();
        }
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Payment failed.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Record payment · ${invoice.invoiceNumber}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        {banner && (
          <div
            role="alert"
            className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          >
            {banner}
          </div>
        )}

        <Input
          label="Amount tendered *"
          required
          inputMode="decimal"
          value={tendered}
          onChange={(e) => setTendered(e.target.value)}
        />

        <Select
          label="Method *"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </Select>

        <Input
          label="Reference #"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
        />

        <div>
          <label htmlFor="note" className="block text-sm text-muted mb-1">
            Note
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div
          aria-live="polite"
          className="bg-surface-raised border border-border rounded p-3 text-sm space-y-1"
        >
          <Row label="Balance due" value={formatUSD(invoice.balanceCents)} />
          <Row label="Applied to invoice" value={formatUSD(appliedCents)} />
          {changeCents > 0 && (
            <Row label="Change due" value={formatUSD(changeCents)} accent />
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || appliedCents === 0}>
            {isPending ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={"tabular " + (accent ? "text-gold font-semibold" : "text-text")}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/components/billing/PaymentModal.tsx
git commit -m "feat: add PaymentModal client component with tender/change UX"
```

---

## Task 10: VoidModal and RefundModal Client Components

**Files:**
- Create: `bbs/src/components/invoices/VoidModal.tsx`
- Create: `bbs/src/components/invoices/RefundModal.tsx`

- [ ] **Step 1: Create `bbs/src/components/invoices/VoidModal.tsx`**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { voidInvoice } from "@/actions/payments";

interface Props {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  hasPayments: boolean;
}

export function VoidModal({ open, onClose, invoiceId, invoiceNumber, hasPayments }: Props) {
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await voidInvoice({ invoiceId, reason });
        if (!res.ok) {
          setBanner(
            res.error === "already_terminal"
              ? "This invoice is already void or refunded."
              : "Void failed. Please try again."
          );
          return;
        }
        onClose();
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Void failed.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Void invoice · ${invoiceNumber}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div
          className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          role="alert"
        >
          Voiding cancels this invoice.
          {hasPayments
            ? " Existing payments will be automatically refunded."
            : ""}
        </div>

        {banner && (
          <div
            role="alert"
            className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          >
            {banner}
          </div>
        )}

        <Input
          label="Reason *"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div className="flex gap-2 justify-end">
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            autoFocus
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={isPending || reason.trim().length < 3}
          >
            {isPending ? "Voiding…" : "Void invoice"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `bbs/src/components/invoices/RefundModal.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatUSD, fromCents } from "@/lib/money";
import { refundPayment } from "@/actions/payments";

interface Props {
  open: boolean;
  onClose: () => void;
  payment: {
    id: string;
    amountCents: number;
    method: string;
    paidAt: Date;
    alreadyRefundedCents: number;
  };
}

export function RefundModal({ open, onClose, payment }: Props) {
  const router = useRouter();
  const refundable = payment.amountCents - payment.alreadyRefundedCents;
  const [amount, setAmount] = useState<string>(fromCents(refundable));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await refundPayment({
          paymentId: payment.id,
          amount,
          reason,
          note: note || null
        });
        if (!res.ok) {
          setBanner(
            res.error === "nothing_to_refund"
              ? "This payment has no refundable balance."
              : "Refund failed. Please try again."
          );
          return;
        }
        onClose();
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Refund failed.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Refund payment">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="bg-surface-raised border border-border rounded p-3 text-sm space-y-1">
          <div className="flex justify-between text-muted">
            <span>Payment</span>
            <span className="text-text tabular">
              {formatUSD(payment.amountCents)} · {payment.method}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Already refunded</span>
            <span className="text-text tabular">
              {formatUSD(payment.alreadyRefundedCents)}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Refundable</span>
            <span className="text-gold font-semibold tabular">
              {formatUSD(refundable)}
            </span>
          </div>
        </div>

        {banner && (
          <div
            role="alert"
            className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          >
            {banner}
          </div>
        )}

        <Input
          label="Amount *"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <Input
          label="Reason *"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div>
          <label htmlFor="refund-note" className="block text-sm text-muted mb-1">
            Note
          </label>
          <textarea
            id="refund-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={isPending || reason.trim().length < 3 || refundable <= 0}
          >
            {isPending ? "Refunding…" : "Issue refund"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add bbs/src/components/invoices/VoidModal.tsx bbs/src/components/invoices/RefundModal.tsx
git commit -m "feat: add VoidModal and RefundModal client components"
```

---

## Task 11: Payments Section and Invoice Action Bar

**Files:**
- Create: `bbs/src/components/invoices/PaymentsSection.tsx`
- Create: `bbs/src/components/invoices/InvoiceActionBar.tsx`

- [ ] **Step 1: Create `bbs/src/components/invoices/PaymentsSection.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { PaymentMethod, Role } from "@prisma/client";
import { formatUSD } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { RefundModal } from "./RefundModal";

interface PaymentRow {
  id: string;
  amountCents: number;
  method: PaymentMethod;
  paidAt: Date;
  referenceNumber: string | null;
  staffName: string;
  note: string | null;
  refunds: {
    id: string;
    amountCents: number;
    reason: string;
    refundedAt: Date;
    staffName: string;
  }[];
}

interface Props {
  payments: PaymentRow[];
  role: Role;
}

export function PaymentsSection({ payments, role }: Props) {
  const [refundOpenFor, setRefundOpenFor] = useState<PaymentRow | null>(null);

  if (payments.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
        No payments recorded.
      </div>
    );
  }

  return (
    <>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-muted uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Reference</th>
              <th className="text-left px-4 py-3">Staff</th>
              {role === "ADMIN" && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const refundedSum = p.refunds.reduce((s, r) => s + r.amountCents, 0);
              const refundable = p.amountCents - refundedSum;
              return (
                <>
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-3 text-text tabular">
                      {formatUSD(p.amountCents)}
                    </td>
                    <td className="px-4 py-3 text-text">{p.method}</td>
                    <td className="px-4 py-3 text-text">
                      {p.paidAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-muted font-mono">
                      {p.referenceNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{p.staffName}</td>
                    {role === "ADMIN" && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={refundable <= 0}
                          onClick={() => setRefundOpenFor(p)}
                        >
                          Refund
                        </Button>
                      </td>
                    )}
                  </tr>
                  {p.refunds.map((r) => (
                    <tr key={r.id} className="border-t border-border bg-surface-raised/40">
                      <td className="px-4 py-2 text-danger-bright tabular text-xs pl-8">
                        ↳ -{formatUSD(r.amountCents)}
                      </td>
                      <td className="px-4 py-2 text-muted text-xs" colSpan={role === "ADMIN" ? 5 : 4}>
                        Refund — {r.reason} · {r.refundedAt.toISOString().slice(0, 10)} · {r.staffName}
                      </td>
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {refundOpenFor && (
        <RefundModal
          open={!!refundOpenFor}
          onClose={() => setRefundOpenFor(null)}
          payment={{
            id: refundOpenFor.id,
            amountCents: refundOpenFor.amountCents,
            method: refundOpenFor.method,
            paidAt: refundOpenFor.paidAt,
            alreadyRefundedCents: refundOpenFor.refunds.reduce(
              (s, r) => s + r.amountCents,
              0
            )
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `bbs/src/components/invoices/InvoiceActionBar.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { Role, InvoiceStatus } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { PaymentModal } from "@/components/billing/PaymentModal";
import { VoidModal } from "./VoidModal";

interface Props {
  invoice: {
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    balanceCents: number;
    hasPayments: boolean;
  };
  role: Role;
}

const TERMINAL: InvoiceStatus[] = ["VOID", "REFUNDED"];

export function InvoiceActionBar({ invoice, role }: Props) {
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const isTerminal = TERMINAL.includes(invoice.status);
  const canRecordPayment =
    !isTerminal &&
    invoice.status !== "PAID" &&
    invoice.balanceCents > 0 &&
    (role === "ADMIN" || role === "STAFF");
  const canVoid = role === "ADMIN" && !isTerminal;

  return (
    <div className="flex flex-wrap gap-2">
      {canRecordPayment && (
        <Button onClick={() => setPayOpen(true)}>Record payment</Button>
      )}
      <Link
        href={`/invoices/${invoice.id}/receipt`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button variant="secondary">Print receipt</Button>
      </Link>
      <Link
        href={`/invoices/${invoice.id}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button variant="secondary">Download PDF</Button>
      </Link>
      {canVoid && (
        <Button variant="danger" onClick={() => setVoidOpen(true)}>
          Void invoice
        </Button>
      )}

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoice={{
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          balanceCents: invoice.balanceCents
        }}
      />

      <VoidModal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoiceNumber}
        hasPayments={invoice.hasPayments}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add bbs/src/components/invoices/PaymentsSection.tsx bbs/src/components/invoices/InvoiceActionBar.tsx
git commit -m "feat: add PaymentsSection and InvoiceActionBar with modals wired in"
```

---

## Task 12: Wire Action Bar and Payments Section into Invoice Detail Page

**Files:**
- Modify: `bbs/src/app/(app)/invoices/[id]/page.tsx`

- [ ] **Step 1: Replace `bbs/src/app/(app)/invoices/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD, fromCents } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
import { InvoiceStatusBadge } from "@/components/invoices/InvoiceStatusBadge";
import { InvoiceActionBar } from "@/components/invoices/InvoiceActionBar";
import { PaymentsSection } from "@/components/invoices/PaymentsSection";

export default async function InvoiceDetailPage({
  params
}: {
  params: { id: string };
}) {
  const user = await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      lines: { include: { taxRate: true } },
      payments: {
        orderBy: { paidAt: "asc" },
        include: {
          staff: { select: { name: true } },
          refunds: {
            orderBy: { refundedAt: "asc" },
            include: { staff: { select: { name: true } } }
          }
        }
      }
    }
  });
  if (!invoice) notFound();

  const displayStatus = deriveDisplayStatus({
    status: invoice.status,
    dueAt: invoice.dueAt
  });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-mono text-gold">
              {invoice.invoiceNumber}
            </h1>
            <InvoiceStatusBadge status={displayStatus} />
          </div>
          <p className="text-sm text-muted mt-1">
            Issued {invoice.issuedAt.toISOString().slice(0, 10)}
            {invoice.dueAt
              ? ` · Due ${invoice.dueAt.toISOString().slice(0, 10)}`
              : ""}
          </p>
        </div>
        <Link href="/invoices" className="text-sm text-muted hover:text-text">
          ← All invoices
        </Link>
      </div>

      <div className="mb-6">
        <InvoiceActionBar
          invoice={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            balanceCents: invoice.balanceCents,
            hasPayments: invoice.payments.length > 0
          }}
          role={user.role}
        />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-sm uppercase text-muted tracking-wide mb-2">Payments</h2>
          <PaymentsSection
            role={user.role}
            payments={invoice.payments.map((p) => ({
              id: p.id,
              amountCents: p.amountCents,
              method: p.method,
              paidAt: p.paidAt,
              referenceNumber: p.referenceNumber,
              staffName: p.staff.name,
              note: p.note,
              refunds: p.refunds.map((r) => ({
                id: r.id,
                amountCents: r.amountCents,
                reason: r.reason,
                refundedAt: r.refundedAt,
                staffName: r.staff.name
              }))
            }))}
          />
        </div>
        <div className="bg-surface border border-border rounded-lg p-5 space-y-2 self-start">
          <Row label="Subtotal" value={formatUSD(invoice.subtotalCents)} />
          <Row label="Discount" value={`-${formatUSD(invoice.discountCents)}`} />
          <Row label="Tax" value={formatUSD(invoice.taxCents)} />
          <div className="border-t border-border pt-2">
            <Row label="Total" value={formatUSD(invoice.totalCents)} strong />
          </div>
          <div className="pt-2 border-t border-border">
            <Row label="Paid" value={formatUSD(invoice.paidCents)} />
            <Row label="Balance" value={formatUSD(invoice.balanceCents)} strong />
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="bg-surface border border-border rounded-lg p-5">
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
      <span
        className={
          "tabular " + (strong ? "text-gold font-semibold text-lg" : "text-text")
        }
      >
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add "bbs/src/app/(app)/invoices/[id]/page.tsx"
git commit -m "feat: wire InvoiceActionBar, PaymentsSection, and derived status into detail page"
```

---

## Task 13: BillBuilder — Save & Charge Button

**Files:**
- Modify: `bbs/src/components/billing/BillBuilder.tsx`

- [ ] **Step 1: Replace `bbs/src/components/billing/BillBuilder.tsx`**

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
import { PaymentModal } from "./PaymentModal";
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
  const [chargeAfterSave, setChargeAfterSave] = useState<{
    id: string;
    invoiceNumber: string;
    balanceCents: number;
  } | null>(null);

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

  function submit(mode: "draft" | "charge") {
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
          dueAt: dueAt ? dueAt : null,
          chargeImmediately: mode === "charge"
        });
        if (mode === "charge") {
          setChargeAfterSave({
            id: res.invoice.id,
            invoiceNumber: res.invoice.invoiceNumber,
            balanceCents: res.invoice.balanceCents
          });
        } else {
          router.push(`/invoices/${res.invoice.id}`);
          router.refresh();
        }
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
          <Input
            label="Due date"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
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
          onClick={() => submit("charge")}
          disabled={isPending || !canSubmit()}
          className="w-full"
        >
          {isPending ? "Saving…" : "Save & charge"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => submit("draft")}
          disabled={isPending || !canSubmit()}
          className="w-full"
        >
          Save draft
        </Button>
      </div>

      {chargeAfterSave && (
        <PaymentModal
          open={true}
          onClose={() => {
            const id = chargeAfterSave.id;
            setChargeAfterSave(null);
            router.push(`/invoices/${id}`);
            router.refresh();
          }}
          invoice={chargeAfterSave}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/components/billing/BillBuilder.tsx
git commit -m "feat: BillBuilder adds Save & charge that opens PaymentModal after save"
```

---

## Task 14: Post-Payment Success Screen

**Files:**
- Create: `bbs/src/app/(app)/invoices/[id]/paid/page.tsx`

- [ ] **Step 1: Create `bbs/src/app/(app)/invoices/[id]/paid/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";
import { Button } from "@/components/ui/Button";

export default async function PaidPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { receipt?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  if (searchParams.receipt !== "1") {
    redirect(`/invoices/${params.id}`);
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      payments: {
        orderBy: { paidAt: "desc" },
        take: 1
      }
    }
  });
  if (!invoice || invoice.status !== "PAID") {
    redirect(`/invoices/${params.id}`);
  }

  const lastPayment = invoice.payments[0];
  const changeMatch = lastPayment?.note?.match(/change \$([\d.]+)/i);
  const changeText = changeMatch ? ` · $${changeMatch[1]} change due` : "";

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="mx-auto w-18 h-18 rounded-full bg-success flex items-center justify-center" style={{ width: 72, height: 72 }}>
          <div className="text-text text-4xl leading-none">✓</div>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Payment received</h1>
          <p className="text-xs text-muted font-mono mt-1">
            {invoice.invoiceNumber} · {invoice.customer.name}
          </p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">Total paid</div>
          <div className="text-3xl font-bold text-gold tabular">
            {formatUSD(invoice.totalCents)}
          </div>
          {lastPayment && (
            <div className="text-xs text-muted mt-2">
              {lastPayment.method}
              {changeText}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Link
            href={`/invoices/${invoice.id}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1"
          >
            <Button className="w-full">Print receipt</Button>
          </Link>
          <Link
            href={`/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1"
          >
            <Button variant="secondary" className="w-full">
              Download PDF
            </Button>
          </Link>
        </div>
        <Link href="/bills/new" className="block">
          <Button variant="ghost" className="w-full">
            + New bill
          </Button>
        </Link>

        <Link
          href={`/invoices/${invoice.id}`}
          className="block text-xs text-muted hover:text-text underline"
        >
          View invoice
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add "bbs/src/app/(app)/invoices/[id]/paid/page.tsx"
git commit -m "feat: add post-payment success screen with print/download/new-bill actions"
```

---

## Task 15: PDF Types and A4 Invoice Renderer

**Files:**
- Create: `bbs/src/lib/pdf/types.ts`
- Create: `bbs/src/lib/pdf/InvoicePdfA4.tsx`

- [ ] **Step 1: Create `bbs/src/lib/pdf/types.ts`**

```ts
export interface PdfBusiness {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
  defaultPaymentTerms: string | null;
  footer: string | null;
}

export interface PdfCustomer {
  name: string;
  email: string | null;
  billingAddress: string | null;
}

export interface PdfLine {
  description: string;
  quantityLabel: string; // e.g. "1", "2.5", "3 × $8.99 (10% off)"
  unitLabel: string; // e.g. "$125.00"
  totalLabel: string; // e.g. "$125.00"
}

export interface PdfPayment {
  amountLabel: string;
  method: string;
  dateLabel: string;
  tenderNote: string | null; // e.g. "Cash $160.00 — change $5.28"
}

export interface PdfInvoiceProps {
  business: PdfBusiness;
  customer: PdfCustomer;
  invoiceNumber: string;
  issuedDate: string; // YYYY-MM-DD
  dueDate: string | null;
  status: string; // display status text
  lines: PdfLine[];
  subtotalLabel: string;
  discountLabel: string;
  taxLabel: string;
  totalLabel: string;
  balanceLabel: string;
  payments: PdfPayment[];
  paymentTerms: string | null;
  footer: string | null;
}
```

- [ ] **Step 2: Create `bbs/src/lib/pdf/InvoicePdfA4.tsx`**

```tsx
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View
} from "@react-pdf/renderer";
import type { PdfInvoiceProps } from "./types";

const GOLD = "#B8973A";
const BLACK = "#0F0F0F";
const MUTED = "#666666";
const BORDER = "#E5E5E5";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 42,
    fontSize: 10,
    color: BLACK,
    fontFamily: "Helvetica"
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: GOLD,
    paddingBottom: 12,
    marginBottom: 18
  },
  brand: {
    fontSize: 14,
    color: GOLD,
    fontWeight: 700,
    letterSpacing: 0.5
  },
  metaLabel: {
    fontSize: 8,
    color: MUTED,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "Courier"
  },
  addressLine: { fontSize: 8, color: MUTED, marginTop: 1 },
  billBlock: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  balanceCallout: {
    alignItems: "flex-end"
  },
  balanceAmount: {
    fontSize: 16,
    fontWeight: 700,
    color: BLACK
  },
  linesTable: {
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER
  },
  linesHead: {
    flexDirection: "row",
    backgroundColor: "#F5F0E8",
    paddingVertical: 6,
    paddingHorizontal: 4
  },
  linesRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: BORDER
  },
  colDesc: { flex: 3 },
  colQty: { flex: 0.8, textAlign: "right" },
  colUnit: { flex: 1, textAlign: "right" },
  colTotal: { flex: 1, textAlign: "right" },
  totalsBlock: { alignSelf: "flex-end", width: 200, marginTop: 4 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2
  },
  totalsFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BLACK,
    paddingTop: 4,
    marginTop: 4,
    fontWeight: 700
  },
  paymentsSection: { marginTop: 18 },
  paymentsHeader: {
    fontSize: 8,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4
  },
  footer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    textAlign: "center",
    fontSize: 8,
    color: MUTED
  }
});

export function InvoicePdfA4(props: PdfInvoiceProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{props.business.name.toUpperCase()}</Text>
            {props.business.address && (
              <Text style={styles.addressLine}>{props.business.address}</Text>
            )}
            {(props.business.phone || props.business.email) && (
              <Text style={styles.addressLine}>
                {[props.business.phone, props.business.email].filter(Boolean).join(" · ")}
              </Text>
            )}
            {props.business.taxId && (
              <Text style={styles.addressLine}>Tax ID: {props.business.taxId}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.metaLabel}>Invoice</Text>
            <Text style={styles.invoiceNumber}>{props.invoiceNumber}</Text>
            <Text style={styles.addressLine}>Issued {props.issuedDate}</Text>
            {props.dueDate && (
              <Text style={styles.addressLine}>Due {props.dueDate}</Text>
            )}
          </View>
        </View>

        <View style={styles.billBlock}>
          <View style={{ flex: 1 }}>
            <Text style={styles.metaLabel}>Bill to</Text>
            <Text style={{ fontWeight: 700, marginTop: 2 }}>{props.customer.name}</Text>
            {props.customer.email && (
              <Text style={styles.addressLine}>{props.customer.email}</Text>
            )}
            {props.customer.billingAddress && (
              <Text style={styles.addressLine}>{props.customer.billingAddress}</Text>
            )}
          </View>
          <View style={styles.balanceCallout}>
            <Text style={styles.metaLabel}>Balance due</Text>
            <Text style={styles.balanceAmount}>{props.balanceLabel}</Text>
          </View>
        </View>

        <View style={styles.linesTable}>
          <View style={styles.linesHead}>
            <Text style={[styles.colDesc, { fontWeight: 700 }]}>Description</Text>
            <Text style={[styles.colQty, { fontWeight: 700 }]}>Qty</Text>
            <Text style={[styles.colUnit, { fontWeight: 700 }]}>Unit</Text>
            <Text style={[styles.colTotal, { fontWeight: 700 }]}>Total</Text>
          </View>
          {props.lines.map((l, i) => (
            <View key={i} style={styles.linesRow}>
              <Text style={styles.colDesc}>{l.description}</Text>
              <Text style={styles.colQty}>{l.quantityLabel}</Text>
              <Text style={styles.colUnit}>{l.unitLabel}</Text>
              <Text style={styles.colTotal}>{l.totalLabel}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Subtotal</Text>
            <Text>{props.subtotalLabel}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Discount</Text>
            <Text>-{props.discountLabel}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Tax</Text>
            <Text>{props.taxLabel}</Text>
          </View>
          <View style={styles.totalsFinal}>
            <Text>Total</Text>
            <Text>{props.totalLabel}</Text>
          </View>
        </View>

        {props.payments.length > 0 && (
          <View style={styles.paymentsSection}>
            <Text style={styles.paymentsHeader}>Payments</Text>
            {props.payments.map((p, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                {p.amountLabel} · {p.method} · {p.dateLabel}
                {p.tenderNote ? ` — ${p.tenderNote}` : ""}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          {props.paymentTerms && <Text>{props.paymentTerms}</Text>}
          {props.footer && <Text>{props.footer}</Text>}
          {!props.paymentTerms && !props.footer && (
            <Text>Thank you for your business</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add bbs/src/lib/pdf/types.ts bbs/src/lib/pdf/InvoicePdfA4.tsx
git commit -m "feat: add A4 invoice PDF renderer (clean corporate layout)"
```

---

## Task 16: Thermal Receipt Renderer

**Files:**
- Create: `bbs/src/lib/pdf/ReceiptPdfThermal.tsx`

- [ ] **Step 1: Create `bbs/src/lib/pdf/ReceiptPdfThermal.tsx`**

```tsx
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View
} from "@react-pdf/renderer";
import type { PdfInvoiceProps } from "./types";

const BLACK = "#000000";
const MUTED = "#555555";

// 80mm ≈ 226.77pt. Height is auto for thermal.
const PAGE_WIDTH = 226.77;

const styles = StyleSheet.create({
  page: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 12,
    fontSize: 8,
    color: BLACK,
    fontFamily: "Helvetica"
  },
  brand: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 4
  },
  center: { textAlign: "center", fontSize: 8, color: MUTED },
  bar: {
    height: 1.5,
    backgroundColor: BLACK,
    marginVertical: 6
  },
  monoCenter: {
    fontFamily: "Courier",
    fontSize: 8,
    textAlign: "center",
    marginBottom: 4
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5"
  },
  lineName: { flex: 1, paddingRight: 4 },
  lineTotal: { fontVariant: ["tabular-nums"] },
  lineSub: { fontSize: 7, color: MUTED, marginTop: 1 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1
  },
  totalsFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    marginTop: 4,
    fontWeight: 700,
    fontSize: 11,
    borderTopWidth: 1,
    borderTopColor: BLACK
  },
  footer: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 7,
    color: MUTED
  }
});

export function ReceiptPdfThermal(props: PdfInvoiceProps) {
  return (
    <Document>
      <Page size={{ width: PAGE_WIDTH, height: "auto" as unknown as number }} style={styles.page}>
        <Text style={styles.brand}>{props.business.name}</Text>
        {props.business.address && <Text style={styles.center}>{props.business.address}</Text>}
        {props.business.phone && <Text style={styles.center}>{props.business.phone}</Text>}

        <View style={styles.bar} />

        <Text style={styles.monoCenter}>
          {props.invoiceNumber} · {props.issuedDate}
        </Text>

        {props.lines.map((l, i) => (
          <View key={i} style={styles.lineRow}>
            <View style={styles.lineName}>
              <Text>{l.description}</Text>
              <Text style={styles.lineSub}>{l.quantityLabel} × {l.unitLabel}</Text>
            </View>
            <Text style={styles.lineTotal}>{l.totalLabel}</Text>
          </View>
        ))}

        <View style={{ marginTop: 8 }}>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Subtotal</Text>
            <Text>{props.subtotalLabel}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Discount</Text>
            <Text>-{props.discountLabel}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={{ color: MUTED }}>Tax</Text>
            <Text>{props.taxLabel}</Text>
          </View>
          <View style={styles.totalsFinal}>
            <Text>Total</Text>
            <Text>{props.totalLabel}</Text>
          </View>
        </View>

        {props.payments.length > 0 && (
          <>
            <View style={styles.bar} />
            {props.payments.map((p, i) => (
              <View key={i}>
                <View style={styles.totalsRow}>
                  <Text style={{ color: MUTED }}>{p.method}</Text>
                  <Text>{p.amountLabel}</Text>
                </View>
                {p.tenderNote && (
                  <Text style={styles.lineSub}>{p.tenderNote}</Text>
                )}
              </View>
            ))}
          </>
        )}

        <View style={styles.footer}>
          <Text>Thank you for your business</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/lib/pdf/ReceiptPdfThermal.tsx
git commit -m "feat: add thermal receipt PDF renderer (modern minimal layout)"
```

---

## Task 17: PDF Route Handlers

**Files:**
- Create: `bbs/src/app/(app)/invoices/[id]/pdf/route.ts`
- Create: `bbs/src/app/(app)/invoices/[id]/receipt/route.ts`
- Create: `bbs/src/lib/pdf/build-props.ts`

- [ ] **Step 1: Create `bbs/src/lib/pdf/build-props.ts`** — shared prop assembly

```ts
import type { Invoice, Customer, InvoiceLine, TaxRate, Payment, Refund, BusinessSettings } from "@prisma/client";
import { formatUSD, fromCents } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
import type { PdfInvoiceProps } from "./types";

type FullInvoice = Invoice & {
  customer: Customer;
  lines: (InvoiceLine & { taxRate: TaxRate | null })[];
  payments: (Payment & { refunds: Refund[] })[];
};

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildPdfProps(
  invoice: FullInvoice,
  settings: BusinessSettings
): PdfInvoiceProps {
  const status = deriveDisplayStatus({
    status: invoice.status,
    dueAt: invoice.dueAt
  });

  const lines = invoice.lines.map((l) => {
    const discountNote =
      l.discountType === "PERCENT" && Number(l.discountValue) > 0
        ? ` (${l.discountValue}% off)`
        : l.discountType === "FIXED" && Number(l.discountValue) > 0
        ? ` (-${formatUSD(Number(l.discountValue))})`
        : "";
    return {
      description: `${l.description}${discountNote}`,
      quantityLabel: l.quantity.toString(),
      unitLabel: `$${fromCents(l.unitPriceCents)}`,
      totalLabel: formatUSD(l.lineTotalCents)
    };
  });

  const payments = invoice.payments.map((p) => {
    const tenderMatch = p.note?.match(/Tendered \$([\d.]+), change \$([\d.]+)/);
    const tenderNote = tenderMatch
      ? `Tendered $${tenderMatch[1]}, change $${tenderMatch[2]}`
      : null;
    return {
      amountLabel: formatUSD(p.amountCents),
      method: p.method,
      dateLabel: fmtDate(p.paidAt),
      tenderNote
    };
  });

  return {
    business: {
      name: settings.name,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      taxId: settings.taxId,
      defaultPaymentTerms: settings.defaultPaymentTerms,
      footer: settings.footer
    },
    customer: {
      name: invoice.customer.name,
      email: invoice.customer.email,
      billingAddress: invoice.customer.billingAddress
    },
    invoiceNumber: invoice.invoiceNumber,
    issuedDate: fmtDate(invoice.issuedAt),
    dueDate: invoice.dueAt ? fmtDate(invoice.dueAt) : null,
    status,
    lines,
    subtotalLabel: formatUSD(invoice.subtotalCents),
    discountLabel: formatUSD(invoice.discountCents),
    taxLabel: formatUSD(invoice.taxCents),
    totalLabel: formatUSD(invoice.totalCents),
    balanceLabel: formatUSD(invoice.balanceCents),
    payments,
    paymentTerms: settings.defaultPaymentTerms,
    footer: settings.footer
  };
}
```

- [ ] **Step 2: Create `bbs/src/app/(app)/invoices/[id]/pdf/route.ts`**

```ts
import { renderToStream } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { InvoicePdfA4 } from "@/lib/pdf/InvoicePdfA4";
import { buildPdfProps } from "@/lib/pdf/build-props";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        lines: { include: { taxRate: true } },
        payments: { orderBy: { paidAt: "asc" }, include: { refunds: true } }
      }
    }),
    prisma.businessSettings.findUnique({ where: { id: 1 } })
  ]);

  if (!invoice || !settings) {
    return new NextResponse("Not found", { status: 404 });
  }

  const props = buildPdfProps(invoice, settings);
  const stream = await renderToStream(<InvoicePdfA4 {...props} />);

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
```

- [ ] **Step 3: Create `bbs/src/app/(app)/invoices/[id]/receipt/route.ts`**

```ts
import { renderToStream } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { ReceiptPdfThermal } from "@/lib/pdf/ReceiptPdfThermal";
import { buildPdfProps } from "@/lib/pdf/build-props";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        lines: { include: { taxRate: true } },
        payments: { orderBy: { paidAt: "asc" }, include: { refunds: true } }
      }
    }),
    prisma.businessSettings.findUnique({ where: { id: 1 } })
  ]);

  if (!invoice || !settings) {
    return new NextResponse("Not found", { status: 404 });
  }

  const props = buildPdfProps(invoice, settings);
  const stream = await renderToStream(<ReceiptPdfThermal {...props} />);

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}-receipt.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors. Note: if tsc complains about JSX in `.ts` files, both route files should be renamed to `.tsx` extension. Verify by re-running.

- [ ] **Step 5: If tsc errored on JSX in `.ts`, rename**

If Step 4 reported errors like "JSX not allowed in .ts files":

```bash
git mv "bbs/src/app/(app)/invoices/[id]/pdf/route.ts" "bbs/src/app/(app)/invoices/[id]/pdf/route.tsx"
git mv "bbs/src/app/(app)/invoices/[id]/receipt/route.ts" "bbs/src/app/(app)/invoices/[id]/receipt/route.tsx"
```

Rerun `npx tsc --noEmit` — expect zero errors.

- [ ] **Step 6: Commit**

```bash
git add "bbs/src/app/(app)/invoices/[id]/pdf" "bbs/src/app/(app)/invoices/[id]/receipt" bbs/src/lib/pdf/build-props.ts
git commit -m "feat: add /pdf and /receipt streaming routes for invoice documents"
```

---

## Task 18: OVERDUE Surfacing in Lists and Dashboard

**Files:**
- Modify: `bbs/src/components/invoices/InvoiceListTable.tsx`
- Modify: `bbs/src/app/(app)/invoices/page.tsx`
- Modify: `bbs/src/app/(app)/customers/[id]/page.tsx`
- Modify: `bbs/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Modify `bbs/src/components/invoices/InvoiceListTable.tsx`**

Update the badge rendering to use `deriveDisplayStatus`. Full file:

```tsx
import Link from "next/link";
import type { Invoice, Customer } from "@prisma/client";
import { formatUSD } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
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
          {invoices.map((inv) => {
            const status = deriveDisplayStatus({
              status: inv.status,
              dueAt: inv.dueAt
            });
            return (
              <tr key={inv.id} className="border-t border-border hover:bg-surface-raised">
                <td className="px-4 py-3">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="text-gold hover:underline font-mono"
                  >
                    {inv.invoiceNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text">{inv.customer.name}</td>
                <td className="px-4 py-3 text-text">
                  {inv.issuedAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3">
                  <InvoiceStatusBadge status={status} />
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {formatUSD(inv.totalCents)}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {formatUSD(inv.balanceCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Modify `bbs/src/app/(app)/invoices/page.tsx` — support OVERDUE filter**

Update the `where` computation and dropdown. Full replacement of the file:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { InvoiceListTable } from "@/components/invoices/InvoiceListTable";
import type { InvoiceStatus, Prisma } from "@prisma/client";

const PAGE_SIZE = 25;

export default async function InvoicesPage({
  searchParams
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const rawStatus = (searchParams.status ?? "").toUpperCase();
  const q = searchParams.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.page ?? "1") | 0);
  const now = new Date();

  const where: Prisma.InvoiceWhereInput = {};
  if (rawStatus === "OVERDUE") {
    where.status = { in: ["UNPAID", "PARTIAL"] };
    where.dueAt = { lt: now };
  } else if (rawStatus) {
    where.status = rawStatus as InvoiceStatus;
  }
  if (q) {
    where.OR = [
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } }
    ];
  }

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
          defaultValue={rawStatus}
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
                query: {
                  ...(q ? { q } : {}),
                  ...(rawStatus ? { status: rawStatus } : {}),
                  page: p
                }
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

- [ ] **Step 3: Modify `bbs/src/app/(app)/customers/[id]/page.tsx` — use derived status badges**

Find the invoice-history table row inside the file. Replace the plain `{inv.status}` cell with the badge. The relevant `<tbody>` block should become:

```tsx
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
                  <td className="px-4 py-3 text-text">
                    <InvoiceStatusBadge
                      status={deriveDisplayStatus({
                        status: inv.status,
                        dueAt: inv.dueAt
                      })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-text tabular">
                    {formatUSD(inv.totalCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-text tabular">
                    {formatUSD(inv.balanceCents)}
                  </td>
                </tr>
              ))}
```

Add the two imports at the top of the file:

```ts
import { deriveDisplayStatus } from "@/lib/status";
import { InvoiceStatusBadge } from "@/components/invoices/InvoiceStatusBadge";
```

- [ ] **Step 4: Modify `bbs/src/app/(app)/dashboard/page.tsx` — Overdue KPI counts derived-overdue invoices**

Replace the entire file:

```tsx
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";

export default async function DashboardPage() {
  const user = await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [todaysPaid, outstandingAgg, completedCount, overdueCount] = await Promise.all([
    prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: { paidAt: { gte: startOfDay } }
    }),
    prisma.invoice.aggregate({
      _sum: { balanceCents: true },
      where: { status: { in: ["UNPAID", "PARTIAL"] } }
    }),
    prisma.invoice.count({ where: { status: "PAID" } }),
    prisma.invoice.count({
      where: {
        status: { in: ["UNPAID", "PARTIAL"] },
        dueAt: { lt: now }
      }
    })
  ]);

  const kpis = [
    { label: "Today's Revenue", value: formatUSD(todaysPaid._sum.amountCents ?? 0) },
    { label: "Outstanding", value: formatUSD(outstandingAgg._sum.balanceCents ?? 0) },
    { label: "Completed", value: String(completedCount) },
    { label: "Overdue", value: String(overdueCount) }
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Dashboard</h1>
        <p className="text-sm text-muted mt-1">Welcome back, {user.name ?? "there"}.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-surface border border-border rounded-lg p-5">
            <div className="text-xs text-muted uppercase tracking-wide">{kpi.label}</div>
            <div className="mt-2 text-2xl font-semibold text-gold tabular">{kpi.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add bbs/src/components/invoices/InvoiceListTable.tsx "bbs/src/app/(app)/invoices/page.tsx" "bbs/src/app/(app)/customers/[id]/page.tsx" "bbs/src/app/(app)/dashboard/page.tsx"
git commit -m "feat: surface OVERDUE via deriveDisplayStatus in lists and dashboard KPI"
```

---

## Task 19: End-to-End Phase 3 Verification

- [ ] **Step 1: Run all unit tests**

Run in `bbs/`:

```bash
npm test
```

Expected: 58 tests passing (14 money + 18 billing + 14 payments + 12 status).

- [ ] **Step 2: Clean any stale `.next` before building**

Run in `bbs/`:

```bash
rm -rf .next 2>/dev/null; npm run build
```

Expected: build succeeds; new routes `/invoices/[id]/paid`, `/invoices/[id]/pdf`, `/invoices/[id]/receipt` appear in the route summary.

- [ ] **Step 3: Start the dev server**

Run in `bbs/`:

```bash
npm run dev
```

- [ ] **Step 4: Golden path — Save & charge then success screen**

Manually or via cURL (see Phase 2's smoke pattern):

1. Sign in as `admin@bricebeauty.example` / `admin1234`
2. Visit `/bills/new`
3. Pick the existing Acme Smoke Test customer, add a Lace Front Wig line (qty 1)
4. Click **Save & charge**
5. Expect the PaymentModal to open with tendered defaulted to the total
6. Set tendered to a value greater than the total (e.g. total + $10)
7. Confirm the "Change due" line appears with the correct amount
8. Click **Record payment**
9. Expect redirect to `/invoices/{id}/paid?receipt=1` with the "Payment received" screen

- [ ] **Step 5: PDF checks**

From the success screen:

- Click **Print receipt** — new tab opens `/invoices/{id}/receipt`, PDF renders with narrow thermal layout showing tender/change note
- Click **Download PDF** — new tab opens `/invoices/{id}/pdf`, wider Letter-size PDF renders

Sanity: `curl -b /tmp/cj http://localhost:3000/invoices/{id}/pdf -o /tmp/test.pdf -w "%{http_code} %{content_type}\n"` returns `200 application/pdf` and a non-empty file.

- [ ] **Step 6: Idempotency check**

From `bbs/`, run against the same invoice created above:

```bash
node -e "
require('fs').readFileSync('.env','utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*\"?([^\"]*)\"?\s*\$/); if (m) process.env[m[1]] = m[2]; });
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
p.payment.count().then(c => console.log('total payments in DB:', c)).finally(() => p.\$disconnect());
"
```

Note the count. Simulating a double-submit is easier via the DB check: after Save & charge in Step 4, one payment row per successful modal submit. Verify one row per action.

- [ ] **Step 7: Void an invoice (ADMIN)**

- Sign in still as ADMIN
- Create another draft invoice (Save draft) — status DRAFT
- On the invoice detail, click **Void invoice**
- Enter reason "Test void"
- Confirm the invoice status becomes VOID; no refund rows created (there were no payments)

Now void the paid one from Step 4:

- Visit the earlier PAID invoice
- Click **Void invoice**
- Reason "Test void with refund"
- Expect status VOID and a Refund row equal to the payment amount appears in the Payments section

- [ ] **Step 8: Partial refund flow (ADMIN)**

- Create a new bill via **Save & charge** for a customer, record payment for the full total
- Invoice becomes PAID
- On the payment row, click **Refund**
- Enter a partial amount (half the total) with a reason
- Confirm invoice status stays PAID (payment still has refundable balance covering the total)

Wait — if the payment is refunded partially, `paidCents` drops below `totalCents`, so status should transition to `PARTIAL`. Verify: after partial refund the badge should read `PARTIAL`, not `PAID`.

Then refund the remaining half:

- After the second refund, expect status `REFUNDED`

- [ ] **Step 9: OVERDUE surfacing**

Directly in the DB, set an existing UNPAID invoice's `dueAt` to yesterday, then check:

```bash
node -e "
require('fs').readFileSync('.env','utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*\"?([^\"]*)\"?\s*\$/); if (m) process.env[m[1]] = m[2]; });
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findFirst({ where: { status: 'UNPAID' } });
  if (!inv) { console.log('no UNPAID invoice to test OVERDUE'); return; }
  const yesterday = new Date(Date.now() - 24*60*60*1000);
  await p.invoice.update({ where: { id: inv.id }, data: { dueAt: yesterday } });
  console.log('Set', inv.invoiceNumber, 'dueAt to', yesterday.toISOString());
})().finally(() => p.\$disconnect());
"
```

Visit `/invoices` — the invoice should display the OVERDUE badge. DB status is still `UNPAID` (confirm by grepping the row directly).

Filter dropdown: choose "Overdue" — only rows with `status IN (UNPAID, PARTIAL)` and `dueAt < now()` show.

- [ ] **Step 10: VIEWER role check**

To sanity-check RBAC, insert a VIEWER user via SQL (Prisma) and sign in as them:

```bash
node -e "
require('fs').readFileSync('.env','utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*\"?([^\"]*)\"?\s*\$/); if (m) process.env[m[1]] = m[2]; });
const {PrismaClient} = require('@prisma/client');
const bcrypt = require('bcryptjs');
(async () => {
  const p = new PrismaClient();
  const hash = await bcrypt.hash('viewer1234', 12);
  const u = await p.user.upsert({
    where: { email: 'viewer@bricebeauty.example' },
    update: {},
    create: { name: 'BBS Viewer', email: 'viewer@bricebeauty.example', passwordHash: hash, role: 'VIEWER', active: true }
  });
  console.log('viewer user:', u.email);
  await p.\$disconnect();
})();
"
```

Sign in as `viewer@bricebeauty.example` / `viewer1234`. Verify:
- Can browse `/invoices`, `/customers`, `/catalog`
- On `/invoices/[id]`, does NOT see Record Payment or Void or Refund buttons
- Can click Download PDF / Print Receipt and both render successfully
- Direct navigation to `/bills/new` produces the error boundary (Server Action's `requireRole` throws)

- [ ] **Step 11: Stop dev server**

```bash
# find and kill the dev server
ps -ef | grep "next-server\|next dev" | grep -v grep | awk '{print $2}' | xargs -r kill
```

- [ ] **Step 12: Commit any generated stragglers**

```bash
git status
```

If anything unexpected appears (e.g. lockfile updates, `next-env.d.ts`), review and commit or ignore as appropriate.

---

## Phase 3 Done When

- `npm test` passes 58 tests
- `npm run build` completes without errors; new PDF and paid routes appear
- Save & charge produces an UNPAID invoice, opens the payment modal, records payment, redirects to the success screen
- Success screen renders "Payment received" with correct total, method, and change readout
- Print receipt and Download PDF both stream valid `application/pdf` responses
- Void of an UNPAID invoice sets status VOID with no refunds; void of a PAID invoice auto-creates matching Refund rows
- Partial refund of a payment transitions invoice to PARTIAL; fully refunding all payments of a PAID invoice transitions to REFUNDED
- OVERDUE badge appears on UNPAID/PARTIAL invoices with past dueAt; DB `Invoice.status` column is never written as OVERDUE
- Dashboard "Overdue" KPI counts these correctly
- VIEWER can read invoices and download PDFs but cannot open the payment/void/refund modals

The following commits exist on the branch (19 total):

1. chore: add @react-pdf/renderer for invoice and receipt PDFs
2. feat: add pure payment reconciliation engine
3. feat: add pure display-status derivation for OVERDUE
4. feat: add Zod schemas for recordPayment, voidInvoice, refundPayment
5. feat: add recordPayment, voidInvoice, refundPayment Server Actions
6. feat: createDraftBill supports chargeImmediately for UNPAID invoices
7. feat: add PaymentModal client component with tender/change UX
8. feat: add VoidModal and RefundModal client components
9. feat: add PaymentsSection and InvoiceActionBar with modals wired in
10. feat: wire InvoiceActionBar, PaymentsSection, and derived status into detail page
11. feat: BillBuilder adds Save & charge that opens PaymentModal after save
12. feat: add post-payment success screen with print/download/new-bill actions
13. feat: add A4 invoice PDF renderer (clean corporate layout)
14. feat: add thermal receipt PDF renderer (modern minimal layout)
15. feat: add /pdf and /receipt streaming routes for invoice documents
16. feat: surface OVERDUE via deriveDisplayStatus in lists and dashboard KPI

(Tasks 2+3 bundle into one commit; Tasks 4+5 bundle into one commit; the actual commit count will be 16 not 19 — the plan bundles paired TDD tasks.)

---

## What Phase 4 Will Build On

- `lib/payments.ts::reconcileInvoice` — reused whenever a payment or refund changes; the same function will power dashboard revenue rollups in Phase 4
- `lib/status.ts::deriveDisplayStatus` — the OVERDUE derivation is used everywhere status is shown
- `PaymentModal`, `VoidModal`, `RefundModal` — already handle all mutation UX; Phase 4 can reuse them as-is
- PDF renderers (`InvoicePdfA4`, `ReceiptPdfThermal`) — Phase 4's Duplicate action and Send stub can call the same routes; no re-renderer needed
- Success screen — Phase 4 may add an "Email receipt" button when the SMTP integration lands
