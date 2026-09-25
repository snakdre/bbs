import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { InvoiceListTable } from "@/components/invoices/InvoiceListTable";
import type { InvoiceStatus } from "@prisma/client";

const PAGE_SIZE = 25;

export default async function InvoicesPage({
  searchParams
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const status = (searchParams.status ?? "").toUpperCase() as InvoiceStatus | "";
  const q = searchParams.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.page ?? "1") | 0);

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" as const } },
            { customer: { name: { contains: q, mode: "insensitive" as const } } }
          ]
        }
      : {})
  };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { customer: true },
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE
    }),
    prisma.invoice.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted mt-1">
            {total} total · page {page} of {totalPages}
          </p>
        </div>
        <Link href="/bills/new">
          <Button>Create bill</Button>
        </Link>
      </div>

      <form className="mb-4 flex gap-2 flex-wrap" action="/invoices" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search invoice # or customer…"
          className="flex-1 min-w-[240px] h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <select
          name="status"
          defaultValue={status}
          className="h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="VOID">Void</option>
          <option value="REFUNDED">Refunded</option>
        </select>
      </form>

      <InvoiceListTable invoices={invoices} />

      {totalPages > 1 && (
        <nav className="mt-4 flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={{
                pathname: "/invoices",
                query: { ...(q ? { q } : {}), ...(status ? { status } : {}), page: p }
              }}
              className={
                "px-3 py-1 rounded border text-sm " +
                (p === page
                  ? "bg-gold text-bg border-gold"
                  : "border-border text-text hover:bg-surface-raised")
              }
            >
              {p}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
