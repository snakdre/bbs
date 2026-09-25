"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { toCents } from "@/lib/money";
import { createDraftBillSchema } from "@/schemas/bill";
import { computeInvoiceTotals } from "@/lib/billing";
import type { DiscountInput, LineInput } from "@/lib/billing-types";
import { reserveInvoiceNumber } from "@/lib/invoice-number";

function normalizeDiscount(d: { kind: "PERCENT" | "FIXED" | "NONE"; value: string }): DiscountInput {
  if (d.kind === "NONE") return { kind: "NONE", value: 0 };
  if (d.kind === "PERCENT") {
    const n = Number(d.value);
    if (!Number.isFinite(n) || n < 0) throw new Error("Invalid percent discount");
    return { kind: "PERCENT", value: n };
  }
  return { kind: "FIXED", value: toCents(d.value) };
}

export async function createDraftBill(raw: unknown) {
  const user = await requireRole(Role.ADMIN, Role.STAFF);
  const input = createDraftBillSchema.parse(raw);

  const taxRateIds = Array.from(
    new Set(input.lines.map((l) => l.taxRateId).filter((id): id is string => !!id))
  );
  const taxRates = taxRateIds.length
    ? await prisma.taxRate.findMany({ where: { id: { in: taxRateIds } } })
    : [];
  const taxPercentById = new Map(taxRates.map((r) => [r.id, Number(r.ratePercent)]));

  const engineLines: LineInput[] = input.lines.map((l) => ({
    unitPriceCents: toCents(l.unitPrice),
    quantity: Number(l.quantity),
    discount: normalizeDiscount(l.discount),
    taxRatePercent: l.taxRateId ? taxPercentById.get(l.taxRateId) ?? 0 : 0
  }));
  const totals = computeInvoiceTotals(engineLines, normalizeDiscount(input.invoiceDiscount));

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await reserveInvoiceNumber(tx);

    return tx.invoice.create({
      data: {
        invoiceNumber,
        customerId: input.customerId,
        issuedAt: new Date(),
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        status: "DRAFT",
        subtotalCents: totals.subtotalCents,
        discountCents: totals.invoiceDiscountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        paidCents: 0,
        balanceCents: totals.totalCents,
        currency: "USD",
        notes: input.notes,
        createdById: user.id,
        lines: {
          create: input.lines.map((l, idx) => {
            const totalsForLine = totals.lines[idx];
            const d = normalizeDiscount(l.discount);
            return {
              catalogItemId: l.catalogItemId,
              description: l.description,
              quantity: Number(l.quantity),
              unitPriceCents: toCents(l.unitPrice),
              discountType: d.kind,
              discountValue:
                d.kind === "PERCENT"
                  ? d.value
                  : d.kind === "FIXED"
                  ? d.value
                  : 0,
              taxRateId: l.taxRateId,
              lineTotalCents: totalsForLine.lineTotalCents
            };
          })
        }
      },
      include: { lines: true }
    });
  });

  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  return { ok: true as const, invoice };
}
