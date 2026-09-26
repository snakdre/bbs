import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getRevenueReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getRevenueReport(ctx.range, ctx.granularity, ctx.tz);
  const csv = toCsv(
    ["Date", "Payments", "Refunds", "Net"],
    rows.map((r) => [
      r.label,
      fromCents(r.paymentsCents),
      fromCents(r.refundsCents),
      fromCents(r.netCents)
    ])
  );
  return csvResponse("revenue", ctx, csv);
}
