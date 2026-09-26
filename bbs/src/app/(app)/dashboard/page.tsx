import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";
import { getRevenueReport } from "@/lib/reports";
import { RevenueChart } from "@/components/charts/RevenueChart";

export default async function DashboardPage() {
  const user = await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone ?? "America/New_York";

  // 30-day range for the chart, ending at now
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [todaysPaid, outstandingAgg, completedCount, overdueCount, chartData] =
    await Promise.all([
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
      }),
      getRevenueReport({ from: thirtyDaysAgo, to: now }, "daily", tz)
    ]);

  const kpis = [
    { label: "Today's Revenue", value: formatUSD(todaysPaid._sum.amountCents ?? 0) },
    { label: "Outstanding", value: formatUSD(outstandingAgg._sum.balanceCents ?? 0) },
    { label: "Completed", value: String(completedCount) },
    { label: "Overdue", value: String(overdueCount) }
  ];

  const totalChart = chartData.reduce((s, b) => s + b.netCents, 0);

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

      <div className="mt-6">
        <RevenueChart
          buckets={chartData.map((b) => ({ label: b.label, valueCents: b.netCents }))}
          variant="compact"
          totalLabel={formatUSD(totalChart)}
          rangeLabel="Last 30 days"
        />
        <div className="text-right mt-2">
          <Link href="/reports" className="text-xs text-muted hover:text-text underline">
            View full reports →
          </Link>
        </div>
      </div>
    </div>
  );
}
