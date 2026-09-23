import Link from "next/link";

const NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/bills/new", label: "New" },
  { href: "/invoices", label: "Invoices" },
  { href: "/settings", label: "Settings" }
];

export function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-border">
      <ul className="grid grid-cols-4">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center justify-center h-14 text-xs text-text hover:bg-surface-raised"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
