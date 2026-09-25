import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD, fromCents } from "@/lib/money";
import { InvoiceStatusBadge } from "@/components/invoices/InvoiceStatusBadge";

export default async function InvoiceDetailPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      lines: { include: { taxRate: true } }
    }
  });
  if (!invoice) notFound();

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-mono text-gold">
              {invoice.invoiceNumber}
            </h1>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-muted mt-1">
            Issued {invoice.issuedAt.toISOString().slice(0, 10)}
            {invoice.dueAt ? ` · Due ${invoice.dueAt.toISOString().slice(0, 10)}` : ""}
          </p>
        </div>
        <Link href="/invoices" className="text-sm text-muted hover:text-text">
          ← All invoices
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5 mb-6">
        <div className="text-xs uppercase text-muted tracking-wide mb-2">Bill to</div>
        <div className="text-text font-medium">{invoice.customer.name}</div>
        {invoice.customer.email && (
          <div className="text-sm text-muted">{invoice.customer.email}</div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-muted uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-right px-4 py-3">Qty</th>
              <th className="text-right px-4 py-3">Unit</th>
              <th className="text-right px-4 py-3">Line total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-4 py-3 text-text">
                  {l.description}
                  {l.taxRate && (
                    <div className="text-xs text-muted">Tax: {l.taxRate.name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {l.quantity.toString()}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  ${fromCents(l.unitPriceCents)}
                </td>
                <td className="px-4 py-3 text-right text-text tabular">
                  {formatUSD(l.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5 max-w-sm ml-auto space-y-2">
        <Row label="Subtotal" value={formatUSD(invoice.subtotalCents)} />
        <Row label="Discount" value={`-${formatUSD(invoice.discountCents)}`} />
        <Row label="Tax" value={formatUSD(invoice.taxCents)} />
        <div className="border-t border-border pt-2">
          <Row label="Total" value={formatUSD(invoice.totalCents)} strong />
        </div>
      </div>

      {invoice.notes && (
        <div className="mt-6 bg-surface border border-border rounded-lg p-5">
          <div className="text-xs uppercase text-muted tracking-wide mb-2">Notes</div>
          <div className="text-text whitespace-pre-line">{invoice.notes}</div>
        </div>
      )}
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
