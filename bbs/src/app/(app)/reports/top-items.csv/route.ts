import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getTopItemsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getTopItemsReport(ctx.range, 20);
  const csv = toCsv(
    ["Item", "SKU", "Quantity sold", "Revenue"],
    rows.map((r) => [
      r.itemName,
      r.sku ?? "",
      r.qtySold,
      fromCents(r.revenueCents)
    ])
  );
  return csvResponse("top-items", ctx, csv);
}
