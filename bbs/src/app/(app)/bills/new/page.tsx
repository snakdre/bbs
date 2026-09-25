import { requireRole, Role } from "@/lib/permissions";
import { listTaxRates } from "@/actions/catalog";
import { BillBuilder } from "@/components/billing/BillBuilder";

export default async function NewBillPage() {
  await requireRole(Role.ADMIN, Role.STAFF);
  const rates = await listTaxRates();
  const defaultRate = rates.find((r) => r.isDefault) ?? rates[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Create bill</h1>
      <BillBuilder
        taxRates={rates.map((r) => ({
          id: r.id,
          name: r.name,
          ratePercent: r.ratePercent.toString()
        }))}
        defaultTaxRateId={defaultRate?.id ?? null}
      />
    </div>
  );
}
