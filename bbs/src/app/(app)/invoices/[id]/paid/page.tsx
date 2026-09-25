import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";
import { Button } from "@/components/ui/Button";

export default async function PaidPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { receipt?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  if (searchParams.receipt !== "1") {
    redirect(`/invoices/${params.id}`);
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      payments: {
        orderBy: { paidAt: "desc" },
        take: 1
      }
    }
  });
  if (!invoice || invoice.status !== "PAID") {
    redirect(`/invoices/${params.id}`);
  }

  const lastPayment = invoice.payments[0];
  const changeMatch = lastPayment?.note?.match(/change \$([\d.]+)/i);
  const changeText = changeMatch ? ` · $${changeMatch[1]} change due` : "";

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="mx-auto w-18 h-18 rounded-full bg-success flex items-center justify-center" style={{ width: 72, height: 72 }}>
          <div className="text-text text-4xl leading-none">✓</div>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Payment received</h1>
          <p className="text-xs text-muted font-mono mt-1">
            {invoice.invoiceNumber} · {invoice.customer.name}
          </p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">Total paid</div>
          <div className="text-3xl font-bold text-gold tabular">
            {formatUSD(invoice.totalCents)}
          </div>
          {lastPayment && (
            <div className="text-xs text-muted mt-2">
              {lastPayment.method}
              {changeText}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Link
            href={`/invoices/${invoice.id}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1"
          >
            <Button className="w-full">Print receipt</Button>
          </Link>
          <Link
            href={`/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1"
          >
            <Button variant="secondary" className="w-full">
              Download PDF
            </Button>
          </Link>
        </div>
        <Link href="/bills/new" className="block">
          <Button variant="ghost" className="w-full">
            + New bill
          </Button>
        </Link>

        <Link
          href={`/invoices/${invoice.id}`}
          className="block text-xs text-muted hover:text-text underline"
        >
          View invoice
        </Link>
      </div>
    </div>
  );
}
