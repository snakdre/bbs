import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD, fromCents } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
import { InvoiceStatusBadge } from "@/components/invoices/InvoiceStatusBadge";
import { InvoiceActionBar } from "@/components/invoices/InvoiceActionBar";
import { PaymentsSection } from "@/components/invoices/PaymentsSection";

export default async function InvoiceDetailPage({
  params
}: {
  params: { id: string };
}) {
  const user = await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      lines: { include: { taxRate: true } },
      payments: {
        orderBy: { paidAt: "asc" },
        include: {
          staff: { select: { name: true } },
          refunds: {
            orderBy: { refundedAt: "asc" },
            include: { staff: { select: { name: true } } }
          }
        }
      }
    }
  });
  if (!invoice) notFound();

  const displayStatus = deriveDisplayStatus({
    status: invoice.status,
    dueAt: invoice.dueAt
  });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-mono text-gold">
              {invoice.invoiceNumber}
            </h1>
            <InvoiceStatusBadge status={displayStatus} />
          </div>
          <p className="text-sm text-muted mt-1">
            Issued {invoice.issuedAt.toISOString().slice(0, 10)}
            {invoice.dueAt
              ? ` · Due ${invoice.dueAt.toISOString().slice(0, 10)}`
              : ""}
          </p>
        </div>
        <Link href="/invoices" className="text-sm text-muted hover:text-text">
          ← All invoices
        </Link>
      </div>

      <div className="mb-6">
        <InvoiceActionBar
          invoice={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            balanceCents: invoice.balanceCents,
            hasPayments: invoice.payments.length > 0
          }}
          role={user.role}
        />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-sm uppercase text-muted tracking-wide mb-2">Payments</h2>
          <PaymentsSection
            role={user.role}
            payments={invoice.payments.map((p) => ({
              id: p.id,
              amountCents: p.amountCents,
              method: p.method,
              paidAt: p.paidAt,
              referenceNumber: p.referenceNumber,
              staffName: p.staff.name,
              note: p.note,
              refunds: p.refunds.map((r) => ({
                id: r.id,
                amountCents: r.amountCents,
                reason: r.reason,
                refundedAt: r.refundedAt,
                staffName: r.staff.name
              }))
            }))}
          />
        </div>
        <div className="bg-surface border border-border rounded-lg p-5 space-y-2 self-start">
          <Row label="Subtotal" value={formatUSD(invoice.subtotalCents)} />
          <Row label="Discount" value={`-${formatUSD(invoice.discountCents)}`} />
          <Row label="Tax" value={formatUSD(invoice.taxCents)} />
          <div className="border-t border-border pt-2">
            <Row label="Total" value={formatUSD(invoice.totalCents)} strong />
          </div>
          <div className="pt-2 border-t border-border">
            <Row label="Paid" value={formatUSD(invoice.paidCents)} />
            <Row label="Balance" value={formatUSD(invoice.balanceCents)} strong />
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="bg-surface border border-border rounded-lg p-5">
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
      <span
        className={
          "tabular " + (strong ? "text-gold font-semibold text-lg" : "text-text")
        }
      >
        {value}
      </span>
    </div>
  );
}
