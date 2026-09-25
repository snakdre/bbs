"use client";

import { Combobox } from "@/components/ui/Combobox";
import { searchCatalog } from "@/actions/catalog";
import { fromCents } from "@/lib/money";

export interface CatalogPick {
  id: string;
  name: string;
  unitPrice: string;
  taxRateId: string | null;
}

interface Props {
  onPick: (item: CatalogPick) => void;
}

export function CatalogPicker({ onPick }: Props) {
  async function search(q: string) {
    const results = await searchCatalog(q);
    return results.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: `${r.sku ?? "—"} · $${fromCents(r.unitPriceCents)}`,
      name: r.name,
      unitPrice: fromCents(r.unitPriceCents),
      taxRateId: r.taxRateId
    }));
  }

  return (
    <Combobox
      label="Add from catalog"
      placeholder="Search catalog…"
      value={null}
      onSelect={(item) => {
        if (item) {
          onPick({
            id: item.id,
            name: item.label,
            unitPrice: (item as unknown as { unitPrice: string }).unitPrice,
            taxRateId: (item as unknown as { taxRateId: string | null }).taxRateId
          });
        }
      }}
      onSearch={search}
    />
  );
}
