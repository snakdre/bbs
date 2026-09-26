import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { resolveRange, type ResolvedRange } from "@/lib/timezone";
import { toCsv } from "@/lib/csv";
import { fromCents } from "@/lib/money";

export interface CsvRouteContext {
  range: ResolvedRange;
  tz: string;
  granularity: "daily" | "weekly" | "monthly";
  searchParams: URLSearchParams;
}

export async function loadCsvContext(request: Request): Promise<
  { ok: true; ctx: CsvRouteContext } | { ok: false; response: NextResponse }
> {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const url = new URL(request.url);
  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone ?? "America/New_York";

  const params = {
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined
  };
  const resolved = resolveRange(params, tz);
  if ("error" in resolved) {
    return { ok: false, response: new NextResponse("Invalid date range", { status: 400 }) };
  }

  const rawGran = url.searchParams.get("granularity");
  const granularity: "daily" | "weekly" | "monthly" =
    rawGran === "weekly" || rawGran === "monthly" ? rawGran : "daily";

  return { ok: true, ctx: { range: resolved, tz, granularity, searchParams: url.searchParams } };
}

export function csvResponse(reportName: string, ctx: CsvRouteContext, csv: string): NextResponse {
  const fromStr = ctx.range.from.toISOString().slice(0, 10);
  const toStr = new Date(ctx.range.to.getTime() - 1).toISOString().slice(0, 10);
  const filename = `bbs-${reportName}-${fromStr}_to_${toStr}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store"
    }
  });
}

export { toCsv, fromCents };
