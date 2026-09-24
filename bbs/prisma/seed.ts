import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.businessSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "Brice Beauty Supply",
      invoicePrefix: "BBS",
      nextInvoiceSeq: 1,
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
      dateFormat: "MM/dd/yyyy"
    }
  });

  const passwordHash = await bcrypt.hash("admin1234", 12);
  await prisma.user.upsert({
    where: { email: "admin@bricebeauty.example" },
    update: {},
    create: {
      name: "BBS Admin",
      email: "admin@bricebeauty.example",
      passwordHash,
      role: Role.ADMIN,
      active: true
    }
  });

  const defaultTax = await prisma.taxRate.upsert({
    where: { id: "seed-default-tax" },
    update: {},
    create: {
      id: "seed-default-tax",
      name: "Sales Tax",
      ratePercent: "7.0000",
      active: true,
      isDefault: true
    }
  });

  const samples = [
    { name: "Human Hair Bundle 14\"", sku: "HHB-14", unitPriceCents: 4500 },
    { name: "Lace Front Wig", sku: "LFW-001", unitPriceCents: 12500 },
    { name: "Edge Control 4oz", sku: "EC-4OZ", unitPriceCents: 899 },
    { name: "Braid Install (Service)", sku: "SVC-BRAID", unitPriceCents: 15000 }
  ];

  for (const item of samples) {
    await prisma.catalogItem.upsert({
      where: { sku: item.sku },
      update: {},
      create: {
        name: item.name,
        sku: item.sku,
        unitPriceCents: item.unitPriceCents,
        taxRateId: defaultTax.id,
        active: true
      }
    });
  }

  console.log("Seed complete.");
  console.log("Login: admin@bricebeauty.example / admin1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
