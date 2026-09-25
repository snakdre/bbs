import Link from "next/link";
import type { Invoice, Customer } from "@prisma/client";
import { formatUSD } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

type Row = Invoice & { customer: Customer };

export function InvoiceListTable({ invoices }: { invoices: Row[] }) {
  if (invoices.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
        No invoices yet — create your first bill.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-muted uppercase text-xs">
          <tr>
            <th className="text-left px-4 py-3">Number</th>
            <th className="text-left px-4 py-3">Customer</th>
            <th className="text-left px-4 py-3">Issued</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Total</th>
            <th className="text-right px-4 py-3">Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const status = deriveDisplayStatus({
              status: inv.status,
              dueAt: inv.dueAt
            });
            return (
              <tr key={inv.id} className="border-t border-border hover:bg-surface-raised">
                <td className="px-4 py-3">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="text-gold hover:underline font-mono"
                  >
                    {inv.invoiceNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text">{inv.customer.name}</td>
                <td className="px-4 py-3 text-text">
                  {inv.issuedAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3">
                  <InvoiceStatusBadge status={status} />
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {formatUSD(inv.totalCents)}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {formatUSD(inv.balanceCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
