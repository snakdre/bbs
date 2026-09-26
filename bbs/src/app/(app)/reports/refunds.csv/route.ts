import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getRefundsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getRefundsReport(ctx.range);
  const csv = toCsv(
    ["Date", "Invoice number", "Customer", "Amount", "Reason", "Staff"],
    rows.map((r) => [
      r.refundedAt.toISOString().slice(0, 10),
      r.invoiceNumber,
      r.customerName,
      fromCents(r.amountCents),
      r.reason,
      r.staffName
    ])
  );
  return csvResponse("refunds", ctx, csv);
}
