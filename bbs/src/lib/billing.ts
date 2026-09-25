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
