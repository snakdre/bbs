"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { toCents } from "@/lib/money";
import { catalogCreateSchema, catalogUpdateSchema } from "@/schemas/catalog";

export async function searchCatalog(query: string) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const q = query.trim();
  if (q.length === 0) return [];
  return prisma.catalogItem.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } }
      ]
    },
    include: { taxRate: true },
    orderBy: { name: "asc" },
    take: 20
  });
}

export async function listTaxRates() {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  return prisma.taxRate.findMany({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }]
  });
}

export async function createCatalogItem(raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = catalogCreateSchema.parse(raw);
  const item = await prisma.catalogItem.create({
    data: {
      name: data.name,
      description: data.description,
      sku: data.sku,
      unitPriceCents: toCents(data.unitPrice),
      taxRateId: data.taxRateId,
      active: data.active
    }
  });
  revalidatePath("/catalog");
  return { ok: true as const, item };
}

export async function updateCatalogItem(id: string, raw: unknown) {
  await requireRole(Role.ADMIN, Role.STAFF);
  const data = catalogUpdateSchema.parse(raw);
  const item = await prisma.catalogItem.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      sku: data.sku,
      unitPriceCents: toCents(data.unitPrice),
      taxRateId: data.taxRateId,
      active: data.active
    }
  });
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${id}/edit`);
  return { ok: true as const, item };
}

export async function archiveCatalogItem(id: string) {
  await requireRole(Role.ADMIN, Role.STAFF);
  await prisma.catalogItem.update({ where: { id }, data: { active: false } });
  revalidatePath("/catalog");
  return { ok: true as const };
}
