import type { InvoiceStatus } from "@prisma/client";

export function deriveDisplayStatus(
  invoice: { status: InvoiceStatus; dueAt: Date | null },
  now: Date = new Date()
): InvoiceStatus {
  if (invoice.status !== "UNPAID" && invoice.status !== "PARTIAL") {
    return invoice.status;
  }
  if (invoice.dueAt && invoice.dueAt < now) {
    return "OVERDUE";
  }
  return invoice.status;
}
