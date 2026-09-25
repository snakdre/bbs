import type { Invoice, Customer, InvoiceLine, TaxRate, Payment, Refund, BusinessSettings } from "@prisma/client";
import { formatUSD, fromCents } from "@/lib/money";
import { deriveDisplayStatus } from "@/lib/status";
import type { PdfInvoiceProps } from "./types";

type FullInvoice = Invoice & {
  customer: Customer;
  lines: (InvoiceLine & { taxRate: TaxRate | null })[];
  payments: (Payment & { refunds: Refund[] })[];
};

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildPdfProps(
  invoice: FullInvoice,
  settings: BusinessSettings
): PdfInvoiceProps {
  const status = deriveDisplayStatus({
    status: invoice.status,
    dueAt: invoice.dueAt
  });

  const lines = invoice.lines.map((l) => {
    const discountNote =
      l.discountType === "PERCENT" && Number(l.discountValue) > 0
        ? ` (${l.discountValue}% off)`
        : l.discountType === "FIXED" && Number(l.discountValue) > 0
        ? ` (-${formatUSD(Number(l.discountValue))})`
        : "";
    return {
      description: `${l.description}${discountNote}`,
      quantityLabel: l.quantity.toString(),
      unitLabel: `$${fromCents(l.unitPriceCents)}`,
      totalLabel: formatUSD(l.lineTotalCents)
    };
  });

  const payments = invoice.payments.map((p) => {
    const tenderMatch = p.note?.match(/Tendered \$([\d.]+), change \$([\d.]+)/);
    const tenderNote = tenderMatch
      ? `Tendered $${tenderMatch[1]}, change $${tenderMatch[2]}`
      : null;
    return {
      amountLabel: formatUSD(p.amountCents),
      method: p.method,
      dateLabel: fmtDate(p.paidAt),
      tenderNote
    };
  });

  return {
    business: {
      name: settings.name,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      taxId: settings.taxId,
      defaultPaymentTerms: settings.defaultPaymentTerms,
      footer: settings.footer
    },
    customer: {
      name: invoice.customer.name,
      email: invoice.customer.email,
      billingAddress: invoice.customer.billingAddress
    },
    invoiceNumber: invoice.invoiceNumber,
    issuedDate: fmtDate(invoice.issuedAt),
    dueDate: invoice.dueAt ? fmtDate(invoice.dueAt) : null,
    status,
    lines,
    subtotalLabel: formatUSD(invoice.subtotalCents),
    discountLabel: formatUSD(invoice.discountCents),
    taxLabel: formatUSD(invoice.taxCents),
    totalLabel: formatUSD(invoice.totalCents),
    balanceLabel: formatUSD(invoice.balanceCents),
    payments,
    paymentTerms: settings.defaultPaymentTerms,
    footer: settings.footer
  };
}
