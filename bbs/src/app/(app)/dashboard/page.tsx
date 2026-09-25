import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";

export default async function DashboardPage() {
  const user = await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [todaysPaid, outstandingAgg, completedCount, overdueCount] = await Promise.all([
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
    })
  ]);

  const kpis = [
    { label: "Today's Revenue", value: formatUSD(todaysPaid._sum.amountCents ?? 0) },
    { label: "Outstanding", value: formatUSD(outstandingAgg._sum.balanceCents ?? 0) },
    { label: "Completed", value: String(completedCount) },
    { label: "Overdue", value: String(overdueCount) }
  ];

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
    </div>
  );
}
