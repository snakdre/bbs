import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { CatalogTable } from "@/components/catalog/CatalogTable";

export default async function CatalogPage({
  searchParams
}: {
  searchParams: { q?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const q = searchParams.q?.trim() ?? "";
  const items = await prisma.catalogItem.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: { taxRate: true },
    orderBy: { name: "asc" },
    take: 200
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="text-sm text-muted mt-1">{items.length} shown</p>
        </div>
        <Link href="/catalog/new">
          <Button>New item</Button>
        </Link>
      </div>
      <form className="mb-4" action="/catalog" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or SKU…"
          className="w-full max-w-md h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </form>
      <CatalogTable items={items} />
    </div>
  );
}
