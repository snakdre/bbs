import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { CustomerTable } from "@/components/customers/CustomerTable";

export default async function CustomersPage({
  searchParams
}: {
  searchParams: { q?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const q = searchParams.q?.trim() ?? "";
  const customers = await prisma.customer.findMany({
    where: {
      archived: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: { name: "asc" },
    take: 100
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted mt-1">{customers.length} shown</p>
        </div>
        <Link href="/customers/new">
          <Button>New customer</Button>
        </Link>
      </div>
      <form className="mb-4" action="/customers" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, email, company…"
          className="w-full max-w-md h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </form>
      <CustomerTable customers={customers} />
    </div>
  );
}
