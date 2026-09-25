import { z } from "zod";

const discountSchema = z.object({
  kind: z.enum(["PERCENT", "FIXED", "NONE"]),
  /** For PERCENT: 0..100. For FIXED: dollar string. For NONE: ignored. */
  value: z.string().default("0")
});

export const billLineSchema = z.object({
  catalogItemId: z.string().nullable(),
  description: z.string().trim().min(1, "Description required").max(500),
  /** Decimal quantity as a string, e.g. "1", "2.5". */
  quantity: z.string().trim().min(1),
  /** Dollar string, e.g. "12.50". */
  unitPrice: z.string().trim().min(1),
  discount: discountSchema,
  taxRateId: z.string().nullable()
});

export const createDraftBillSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  lines: z.array(billLineSchema).min(1, "At least one line item is required"),
  invoiceDiscount: discountSchema,
  notes: z.string().trim().max(2000).nullable().default(null),
  dueAt: z.string().nullable().default(null) // ISO date string or null
});

export type CreateDraftBillInput = z.infer<typeof createDraftBillSchema>;
export type BillLineInput = z.infer<typeof billLineSchema>;
