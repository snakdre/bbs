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
