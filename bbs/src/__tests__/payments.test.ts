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

  it("transitions PARTIAL back to UNPAID when refunds zero out payments", () => {
    // Was UNPAID, partial payment made it PARTIAL, refund brings paid to 0.
    // Should NOT stay PARTIAL (incoherent) and should NOT be REFUNDED (was never PAID).
    const r = reconcile(1000, "PARTIAL", [400], [400]);
    expect(r.paidCents).toBe(0);
    expect(r.balanceCents).toBe(1000);
    expect(r.status).toBe("UNPAID");
  });

  it("keeps PARTIAL when a partial refund still leaves some paid", () => {
    // 400 paid, 100 refunded → 300 paid, still partial.
    const r = reconcile(1000, "PARTIAL", [400], [100]);
    expect(r.paidCents).toBe(300);
    expect(r.balanceCents).toBe(700);
    expect(r.status).toBe("PARTIAL");
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
