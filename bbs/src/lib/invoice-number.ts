import type { Prisma } from "@prisma/client";

/**
 * Reserve the next invoice number using SELECT ... FOR UPDATE on BusinessSettings.
 * MUST be called inside a Prisma $transaction so the row lock is released
 * atomically with the caller's other writes.
 *
 * Format: {prefix}-{YYYY}-{seq:04}, e.g. BBS-2026-0001.
 */
export async function reserveInvoiceNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date()
): Promise<string> {
  const rows = await tx.$queryRaw<
    { id: number; invoicePrefix: string; nextInvoiceSeq: number }[]
  >`SELECT id, "invoicePrefix", "nextInvoiceSeq" FROM "BusinessSettings" WHERE id = 1 FOR UPDATE`;

  if (rows.length === 0) {
    throw new Error("BusinessSettings row (id=1) not found — seed the database first");
  }
  const row = rows[0];
  const seq = row.nextInvoiceSeq;
  const year = now.getUTCFullYear();
  const number = `${row.invoicePrefix}-${year}-${seq.toString().padStart(4, "0")}`;

  await tx.businessSettings.update({
    where: { id: 1 },
    data: { nextInvoiceSeq: seq + 1 }
  });

  return number;
}
