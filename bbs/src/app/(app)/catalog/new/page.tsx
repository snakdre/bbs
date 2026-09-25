import { requireRole, Role } from "@/lib/permissions";
import { listTaxRates } from "@/actions/catalog";
import { CatalogItemForm } from "@/components/catalog/CatalogItemForm";

export default async function NewCatalogItemPage() {
  await requireRole(Role.ADMIN, Role.STAFF);
  const rates = await listTaxRates();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">New catalog item</h1>
      <CatalogItemForm
        mode="create"
        taxRates={rates.map((r) => ({
          id: r.id,
          name: r.name,
          ratePercent: r.ratePercent.toString()
        }))}
      />
    </div>
  );
}
