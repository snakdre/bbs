"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { customerCreateSchema, customerUpdateSchema } from "@/schemas/customer";

export async function searchCustomers(query: string) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const q = query.trim();
  if (q.length === 0) return [];
  return prisma.customer.findMany({
    where: {
      archived: false,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } }
      ]
    },
    orderBy: { name: "asc" },
    take: 20
  });
}

export async function createCustomer(raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = customerCreateSchema.parse(raw);

  if (data.email) {
    const existing = await prisma.customer.findFirst({
      where: { email: data.email, archived: false }
    });
    if (existing) {
      return { ok: false as const, error: "duplicate_email", existingId: existing.id };
    }
  }

  const created = await prisma.customer.create({ data });
  revalidatePath("/customers");
  return { ok: true as const, customer: created };
}

export async function updateCustomer(id: string, raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = customerUpdateSchema.parse(raw);
  const updated = await prisma.customer.update({ where: { id }, data });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  return { ok: true as const, customer: updated };
}

export async function archiveCustomer(id: string) {
  await requireRole(Role.ADMIN, Role.STAFF);
  await prisma.customer.update({ where: { id }, data: { archived: true } });
  revalidatePath("/customers");
  return { ok: true as const };
}
