# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Brice Beauty Supply (BBS) billing app foundation — Next.js 14 project, Prisma schema with full data model, NextAuth credentials auth, seed data, Tailwind design tokens, shell layout with sidebar, integer-cent money library, and Vitest test setup — such that a developer can `npm run dev`, log in as admin, and see an empty dashboard.

**Architecture:** Next.js 14 App Router with route groups `(auth)` and `(app)`. Server Components by default. Prisma ORM against local PostgreSQL for dev. NextAuth v5 credentials provider with bcrypt password hashing. All money handled as integer cents in a single `lib/money.ts` module. Tailwind CSS with custom design tokens matching the spec palette. Middleware protects `(app)/*` routes.

**Tech Stack:** Next.js 14, TypeScript strict, Prisma, PostgreSQL, NextAuth v5, bcrypt, Zod, Tailwind CSS, Vitest, Playwright (setup only in Phase 1).

---

## File Structure

Files created in Phase 1:

```
bbs/
  package.json
  tsconfig.json
  next.config.mjs
  tailwind.config.ts
  postcss.config.mjs
  vitest.config.ts
  .env.example
  .env.local                     ← gitignored
  .gitignore
  .eslintrc.json
  prisma/
    schema.prisma                ← full data model per spec
    seed.ts                      ← admin user + tax rate + sample catalog
  src/
    app/
      layout.tsx                 ← root html/body, font, providers
      globals.css                ← Tailwind directives + tokens
      page.tsx                   ← redirect to /dashboard or /login
      (auth)/
        layout.tsx               ← centered card layout
        login/page.tsx           ← credentials form
      (app)/
        layout.tsx               ← auth check + sidebar
        dashboard/page.tsx       ← empty state placeholder
      api/
        auth/[...nextauth]/route.ts
    lib/
      prisma.ts                  ← singleton PrismaClient
      auth.ts                    ← NextAuth v5 config export
      money.ts                   ← toCents, fromCents, formatUSD
      permissions.ts             ← Role enum re-export + requireRole helper stub
    components/
      layout/
        Sidebar.tsx              ← desktop nav
        MobileNav.tsx            ← bottom nav
        SignOutButton.tsx        ← client component
      ui/
        Button.tsx               ← primary/secondary/ghost variants
    schemas/
      auth.ts                    ← login zod schema
    middleware.ts                ← protect (app)/* routes
    types/
      next-auth.d.ts             ← session augmentation for role
    __tests__/
      money.test.ts              ← unit tests for money helpers
```

Each file has one responsibility. `lib/money.ts` is the sole location for cent arithmetic. `lib/prisma.ts` prevents multiple PrismaClient instances in dev. `lib/auth.ts` exports the NextAuth config that both middleware and the API route handler consume.

---

## Task 1: Initialize Next.js Project

**Files:**
- Create: `bbs/package.json`
- Create: `bbs/tsconfig.json`
- Create: `bbs/next.config.mjs`
- Create: `bbs/.gitignore`
- Create: `bbs/.eslintrc.json`

- [ ] **Step 1: Create `bbs/` directory and initialize package.json**

Run from repo root:

```bash
mkdir -p bbs
cd bbs
```

Create `bbs/package.json`:

```json
{
  "name": "bbs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts",
    "prisma:studio": "prisma studio"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "next": "14.2.15",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@prisma/client": "5.20.0",
    "next-auth": "5.0.0-beta.22",
    "bcrypt": "5.1.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "20.14.10",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@types/bcrypt": "5.0.2",
    "typescript": "5.5.3",
    "prisma": "5.20.0",
    "tsx": "4.19.1",
    "tailwindcss": "3.4.13",
    "postcss": "8.4.47",
    "autoprefixer": "10.4.20",
    "eslint": "8.57.0",
    "eslint-config-next": "14.2.15",
    "vitest": "2.1.2",
    "@vitejs/plugin-react": "4.3.2"
  }
}
```

- [ ] **Step 2: Create `bbs/tsconfig.json` with strict mode**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `bbs/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  }
};

export default nextConfig;
```

- [ ] **Step 4: Create `bbs/.gitignore`**

```
node_modules
.next
out
.env
.env.local
.env.*.local
*.log
.DS_Store
coverage
prisma/*.db
```

- [ ] **Step 5: Create `bbs/.eslintrc.json`**

```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 6: Install dependencies**

Run in `bbs/`:

```bash
npm install
```

Expected: `node_modules/` populated, no errors. `package-lock.json` created.

- [ ] **Step 7: Commit**

```bash
git add bbs/package.json bbs/package-lock.json bbs/tsconfig.json bbs/next.config.mjs bbs/.gitignore bbs/.eslintrc.json
git commit -m "chore: initialize Next.js project skeleton"
```

---

## Task 2: Configure Tailwind CSS with Design Tokens

**Files:**
- Create: `bbs/tailwind.config.ts`
- Create: `bbs/postcss.config.mjs`
- Create: `bbs/src/app/globals.css`

- [ ] **Step 1: Create `bbs/tailwind.config.ts` with tokens from spec**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0F0F0F",
        surface: "#1A1A1A",
        "surface-raised": "#242424",
        border: "#2A2A2A",
        gold: {
          DEFAULT: "#D4B44A",
          hover: "#B8973A"
        },
        text: "#F5F0E8",
        muted: "#8A8580",
        success: {
          DEFAULT: "#2D6A4F",
          bright: "#52B788"
        },
        danger: {
          DEFAULT: "#C0392B",
          bright: "#E74C3C"
        },
        warning: {
          DEFAULT: "#B7860B",
          bright: "#F4C430"
        }
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      fontFeatureSettings: {
        tabular: '"tnum"'
      }
    }
  },
  plugins: []
};

export default config;
```

- [ ] **Step 2: Create `bbs/postcss.config.mjs`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

- [ ] **Step 3: Create `bbs/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body {
    background-color: #0F0F0F;
    color: #F5F0E8;
  }

  .tabular {
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add bbs/tailwind.config.ts bbs/postcss.config.mjs bbs/src/app/globals.css
git commit -m "chore: configure Tailwind with BBS design tokens"
```

---

## Task 3: Prisma Schema and Migration

**Files:**
- Create: `bbs/prisma/schema.prisma`
- Create: `bbs/.env.example`
- Create: `bbs/.env.local` (gitignored)

- [ ] **Step 1: Create `bbs/.env.example`**

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bbs?schema=public"
NEXTAUTH_SECRET="replace-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
```

- [ ] **Step 2: Create `bbs/.env.local` with dev values**

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bbs?schema=public"
NEXTAUTH_SECRET="dev-only-secret-replace-in-production-please"
NEXTAUTH_URL="http://localhost:3000"
```

- [ ] **Step 3: Create `bbs/prisma/schema.prisma` with full data model**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  STAFF
  VIEWER
}

enum InvoiceStatus {
  DRAFT
  UNPAID
  PARTIAL
  PAID
  OVERDUE
  VOID
  REFUNDED
}

enum PaymentMethod {
  CASH
  CARD
  BANK
  CHECK
  MOBILE
  OTHER
}

enum DiscountType {
  PERCENT
  FIXED
  NONE
}

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role     @default(STAFF)
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())

  invoicesCreated Invoice[] @relation("InvoiceCreator")
  payments        Payment[]
  refunds         Refund[]
  auditLogs       AuditLog[]
}

model Customer {
  id             String    @id @default(cuid())
  name           String
  company        String?
  email          String?
  phone          String?
  billingAddress String?
  taxId          String?
  notes          String?
  archived       Boolean   @default(false)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  invoices Invoice[]

  @@index([email])
  @@index([name])
}

model CatalogItem {
  id             String   @id @default(cuid())
  name           String
  description    String?
  sku            String?  @unique
  unitPriceCents Int
  taxRateId      String?
  active         Boolean  @default(true)

  taxRate       TaxRate?      @relation(fields: [taxRateId], references: [id])
  invoiceLines  InvoiceLine[]

  @@index([name])
}

model TaxRate {
  id          String  @id @default(cuid())
  name        String
  ratePercent Decimal @db.Decimal(6, 4)
  active      Boolean @default(true)
  isDefault   Boolean @default(false)

  catalogItems CatalogItem[]
  invoiceLines InvoiceLine[]
}

model Invoice {
  id             String        @id @default(cuid())
  invoiceNumber  String        @unique
  customerId     String
  issuedAt       DateTime      @default(now())
  dueAt          DateTime?
  status         InvoiceStatus @default(DRAFT)
  subtotalCents  Int           @default(0)
  discountCents  Int           @default(0)
  taxCents       Int           @default(0)
  totalCents     Int           @default(0)
  paidCents      Int           @default(0)
  balanceCents   Int           @default(0)
  currency       String        @default("USD")
  notes          String?
  paymentTerms   String?
  createdById    String
  updatedAt      DateTime      @updatedAt

  customer  Customer      @relation(fields: [customerId], references: [id])
  createdBy User          @relation("InvoiceCreator", fields: [createdById], references: [id])
  lines     InvoiceLine[]
  payments  Payment[]
  refunds   Refund[]

  @@index([customerId])
  @@index([status])
  @@index([issuedAt])
}

model InvoiceLine {
  id             String       @id @default(cuid())
  invoiceId      String
  catalogItemId  String?
  description    String
  quantity       Decimal      @db.Decimal(12, 4)
  unitPriceCents Int
  discountType   DiscountType @default(NONE)
  discountValue  Decimal      @default(0) @db.Decimal(12, 4)
  taxRateId      String?
  lineTotalCents Int

  invoice     Invoice      @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  catalogItem CatalogItem? @relation(fields: [catalogItemId], references: [id])
  taxRate     TaxRate?     @relation(fields: [taxRateId], references: [id])

  @@index([invoiceId])
}

model Payment {
  id              String        @id @default(cuid())
  invoiceId       String
  amountCents     Int
  method          PaymentMethod
  paidAt          DateTime      @default(now())
  referenceNumber String?
  staffId         String
  note            String?
  idempotencyKey  String        @unique

  invoice Invoice  @relation(fields: [invoiceId], references: [id])
  staff   User     @relation(fields: [staffId], references: [id])
  refunds Refund[]

  @@index([invoiceId])
}

model Refund {
  id          String   @id @default(cuid())
  invoiceId   String
  paymentId   String?
  amountCents Int
  reason      String
  refundedAt  DateTime @default(now())
  staffId     String
  note        String?

  invoice Invoice  @relation(fields: [invoiceId], references: [id])
  payment Payment? @relation(fields: [paymentId], references: [id])
  staff   User     @relation(fields: [staffId], references: [id])

  @@index([invoiceId])
}

model BusinessSettings {
  id                   Int     @id @default(1)
  name                 String  @default("Brice Beauty Supply")
  logoUrl              String?
  address              String?
  phone                String?
  email                String?
  website              String?
  taxId                String?
  currency             String  @default("USD")
  locale               String  @default("en-US")
  timezone             String  @default("America/New_York")
  dateFormat           String  @default("MM/dd/yyyy")
  invoicePrefix        String  @default("BBS")
  nextInvoiceSeq       Int     @default(1)
  defaultPaymentTerms  String?
  defaultNotes         String?
  footer               String?
  receiptAppearance    Json    @default("{}")
}

model AuditLog {
  id         String   @id @default(cuid())
  action     String
  entityType String
  entityId   String
  userId     String
  before     Json?
  after      Json?
  ip         String?
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([entityType, entityId])
  @@index([createdAt])
}
```

- [ ] **Step 4: Run the initial migration**

Run in `bbs/`:

```bash
npx prisma migrate dev --name init
```

Expected: creates `prisma/migrations/<timestamp>_init/migration.sql`, applies to the local database, generates Prisma Client. If postgres is not running locally, the developer must start it first (spec notes Supabase/Neon for prod; local Postgres is required for dev).

- [ ] **Step 5: Verify Prisma Client generated**

Run:

```bash
node -e "const {PrismaClient} = require('@prisma/client'); console.log(Object.keys(new PrismaClient()).filter(k => !k.startsWith('_')).sort())"
```

Expected: array containing `user`, `customer`, `invoice`, `payment`, `refund`, `catalogItem`, `taxRate`, `businessSettings`, `auditLog`, `invoiceLine`.

- [ ] **Step 6: Commit**

```bash
git add bbs/prisma/schema.prisma bbs/prisma/migrations bbs/.env.example
git commit -m "feat: add Prisma schema and initial migration for BBS data model"
```

---

## Task 4: Money Library — Failing Tests

**Files:**
- Create: `bbs/vitest.config.ts`
- Create: `bbs/src/__tests__/money.test.ts`

- [ ] **Step 1: Create `bbs/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
```

- [ ] **Step 2: Create `bbs/src/__tests__/money.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toCents, fromCents, formatUSD, addCents, multiplyCents } from "@/lib/money";

describe("toCents", () => {
  it("converts whole dollars", () => {
    expect(toCents("10")).toBe(1000);
    expect(toCents("10.00")).toBe(1000);
  });

  it("converts dollars and cents", () => {
    expect(toCents("10.50")).toBe(1050);
    expect(toCents("0.99")).toBe(99);
  });

  it("handles values with $ and commas", () => {
    expect(toCents("$1,234.56")).toBe(123456);
  });

  it("rounds half away from zero (banker-safe)", () => {
    expect(toCents("0.005")).toBe(1);
    expect(toCents("0.004")).toBe(0);
  });

  it("accepts numeric input", () => {
    expect(toCents(19.99)).toBe(1999);
  });

  it("throws on invalid input", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
  });

  it("handles negative amounts", () => {
    expect(toCents("-5.25")).toBe(-525);
  });
});

describe("fromCents", () => {
  it("returns dollar string with two decimals", () => {
    expect(fromCents(1000)).toBe("10.00");
    expect(fromCents(99)).toBe("0.99");
    expect(fromCents(0)).toBe("0.00");
  });

  it("handles negatives", () => {
    expect(fromCents(-525)).toBe("-5.25");
  });
});

describe("formatUSD", () => {
  it("prefixes dollar sign and uses commas", () => {
    expect(formatUSD(123456)).toBe("$1,234.56");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(99)).toBe("$0.99");
  });

  it("formats negatives with minus before symbol", () => {
    expect(formatUSD(-500)).toBe("-$5.00");
  });
});

describe("addCents", () => {
  it("sums a list of cent values", () => {
    expect(addCents([100, 200, 300])).toBe(600);
    expect(addCents([])).toBe(0);
  });
});

describe("multiplyCents", () => {
  it("multiplies cents by a decimal quantity and rounds", () => {
    expect(multiplyCents(1000, 2)).toBe(2000);
    expect(multiplyCents(333, 3)).toBe(999);
    expect(multiplyCents(100, 0.1)).toBe(10);
  });

  it("rounds half away from zero", () => {
    expect(multiplyCents(1, 0.5)).toBe(1);
    expect(multiplyCents(1, 0.4)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run in `bbs/`:

```bash
npm test
```

Expected: FAIL with "Cannot find module '@/lib/money'".

---

## Task 5: Money Library — Implementation

**Files:**
- Create: `bbs/src/lib/money.ts`

- [ ] **Step 1: Create `bbs/src/lib/money.ts`**

```ts
const CENT_PATTERN = /^-?\d+(\.\d+)?$/;

function normalize(input: string | number): string {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new Error(`Invalid money value: ${input}`);
    }
    return input.toString();
  }
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!CENT_PATTERN.test(cleaned)) {
    throw new Error(`Invalid money value: ${input}`);
  }
  return cleaned;
}

function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

export function toCents(input: string | number): number {
  const normalized = normalize(input);
  const negative = normalized.startsWith("-");
  const abs = negative ? normalized.slice(1) : normalized;
  const [dollars, fraction = ""] = abs.split(".");
  const paddedFraction = (fraction + "000").slice(0, 3);
  const wholeCents = Number(dollars) * 100 + Number(paddedFraction.slice(0, 2));
  const thirdDigit = Number(paddedFraction[2] ?? "0");
  const rounded = wholeCents + (thirdDigit >= 5 ? 1 : 0);
  return negative ? -rounded : rounded;
}

export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const fraction = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${dollars}.${fraction}`;
}

export function formatUSD(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${withCommas}.${fraction}`;
}

export function addCents(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

export function multiplyCents(cents: number, quantity: number): number {
  return roundHalfAwayFromZero(cents * quantity);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run in `bbs/`:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add bbs/vitest.config.ts bbs/src/__tests__/money.test.ts bbs/src/lib/money.ts
git commit -m "feat: add integer-cent money library with full test coverage"
```

---

## Task 6: Prisma Client Singleton

**Files:**
- Create: `bbs/src/lib/prisma.ts`

- [ ] **Step 1: Create `bbs/src/lib/prisma.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/lib/prisma.ts
git commit -m "feat: add Prisma client singleton"
```

---

## Task 7: Seed Data

**Files:**
- Create: `bbs/prisma/seed.ts`

- [ ] **Step 1: Create `bbs/prisma/seed.ts`**

```ts
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

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
```

- [ ] **Step 2: Run the seed**

Run in `bbs/`:

```bash
npm run prisma:seed
```

Expected output ends with:

```
Seed complete.
Login: admin@bricebeauty.example / admin1234
```

- [ ] **Step 3: Commit**

```bash
git add bbs/prisma/seed.ts
git commit -m "feat: add seed script with admin user, default tax, sample catalog"
```

---

## Task 8: NextAuth v5 Configuration

**Files:**
- Create: `bbs/src/lib/auth.ts`
- Create: `bbs/src/schemas/auth.ts`
- Create: `bbs/src/types/next-auth.d.ts`
- Create: `bbs/src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create `bbs/src/schemas/auth.ts`**

```ts
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters")
});

export type LoginInput = z.infer<typeof loginSchema>;
```

- [ ] **Step 2: Create `bbs/src/types/next-auth.d.ts`**

```ts
import { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    userId: string;
  }
}
```

- [ ] **Step 3: Create `bbs/src/lib/auth.ts`**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/schemas/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email }
        });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.role = token.role;
      return session;
    }
  }
});
```

- [ ] **Step 4: Create `bbs/src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: Commit**

```bash
git add bbs/src/schemas/auth.ts bbs/src/types/next-auth.d.ts bbs/src/lib/auth.ts bbs/src/app/api/auth/[...nextauth]/route.ts
git commit -m "feat: configure NextAuth v5 credentials provider with role in session"
```

---

## Task 9: Permissions Helper

**Files:**
- Create: `bbs/src/lib/permissions.ts`

- [ ] **Step 1: Create `bbs/src/lib/permissions.ts`**

```ts
import { Role } from "@prisma/client";
import { auth } from "@/lib/auth";

export { Role };

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireRole(...allowed: Role[]) {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  if (!allowed.includes(session.user.role)) {
    throw new ForbiddenError();
  }
  return session.user;
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  return session.user;
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/lib/permissions.ts
git commit -m "feat: add requireRole and requireSession helpers"
```

---

## Task 10: Middleware to Protect App Routes

**Files:**
- Create: `bbs/src/middleware.ts`

- [ ] **Step 1: Create `bbs/src/middleware.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login");

  if (!isLoggedIn && !isAuthRoute) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/middleware.ts
git commit -m "feat: middleware protects app routes and redirects logged-in users away from /login"
```

---

## Task 11: Root Layout and Landing Redirect

**Files:**
- Create: `bbs/src/app/layout.tsx`
- Create: `bbs/src/app/page.tsx`

- [ ] **Step 1: Create `bbs/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brice Beauty Supply",
  description: "Billing and invoicing for Brice Beauty Supply"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create `bbs/src/app/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 3: Commit**

```bash
git add bbs/src/app/layout.tsx bbs/src/app/page.tsx
git commit -m "feat: add root layout and landing redirect to /dashboard"
```

---

## Task 12: UI Button Primitive

**Files:**
- Create: `bbs/src/components/ui/Button.tsx`

- [ ] **Step 1: Create `bbs/src/components/ui/Button.tsx`**

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-gold text-bg hover:bg-gold-hover focus-visible:ring-2 focus-visible:ring-gold",
  secondary:
    "bg-surface-raised text-text border border-border hover:bg-surface focus-visible:ring-2 focus-visible:ring-gold",
  ghost:
    "bg-transparent text-text hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-gold",
  danger:
    "bg-danger text-text hover:bg-danger-bright focus-visible:ring-2 focus-visible:ring-danger"
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={[
        "inline-flex items-center justify-center rounded font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "focus:outline-none",
        variantClasses[variant],
        sizeClasses[size],
        className
      ].join(" ")}
      {...props}
    />
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/components/ui/Button.tsx
git commit -m "feat: add Button primitive with primary/secondary/ghost/danger variants"
```

---

## Task 13: Auth Layout and Login Page

**Files:**
- Create: `bbs/src/app/(auth)/layout.tsx`
- Create: `bbs/src/app/(auth)/login/page.tsx`
- Create: `bbs/src/app/(auth)/login/login-form.tsx`

- [ ] **Step 1: Create `bbs/src/app/(auth)/layout.tsx`**

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-lg p-8 shadow-2xl">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `bbs/src/app/(auth)/login/login-form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false
      });
      if (result?.error) {
        setError("Invalid email or password.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm text-muted mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm text-muted mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-bright">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create `bbs/src/app/(auth)/login/page.tsx`**

```tsx
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gold mb-1">Brice Beauty Supply</h1>
      <p className="text-sm text-muted mb-6">Sign in to continue</p>
      <LoginForm />
    </div>
  );
}
```

- [ ] **Step 4: Install the NextAuth React client**

The `signIn` helper for client components lives in `next-auth/react`. Verify it resolves:

Run in `bbs/`:

```bash
node -e "require('next-auth/react')"
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add bbs/src/app/\(auth\)
git commit -m "feat: add login page with credentials form"
```

---

## Task 14: App Shell — Sidebar, Sign-Out, and (app) Layout

**Files:**
- Create: `bbs/src/components/layout/Sidebar.tsx`
- Create: `bbs/src/components/layout/MobileNav.tsx`
- Create: `bbs/src/components/layout/SignOutButton.tsx`
- Create: `bbs/src/app/(app)/layout.tsx`

- [ ] **Step 1: Create `bbs/src/components/layout/SignOutButton.tsx`**

```tsx
"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full justify-start"
    >
      Sign out
    </Button>
  );
}
```

- [ ] **Step 2: Create `bbs/src/components/layout/Sidebar.tsx`**

```tsx
import Link from "next/link";
import { SignOutButton } from "./SignOutButton";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/bills/new", label: "Create Bill", primary: true },
  { href: "/invoices", label: "Invoices" },
  { href: "/customers", label: "Customers" },
  { href: "/catalog", label: "Catalog" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" }
];

export function Sidebar({ userName }: { userName: string }) {
  return (
    <aside className="hidden md:flex md:flex-col w-60 min-h-screen bg-surface border-r border-border">
      <div className="px-6 py-6 border-b border-border">
        <div className="text-gold font-semibold">Brice Beauty Supply</div>
        <div className="text-xs text-muted mt-1">{userName}</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "block px-3 py-2 rounded text-sm transition-colors",
              item.primary
                ? "bg-gold text-bg hover:bg-gold-hover font-medium"
                : "text-text hover:bg-surface-raised"
            ].join(" ")}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-border">
        <SignOutButton />
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create `bbs/src/components/layout/MobileNav.tsx`**

```tsx
import Link from "next/link";

const NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/bills/new", label: "New" },
  { href: "/invoices", label: "Invoices" },
  { href: "/settings", label: "Settings" }
];

export function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-border">
      <ul className="grid grid-cols-4">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center justify-center h-14 text-xs text-text hover:bg-surface-raised"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Create `bbs/src/app/(app)/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={session.user.name ?? session.user.email} />
      <main className="flex-1 pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">{children}</div>
      </main>
      <MobileNav />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add bbs/src/components/layout bbs/src/app/\(app\)/layout.tsx
git commit -m "feat: add app shell with sidebar, mobile nav, and auth-guarded layout"
```

---

## Task 15: Dashboard Placeholder Page

**Files:**
- Create: `bbs/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create `bbs/src/app/(app)/dashboard/page.tsx`**

```tsx
import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  const name = session?.user.name ?? "there";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Dashboard</h1>
        <p className="text-sm text-muted mt-1">Welcome back, {name}.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {["Today's Revenue", "Outstanding", "Completed", "Overdue"].map((label) => (
          <div
            key={label}
            className="bg-surface border border-border rounded-lg p-5"
          >
            <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-gold tabular">$0.00</div>
          </div>
        ))}
      </div>
      <div className="mt-8 bg-surface border border-border rounded-lg p-8 text-center">
        <div className="text-muted">
          No invoices yet — the Create Bill workflow will appear in Phase 2.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: add dashboard placeholder with KPI cards and empty state"
```

---

## Task 16: End-to-End Smoke Verification

- [ ] **Step 1: Start the dev server**

Run in `bbs/`:

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000` with no errors.

- [ ] **Step 2: Verify login redirect**

Visit `http://localhost:3000/` in a browser.

Expected: redirects to `/login` (because middleware sees no session, `/dashboard` redirect is intercepted).

- [ ] **Step 3: Sign in**

Enter `admin@bricebeauty.example` / `admin1234`. Submit.

Expected: navigate to `/dashboard`. Sidebar visible on desktop with all nav links; four KPI cards render `$0.00`; bottom nav visible on mobile widths.

- [ ] **Step 4: Verify auth protects app routes**

Sign out via the sidebar button. Then visit `http://localhost:3000/dashboard`.

Expected: redirected to `/login?callbackUrl=%2Fdashboard`.

- [ ] **Step 5: Run the full test suite one more time**

Stop the dev server. Run in `bbs/`:

```bash
npm test
```

Expected: all money tests PASS.

- [ ] **Step 6: Run the production build**

Run in `bbs/`:

```bash
npm run build
```

Expected: build completes with no TypeScript or lint errors. All routes compile.

- [ ] **Step 7: Commit any lockfile or generated-type changes**

If `next-env.d.ts` or lockfile changed:

```bash
git add bbs/next-env.d.ts bbs/package-lock.json
git commit -m "chore: capture generated types and lockfile from phase 1 build"
```

If nothing changed, skip.

---

## Phase 1 Done When

- `npm run dev` starts cleanly
- Visiting `/` while signed out redirects to `/login`
- Signing in with the seeded admin lands on `/dashboard`
- Sidebar renders on desktop, bottom nav on mobile
- Signing out returns to `/login`
- `npm test` passes all money tests
- `npm run build` completes with no errors
- The following commits exist on the branch:
  1. chore: initialize Next.js project skeleton
  2. chore: configure Tailwind with BBS design tokens
  3. feat: add Prisma schema and initial migration for BBS data model
  4. feat: add integer-cent money library with full test coverage
  5. feat: add Prisma client singleton
  6. feat: add seed script with admin user, default tax, sample catalog
  7. feat: configure NextAuth v5 credentials provider with role in session
  8. feat: add requireRole and requireSession helpers
  9. feat: middleware protects app routes and redirects logged-in users away from /login
  10. feat: add root layout and landing redirect to /dashboard
  11. feat: add Button primitive with primary/secondary/ghost/danger variants
  12. feat: add login page with credentials form
  13. feat: add app shell with sidebar, mobile nav, and auth-guarded layout
  14. feat: add dashboard placeholder with KPI cards and empty state

---

## What Phase 2 Will Build On

- `lib/money.ts` used by the totals engine and invoice line calculations
- `lib/prisma.ts` used by all Server Actions
- `lib/permissions.ts` gates every mutating Server Action
- Prisma models are the source of truth — no schema changes should be needed for the core bill flow
- Sidebar links (`/bills/new`, `/invoices`, `/customers`, `/catalog`) already point at the pages Phase 2 will create
