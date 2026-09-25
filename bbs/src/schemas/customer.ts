import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .email("Enter a valid email")
  .max(255)
  .or(z.literal(""))
  .transform((v) => (v === "" ? null : v));

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  company: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
  email: emailField.nullable().optional(),
  phone: z.string().trim().max(40).optional().transform((v) => (v ? v : null)),
  billingAddress: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
  taxId: z.string().trim().max(50).optional().transform((v) => (v ? v : null)),
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null))
});

export const customerUpdateSchema = customerCreateSchema;

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
