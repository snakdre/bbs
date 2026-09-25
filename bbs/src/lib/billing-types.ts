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
