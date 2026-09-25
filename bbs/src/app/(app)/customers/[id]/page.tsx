import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { formatUSD } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
import { InvoiceStatusBadge } from "@/components/invoices/InvoiceStatusBadge";

export default async function CustomerDetailPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      invoices: {
        orderBy: { issuedAt: "desc" },
        take: 50
      }
    }
  });
  if (!customer) notFound();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
          {customer.company && (
            <p className="text-sm text-muted mt-1">{customer.company}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/customers/${customer.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-surface border border-border rounded-lg p-5 space-y-2">
          <div className="text-xs text-muted uppercase tracking-wide">Contact</div>
          <div className="text-text">{customer.email ?? "—"}</div>
          <div className="text-text">{customer.phone ?? "—"}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-5 space-y-2">
          <div className="text-xs text-muted uppercase tracking-wide">Billing</div>
          <div className="text-text whitespace-pre-line">
            {customer.billingAddress ?? "—"}
          </div>
          <div className="text-text">Tax ID: {customer.taxId ?? "—"}</div>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-3">Invoice history</h2>
      {customer.invoices.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
          No invoices yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-muted uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Number</th>
                <th className="text-left px-4 py-3">Issued</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody>
              {customer.invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-border hover:bg-surface-raised">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="text-gold hover:underline font-mono">
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text">
                    {inv.issuedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-text">
                    <InvoiceStatusBadge
                      status={deriveDisplayStatus({
                        status: inv.status,
                        dueAt: inv.dueAt
                      })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-text tabular">
                    {formatUSD(inv.totalCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-text tabular">
                    {formatUSD(inv.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
