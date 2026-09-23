import Link from "next/link";
import { SignOutButton } from "./SignOutButton";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/bills/new", label: "Create Bill", primary: true },
  { href: "/invoices", label: "Invoices" },
  { href: "/customers", label: "Customers" },
  { href: "/catalog", label: "Catalog" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" }
];

export function Sidebar({ userName }: { userName: string }) {
  return (
    <aside className="hidden md:flex md:flex-col w-60 min-h-screen bg-surface border-r border-border">
      <div className="px-6 py-6 border-b border-border">
        <div className="text-gold font-semibold">Brice Beauty Supply</div>
        <div className="text-xs text-muted mt-1">{userName}</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "block px-3 py-2 rounded text-sm transition-colors",
              item.primary
                ? "bg-gold text-bg hover:bg-gold-hover font-medium"
                : "text-text hover:bg-surface-raised"
            ].join(" ")}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-border">
        <SignOutButton />
      </div>
    </aside>
  );
}
