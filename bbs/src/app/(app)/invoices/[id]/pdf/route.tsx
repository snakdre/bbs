import { renderToStream } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { InvoicePdfA4 } from "@/lib/pdf/InvoicePdfA4";
import { buildPdfProps } from "@/lib/pdf/build-props";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        lines: { include: { taxRate: true } },
        payments: { orderBy: { paidAt: "asc" }, include: { refunds: true } }
      }
    }),
    prisma.businessSettings.findUnique({ where: { id: 1 } })
  ]);

  if (!invoice || !settings) {
    return new NextResponse("Not found", { status: 404 });
  }

  const props = buildPdfProps(invoice, settings);
  const stream = await renderToStream(<InvoicePdfA4 {...props} />);

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store"
    }
  });
}
