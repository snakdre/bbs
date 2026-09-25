import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { listTaxRates } from "@/actions/catalog";
import { fromCents } from "@/lib/money";
import { CatalogItemForm } from "@/components/catalog/CatalogItemForm";

export default async function EditCatalogItemPage({
  params
}: {
  params: { id: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const item = await prisma.catalogItem.findUnique({ where: { id: params.id } });
  if (!item) notFound();
  const rates = await listTaxRates();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Edit catalog item</h1>
      <CatalogItemForm
        mode="edit"
        id={item.id}
        initial={{
          name: item.name,
          description: item.description ?? "",
          sku: item.sku ?? "",
          unitPrice: fromCents(item.unitPriceCents),
          taxRateId: item.taxRateId ?? "",
          active: item.active
        }}
        taxRates={rates.map((r) => ({
          id: r.id,
          name: r.name,
          ratePercent: r.ratePercent.toString()
        }))}
      />
    </div>
  );
}
