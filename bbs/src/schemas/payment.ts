import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

const dollarString = z
  .string()
  .trim()
  .min(1, "Amount is required")
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Amount must be numeric")
  .refine((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 9_999_999;
  }, "Amount must be positive and reasonable");

export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1, "invoiceId required"),
  tendered: dollarString,
  method: z.nativeEnum(PaymentMethod),
  paidAt: z.string().nullable().optional(),
  referenceNumber: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v ? v : null))
    .nullable(),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .nullable(),
  idempotencyKey: z.string().uuid("idempotencyKey must be a UUID")
});

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(500)
});

export const refundPaymentSchema = z.object({
  paymentId: z.string().min(1),
  amount: dollarString,
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(500),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null))
    .nullable()
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
