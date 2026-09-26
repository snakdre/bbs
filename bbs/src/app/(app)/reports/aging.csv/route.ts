import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getAgingReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getAgingReport(new Date());
  const csv = toCsv(
    ["Aging bucket", "Invoice count", "Balance"],
    rows.map((r) => [r.bucket, r.invoiceCount.toString(), fromCents(r.balanceCents)])
  );
  return csvResponse("aging", ctx, csv);
}
