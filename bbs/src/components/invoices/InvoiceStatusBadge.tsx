import type { InvoiceStatus } from "@prisma/client";

const styles: Record<InvoiceStatus, string> = {
  DRAFT: "bg-muted/20 text-muted",
  UNPAID: "bg-warning/20 text-warning-bright",
  PARTIAL: "bg-gold/20 text-gold",
  PAID: "bg-success/20 text-success-bright",
  OVERDUE: "bg-danger/20 text-danger-bright",
  VOID: "bg-muted/20 text-muted",
  REFUNDED: "bg-danger/20 text-danger-bright"
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
