import { z } from "zod";

export const catalogCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  sku: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v ? v : null)),
  /** Dollar string (e.g. "12.50"). Converted to cents by the action. */
  unitPrice: z.string().trim().min(1, "Price is required"),
  taxRateId: z.string().trim().min(1).optional().transform((v) => (v ? v : null)),
  active: z.boolean().default(true)
});

export const catalogUpdateSchema = catalogCreateSchema;

export type CatalogCreateInput = z.infer<typeof catalogCreateSchema>;
