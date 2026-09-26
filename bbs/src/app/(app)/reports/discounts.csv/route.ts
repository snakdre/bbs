import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getDiscountsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getDiscountsReport(ctx.range);
  const csv = toCsv(
    ["Invoice number", "Customer", "Issued", "Invoice discount", "Line discounts", "Total discount"],
    rows.map((r) => [
      r.invoiceNumber,
      r.customerName,
      r.issuedAt.toISOString().slice(0, 10),
      fromCents(r.invoiceDiscountCents),
      fromCents(r.lineDiscountCents),
      fromCents(r.totalDiscountCents)
    ])
  );
  return csvResponse("discounts", ctx, csv);
}
