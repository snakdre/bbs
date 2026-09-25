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

  // When paidCents is zero: DRAFT and UNPAID stay as-is (draft protection).
  // PARTIAL that has been fully refunded goes back to UNPAID (PARTIAL requires some paid).
  if (paidCents === 0) {
    const nextStatus = invoice.status === "PARTIAL" ? "UNPAID" : invoice.status;
    return { paidCents, balanceCents, status: nextStatus };
  }

  if (paidCents >= invoice.totalCents) {
    return { paidCents: invoice.totalCents, balanceCents: 0, status: "PAID" };
  }

  return { paidCents, balanceCents, status: "PARTIAL" };
}
