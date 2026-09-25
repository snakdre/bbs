export interface PdfBusiness {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
  defaultPaymentTerms: string | null;
  footer: string | null;
}

export interface PdfCustomer {
  name: string;
  email: string | null;
  billingAddress: string | null;
}

export interface PdfLine {
  description: string;
  quantityLabel: string; // e.g. "1", "2.5", "3 × $8.99 (10% off)"
  unitLabel: string; // e.g. "$125.00"
  totalLabel: string; // e.g. "$125.00"
}

export interface PdfPayment {
  amountLabel: string;
  method: string;
  dateLabel: string;
  tenderNote: string | null; // e.g. "Cash $160.00 — change $5.28"
}

export interface PdfInvoiceProps {
  business: PdfBusiness;
  customer: PdfCustomer;
  invoiceNumber: string;
  issuedDate: string; // YYYY-MM-DD
  dueDate: string | null;
  status: string; // display status text
  lines: PdfLine[];
  subtotalLabel: string;
  discountLabel: string;
  taxLabel: string;
  totalLabel: string;
  balanceLabel: string;
  payments: PdfPayment[];
  paymentTerms: string | null;
  footer: string | null;
}
