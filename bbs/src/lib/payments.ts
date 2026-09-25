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
