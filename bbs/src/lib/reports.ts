import { prisma } from "@/lib/prisma";
import type { PaymentMethod } from "@prisma/client";

export interface ReportRange {
  from: Date;
  to: Date;
}

export type Granularity = "daily" | "weekly" | "monthly";

// ────────────────────────────────────────────────────────────────
// 1. Revenue (bucketed)
// ────────────────────────────────────────────────────────────────

export interface RevenueBucket {
  label: string;
  startDate: Date;
  paymentsCents: number;
  refundsCents: number;
  netCents: number;
}

/**
 * Get calendar Y/M/D in a timezone.
 */
function calDate(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: g("year"), month: g("month"), day: g("day") };
}

function utcMidnight(y: number, m: number, d: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const cal = calDate(guess, tz);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(guess);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const min = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const dayDiffMs =
      Date.UTC(cal.year, cal.month - 1, cal.day) - Date.UTC(y, m - 1, d);
    const dayDiff = dayDiffMs / 86_400_000;
    const shift = dayDiff * 24 * 60 + h * 60 + min;
    if (shift === 0) break;
    guess = new Date(guess.getTime() - shift * 60_000);
  }
  return guess;
}

function bucketKey(d: Date, granularity: Granularity, tz: string): { key: string; startDate: Date; label: string } {
  const cal = calDate(d, tz);
  if (granularity === "daily") {
    const key = `${cal.year}-${String(cal.month).padStart(2, "0")}-${String(cal.day).padStart(2, "0")}`;
    return { key, startDate: utcMidnight(cal.year, cal.month, cal.day, tz), label: key };
  }
  if (granularity === "monthly") {
    const key = `${cal.year}-${String(cal.month).padStart(2, "0")}`;
    return { key, startDate: utcMidnight(cal.year, cal.month, 1, tz), label: key };
  }
  // weekly: bucket by Monday of the week (ISO)
  const dow = new Date(Date.UTC(cal.year, cal.month - 1, cal.day)).getUTCDay(); // 0=Sun
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const mondayStart = utcMidnight(cal.year, cal.month, cal.day + daysToMonday, tz);
  const monCal = calDate(mondayStart, tz);
  const key = `${monCal.year}-${String(monCal.month).padStart(2, "0")}-${String(monCal.day).padStart(2, "0")}`;
  return { key, startDate: mondayStart, label: `Wk ${key}` };
}

function enumerateBuckets(range: ReportRange, granularity: Granularity, tz: string): { key: string; startDate: Date; label: string }[] {
  const out: { key: string; startDate: Date; label: string }[] = [];
  const seen = new Set<string>();
  let cursor = new Date(range.from.getTime());
  while (cursor.getTime() < range.to.getTime()) {
    const b = bucketKey(cursor, granularity, tz);
    if (!seen.has(b.key)) {
      out.push(b);
      seen.add(b.key);
    }
    // advance by one day
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

export async function getRevenueReport(
  range: ReportRange,
  granularity: Granularity,
  tz: string
): Promise<RevenueBucket[]> {
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: range.from, lt: range.to } },
      select: { amountCents: true, paidAt: true }
    }),
    prisma.refund.findMany({
      where: { refundedAt: { gte: range.from, lt: range.to } },
      select: { amountCents: true, refundedAt: true }
    })
  ]);

  const buckets = enumerateBuckets(range, granularity, tz);
  const paymentsByKey = new Map<string, number>();
  const refundsByKey = new Map<string, number>();

  for (const p of payments) {
    const key = bucketKey(p.paidAt, granularity, tz).key;
    paymentsByKey.set(key, (paymentsByKey.get(key) ?? 0) + p.amountCents);
  }
  for (const r of refunds) {
    const key = bucketKey(r.refundedAt, granularity, tz).key;
    refundsByKey.set(key, (refundsByKey.get(key) ?? 0) + r.amountCents);
  }

  return buckets.map((b) => {
    const pay = paymentsByKey.get(b.key) ?? 0;
    const ref = refundsByKey.get(b.key) ?? 0;
    return {
      label: b.label,
      startDate: b.startDate,
      paymentsCents: pay,
      refundsCents: ref,
      netCents: pay - ref
    };
  });
}

// ────────────────────────────────────────────────────────────────
// 2. Aging (snapshot)
// ────────────────────────────────────────────────────────────────

export interface AgingBucket {
  bucket: "Not yet due" | "1-30 days" | "31-60 days" | "61-90 days" | "90+ days";
  invoiceCount: number;
  balanceCents: number;
}

export async function getAgingReport(now: Date = new Date()): Promise<AgingBucket[]> {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["UNPAID", "PARTIAL"] } },
    select: { balanceCents: true, dueAt: true }
  });

  const buckets: Record<AgingBucket["bucket"], { count: number; total: number }> = {
    "Not yet due": { count: 0, total: 0 },
    "1-30 days": { count: 0, total: 0 },
    "31-60 days": { count: 0, total: 0 },
    "61-90 days": { count: 0, total: 0 },
    "90+ days": { count: 0, total: 0 }
  };

  for (const inv of invoices) {
    const ageMs = inv.dueAt ? now.getTime() - inv.dueAt.getTime() : -1;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    let key: AgingBucket["bucket"];
    if (ageDays < 1) key = "Not yet due";
    else if (ageDays <= 30) key = "1-30 days";
    else if (ageDays <= 60) key = "31-60 days";
    else if (ageDays <= 90) key = "61-90 days";
    else key = "90+ days";
    buckets[key].count += 1;
    buckets[key].total += inv.balanceCents;
  }

  return (Object.keys(buckets) as AgingBucket["bucket"][]).map((k) => ({
    bucket: k,
    invoiceCount: buckets[k].count,
    balanceCents: buckets[k].total
  }));
}

// ────────────────────────────────────────────────────────────────
// 3. Payment methods
// ────────────────────────────────────────────────────────────────

export interface PaymentMethodRow {
  method: PaymentMethod;
  count: number;
  amountCents: number;
  percentOfTotal: number;
}

export async function getPaymentMethodsReport(range: ReportRange): Promise<PaymentMethodRow[]> {
  const rows = await prisma.payment.groupBy({
    by: ["method"],
    where: { paidAt: { gte: range.from, lt: range.to } },
    _sum: { amountCents: true },
    _count: { _all: true }
  });
  const totalAmount = rows.reduce((s, r) => s + (r._sum.amountCents ?? 0), 0);
  return rows
    .map((r) => ({
      method: r.method,
      count: r._count._all,
      amountCents: r._sum.amountCents ?? 0,
      percentOfTotal: totalAmount === 0 ? 0 : ((r._sum.amountCents ?? 0) / totalAmount) * 100
    }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

// ────────────────────────────────────────────────────────────────
// 4. Taxes
// ────────────────────────────────────────────────────────────────

export interface TaxRateRow {
  taxRateId: string;
  name: string;
  ratePercent: string;
  taxableBaseCents: number;
  taxCents: number;
}

export async function getTaxesReport(range: ReportRange): Promise<TaxRateRow[]> {
  // Invoices with at least one payment in the range and status PAID or PARTIAL.
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["PAID", "PARTIAL"] },
      payments: { some: { paidAt: { gte: range.from, lt: range.to } } }
    },
    select: {
      id: true,
      taxCents: true,
      subtotalCents: true,
      discountCents: true,
      totalCents: true,
      paidCents: true,
      status: true,
      lines: { include: { taxRate: true } },
      payments: {
        where: { paidAt: { gte: range.from, lt: range.to } },
        select: { amountCents: true }
      }
    }
  });

  const byRate = new Map<string, TaxRateRow>();

  for (const inv of invoices) {
    // Determine the fraction of this invoice's totals attributable to the range.
    // PAID invoices with any payment in range → 100%.
    // PARTIAL invoices → proportional to (in-range payments / totalCents).
    const inRangePaid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
    const fraction =
      inv.status === "PAID" ? 1 : inv.totalCents === 0 ? 0 : inRangePaid / inv.totalCents;

    for (const line of inv.lines) {
      if (!line.taxRate) continue;
      const rateStr = line.taxRate.ratePercent.toString();
      const rate = Number(rateStr) / 100;
      const attributedLineTotal = line.lineTotalCents * fraction;
      const attributedTax = attributedLineTotal * rate;
      const key = line.taxRate.id;
      const prev = byRate.get(key) ?? {
        taxRateId: line.taxRate.id,
        name: line.taxRate.name,
        ratePercent: rateStr,
        taxableBaseCents: 0,
        taxCents: 0
      };
      prev.taxableBaseCents += Math.round(attributedLineTotal);
      prev.taxCents += Math.round(attributedTax);
      byRate.set(key, prev);
    }
  }

  return Array.from(byRate.values()).sort((a, b) => b.taxCents - a.taxCents);
}

// ────────────────────────────────────────────────────────────────
// 5. Discounts
// ────────────────────────────────────────────────────────────────

export interface DiscountRow {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  issuedAt: Date;
  invoiceDiscountCents: number;
  lineDiscountCents: number;
  totalDiscountCents: number;
}

export async function getDiscountsReport(range: ReportRange): Promise<DiscountRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["PAID", "PARTIAL", "REFUNDED"] },
      payments: { some: { paidAt: { gte: range.from, lt: range.to } } }
    },
    include: {
      customer: true,
      lines: true
    },
    orderBy: { issuedAt: "desc" }
  });

  return invoices
    .map((inv) => {
      const lineDisc = inv.lines.reduce((s, l) => {
        if (l.discountType === "NONE") return s;
        if (l.discountType === "FIXED") {
          return s + Math.min(Number(l.discountValue), l.unitPriceCents * Number(l.quantity));
        }
        // PERCENT
        const gross = l.unitPriceCents * Number(l.quantity);
        return s + Math.round(gross * (Number(l.discountValue) / 100));
      }, 0);
      const invDisc = inv.discountCents;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer.name,
        issuedAt: inv.issuedAt,
        invoiceDiscountCents: invDisc,
        lineDiscountCents: lineDisc,
        totalDiscountCents: invDisc + lineDisc
      };
    })
    .filter((row) => row.totalDiscountCents > 0);
}

// ────────────────────────────────────────────────────────────────
// 6. Refunds
// ────────────────────────────────────────────────────────────────

export interface RefundRow {
  refundedAt: Date;
  invoiceNumber: string;
  customerName: string;
  amountCents: number;
  reason: string;
  staffName: string;
}

export async function getRefundsReport(range: ReportRange): Promise<RefundRow[]> {
  const refunds = await prisma.refund.findMany({
    where: { refundedAt: { gte: range.from, lt: range.to } },
    include: {
      invoice: { include: { customer: true } },
      staff: { select: { name: true } }
    },
    orderBy: { refundedAt: "desc" }
  });
  return refunds.map((r) => ({
    refundedAt: r.refundedAt,
    invoiceNumber: r.invoice.invoiceNumber,
    customerName: r.invoice.customer.name,
    amountCents: r.amountCents,
    reason: r.reason,
    staffName: r.staff.name
  }));
}

// ────────────────────────────────────────────────────────────────
// 7. Top items
// ────────────────────────────────────────────────────────────────

export interface TopItemRow {
  catalogItemId: string | null;
  itemName: string;
  sku: string | null;
  qtySold: string;
  revenueCents: number;
}

export async function getTopItemsReport(range: ReportRange, limit: number = 20): Promise<TopItemRow[]> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        status: { in: ["PAID", "PARTIAL", "REFUNDED"] },
        payments: { some: { paidAt: { gte: range.from, lt: range.to } } }
      }
    },
    include: { catalogItem: true }
  });

  const byItem = new Map<string, { name: string; sku: string | null; qty: number; revenue: number; id: string | null }>();
  for (const l of lines) {
    const key = l.catalogItemId ?? "__uncategorized__";
    const name = l.catalogItem?.name ?? l.description;
    const sku = l.catalogItem?.sku ?? null;
    const prev = byItem.get(key) ?? { name, sku, qty: 0, revenue: 0, id: l.catalogItemId };
    prev.qty += Number(l.quantity);
    prev.revenue += l.lineTotalCents;
    byItem.set(key, prev);
  }

  return Array.from(byItem.values())
    .map((v) => ({
      catalogItemId: v.id,
      itemName: v.name,
      sku: v.sku,
      qtySold: v.qty.toString(),
      revenueCents: v.revenue
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, limit);
}
