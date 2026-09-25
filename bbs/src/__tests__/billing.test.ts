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
