import Link from "next/link";
import type { CatalogItem, TaxRate } from "@prisma/client";
import { formatUSD } from "@/lib/money";

type Item = CatalogItem & { taxRate: TaxRate | null };

export function CatalogTable({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
        No items yet.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-muted uppercase text-xs">
          <tr>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">SKU</th>
            <th className="text-right px-4 py-3">Price</th>
            <th className="text-left px-4 py-3">Tax rate</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-surface-raised">
              <td className="px-4 py-3 text-text">{c.name}</td>
              <td className="px-4 py-3 text-muted font-mono">{c.sku ?? "—"}</td>
              <td className="px-4 py-3 text-right text-text tabular">
                {formatUSD(c.unitPriceCents)}
              </td>
              <td className="px-4 py-3 text-text">
                {c.taxRate ? `${c.taxRate.name}` : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/catalog/${c.id}/edit`} className="text-gold hover:underline">
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
