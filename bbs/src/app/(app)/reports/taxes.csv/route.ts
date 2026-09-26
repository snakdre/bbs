import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getTaxesReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getTaxesReport(ctx.range);
  const csv = toCsv(
    ["Tax rate", "Rate percent", "Taxable base", "Tax collected"],
    rows.map((r) => [
      r.name,
      r.ratePercent,
      fromCents(r.taxableBaseCents),
      fromCents(r.taxCents)
    ])
  );
  return csvResponse("taxes", ctx, csv);
}
