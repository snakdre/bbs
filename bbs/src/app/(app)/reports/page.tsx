import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";
import { resolveRange } from "@/lib/timezone";
import {
  getRevenueReport,
  getAgingReport,
  getPaymentMethodsReport,
  getTaxesReport,
  getDiscountsReport,
  getRefundsReport,
  getTopItemsReport,
  type Granularity
} from "@/lib/reports";
import { RevenueChart } from "@/components/charts/RevenueChart";
import { DateRangePicker } from "@/components/reports/DateRangePicker";
import { ReportSection } from "@/components/reports/ReportSection";

function buildCsvHref(base: string, searchParams: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function ReportsPage({
  searchParams
}: {
  searchParams: { range?: string; from?: string; to?: string; granularity?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone ?? "America/New_York";
  const now = new Date();

  const resolved = resolveRange(searchParams, tz, now);
  if ("error" in resolved) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <DateRangePicker />
        <div
          role="alert"
          className="mt-4 text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
        >
          Invalid date range. Please pick a valid From and To.
        </div>
      </div>
    );
  }

  const granularity: Granularity =
    searchParams.granularity === "weekly" || searchParams.granularity === "monthly"
      ? searchParams.granularity
      : "daily";

  const [revenue, aging, methods, taxes, discounts, refunds, topItems] = await Promise.all([
    getRevenueReport(resolved, granularity, tz),
    getAgingReport(now),
    getPaymentMethodsReport(resolved),
    getTaxesReport(resolved),
    getDiscountsReport(resolved),
    getRefundsReport(resolved),
    getTopItemsReport(resolved, 20)
  ]);

  const totalRevenue = revenue.reduce((s, b) => s + b.netCents, 0);
  const totalOutstanding = aging.reduce((s, b) => s + b.balanceCents, 0);
  const totalPayments = methods.reduce((s, m) => s + m.amountCents, 0);
  const totalTax = taxes.reduce((s, t) => s + t.taxCents, 0);
  const totalDiscounts = discounts.reduce((s, d) => s + d.totalDiscountCents, 0);
  const totalRefunds = refunds.reduce((s, r) => s + r.amountCents, 0);
  const distinctItems = topItems.length;

  const csvParams: Record<string, string | undefined> = {
    range: searchParams.range,
    from: searchParams.from,
    to: searchParams.to,
    granularity: searchParams.granularity
  };

  return (
    <div>
      <div className="mb-2">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted mt-1">{resolved.label}</p>
      </div>

      <DateRangePicker />

      <div className="mt-6">
        <RevenueChart
          buckets={revenue.map((r) => ({ label: r.label, valueCents: r.netCents }))}
          variant="full"
          totalLabel={formatUSD(totalRevenue)}
          rangeLabel={resolved.label}
          granularity={granularity}
        />
      </div>

      {/* Revenue table */}
      <ReportSection
        title="Revenue"
        subtitle={`${revenue.length} ${granularity === "daily" ? "days" : granularity === "weekly" ? "weeks" : "months"}`}
        totalLabel={formatUSD(totalRevenue)}
        csvHref={buildCsvHref("/reports/revenue.csv", csvParams)}
      >
        {revenue.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No revenue in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Payments</th>
                  <th className="text-right px-4 py-3">Refunds</th>
                  <th className="text-right px-4 py-3">Net</th>
                </tr>
              </thead>
              <tbody>
                {revenue.map((b) => (
                  <tr key={b.label} className="border-t border-border">
                    <td className="px-4 py-2 text-text font-mono text-xs">{b.label}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(b.paymentsCents)}</td>
                    <td className="px-4 py-2 text-right text-danger-bright tabular">
                      {b.refundsCents > 0 ? `-${formatUSD(b.refundsCents)}` : "$0.00"}
                    </td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(b.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Aging (snapshot, ignores range) */}
      <ReportSection
        title="Paid vs Outstanding"
        subtitle={`As of ${now.toISOString().slice(0, 10)}`}
        totalLabel={formatUSD(totalOutstanding)}
        csvHref={buildCsvHref("/reports/aging.csv", csvParams)}
      >
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-muted uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Aging bucket</th>
                <th className="text-right px-4 py-3">Invoices</th>
                <th className="text-right px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((a) => (
                <tr key={a.bucket} className="border-t border-border">
                  <td className="px-4 py-2 text-text">{a.bucket}</td>
                  <td className="px-4 py-2 text-right text-text tabular">{a.invoiceCount}</td>
                  <td className="px-4 py-2 text-right text-text tabular">{formatUSD(a.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>

      {/* Payment methods */}
      <ReportSection
        title="Payment methods"
        subtitle={`${methods.length} method${methods.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalPayments)}
        csvHref={buildCsvHref("/reports/payment-methods.csv", csvParams)}
      >
        {methods.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No payments in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Method</th>
                  <th className="text-right px-4 py-3">Count</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-right px-4 py-3">% of total</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((m) => (
                  <tr key={m.method} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{m.method}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{m.count}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(m.amountCents)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{m.percentOfTotal.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Taxes */}
      <ReportSection
        title="Taxes collected"
        subtitle={`${taxes.length} rate${taxes.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalTax)}
        csvHref={buildCsvHref("/reports/taxes.csv", csvParams)}
      >
        {taxes.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No taxable payments in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Tax rate</th>
                  <th className="text-right px-4 py-3">Rate</th>
                  <th className="text-right px-4 py-3">Taxable base</th>
                  <th className="text-right px-4 py-3">Tax collected</th>
                </tr>
              </thead>
              <tbody>
                {taxes.map((t) => (
                  <tr key={t.taxRateId} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{t.name}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{t.ratePercent}%</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(t.taxableBaseCents)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(t.taxCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Discounts */}
      <ReportSection
        title="Discounts issued"
        subtitle={`${discounts.length} invoice${discounts.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalDiscounts)}
        csvHref={buildCsvHref("/reports/discounts.csv", csvParams)}
      >
        {discounts.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No discounts issued in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Invoice</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Invoice disc.</th>
                  <th className="text-right px-4 py-3">Line disc.</th>
                  <th className="text-right px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.invoiceId} className="border-t border-border">
                    <td className="px-4 py-2 text-gold font-mono text-xs">{d.invoiceNumber}</td>
                    <td className="px-4 py-2 text-text">{d.customerName}</td>
                    <td className="px-4 py-2 text-text">{d.issuedAt.toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(d.invoiceDiscountCents)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(d.lineDiscountCents)}</td>
                    <td className="px-4 py-2 text-right text-gold tabular">{formatUSD(d.totalDiscountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Refunds */}
      <ReportSection
        title="Refunds & voids"
        subtitle={`${refunds.length} refund${refunds.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalRefunds)}
        csvHref={buildCsvHref("/reports/refunds.csv", csvParams)}
      >
        {refunds.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No refunds in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Invoice</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-left px-4 py-3">Reason</th>
                  <th className="text-left px-4 py-3">Staff</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{r.refundedAt.toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 text-gold font-mono text-xs">{r.invoiceNumber}</td>
                    <td className="px-4 py-2 text-text">{r.customerName}</td>
                    <td className="px-4 py-2 text-right text-danger-bright tabular">
                      {formatUSD(r.amountCents)}
                    </td>
                    <td className="px-4 py-2 text-muted text-xs">{r.reason}</td>
                    <td className="px-4 py-2 text-muted">{r.staffName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Top items */}
      <ReportSection
        title="Top products & services"
        subtitle={`${distinctItems} item${distinctItems === 1 ? "" : "s"} sold`}
        csvHref={buildCsvHref("/reports/top-items.csv", csvParams)}
      >
        {topItems.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No items sold in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-left px-4 py-3">SKU</th>
                  <th className="text-right px-4 py-3">Qty sold</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((t) => (
                  <tr key={t.catalogItemId ?? t.itemName} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{t.itemName}</td>
                    <td className="px-4 py-2 text-muted font-mono text-xs">{t.sku ?? "—"}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{t.qtySold}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(t.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>
    </div>
  );
}
