import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  const name = session?.user.name ?? "there";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Dashboard</h1>
        <p className="text-sm text-muted mt-1">Welcome back, {name}.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {["Today's Revenue", "Outstanding", "Completed", "Overdue"].map((label) => (
          <div
            key={label}
            className="bg-surface border border-border rounded-lg p-5"
          >
            <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-gold tabular">$0.00</div>
          </div>
        ))}
      </div>
      <div className="mt-8 bg-surface border border-border rounded-lg p-8 text-center">
        <div className="text-muted">
          No invoices yet — the Create Bill workflow will appear in Phase 2.
        </div>
      </div>
    </div>
  );
}
