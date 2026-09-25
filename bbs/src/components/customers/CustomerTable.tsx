import Link from "next/link";
import type { Customer } from "@prisma/client";

export function CustomerTable({ customers }: { customers: Customer[] }) {
  if (customers.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted">
        No customers yet.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-raised text-muted uppercase text-xs">
          <tr>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">Company</th>
            <th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Phone</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-surface-raised">
              <td className="px-4 py-3">
                <Link href={`/customers/${c.id}`} className="text-gold hover:underline">
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-text">{c.company ?? "—"}</td>
              <td className="px-4 py-3 text-text">{c.email ?? "—"}</td>
              <td className="px-4 py-3 text-text">{c.phone ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
