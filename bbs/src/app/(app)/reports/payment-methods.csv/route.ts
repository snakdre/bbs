import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getPaymentMethodsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getPaymentMethodsReport(ctx.range);
  const csv = toCsv(
    ["Method", "Count", "Amount", "Percent of total"],
    rows.map((r) => [
      r.method,
      r.count.toString(),
      fromCents(r.amountCents),
      r.percentOfTotal.toFixed(2)
    ])
  );
  return csvResponse("payment-methods", ctx, csv);
}
