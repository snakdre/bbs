---
title: Phase 5A — Settings & Configuration — Design Spec
date: 2026-09-27
status: approved
extends: 2026-09-22-bbs-billing-design.md
supersedes: none
---

# Phase 5A — Settings & Configuration

Adds a single ADMIN-only `/settings` page with five sections covering business info + logo, tax rates, invoice numbering, defaults & receipt appearance, and enabled payment methods. Ships with one small Prisma migration, Supabase Storage-backed logo uploads, and one audit log entry per Save.

Phase 5A is the first of three sub-phases in Phase 5. It focuses on configuration surface only — Users & Governance (5B) and Polish & Deploy (5C) follow.

---

## Assumptions carried in from brainstorming

1. **Single scrolling `/settings` page**, five sections, each with its own Save button and Server Action.
2. **Whole page ADMIN-only.** STAFF/VIEWER get the `/not-authorized` page. Sidebar hides the link for non-admins.
3. **Logo stored in Supabase Storage** in a public bucket `bbs-logos`. Server-side `sharp` resize + WebP encode. Uses the `service_role` key.
4. **Invoice numbering:** prefix is free text, `nextInvoiceSeq` is forward-only (server refuses lower values). Live preview line updates on any change; a warning appears when raising past the current seq.
5. **Tax rates:** archive-only, never hard delete. Archiving the default is blocked with an inline error.
6. **Enabled payment methods:** new `enabledPaymentMethods String[]` field on `BusinessSettings`. One Prisma migration.
7. **Receipt appearance:** three booleans stored in the existing `receiptAppearance Json` field — `showBusinessAddress`, `showTaxId`, `showCustomFooter`. Server merges into the JSON preserving unknown keys.
8. **Audit granularity:** one `AuditLog` row per Save, with full before/after snapshots. Written in the same transaction as the mutation.
9. **No Phase 5A code changes to PaymentModal or PDF renderers yet** — the settings surface adds the config knobs; consumers pick them up as small follow-up edits inside 5A itself (documented as tasks).

---

## Information Architecture

### New/modified routes

| Route | Method | Purpose |
|---|---|---|
| `/settings` | GET | ADMIN-only settings page (all five sections) |

### New/modified files (summary)

- New: `src/actions/settings.ts` — ten Server Actions covering the five sections
- New: `src/schemas/settings.ts` — Zod schemas for all inputs
- New: `src/lib/settings-options.ts` — hardcoded currency/locale/timezone/dateFormat option lists
- New: `src/lib/receipt-appearance.ts` — pure `mergeReceiptAppearance()` (TDD)
- New: `src/lib/storage.ts` — Supabase Storage client + `uploadLogoImage` helper
- New: `src/components/settings/*.tsx` — one client component per section
- Rewrite: `src/app/(app)/settings/page.tsx` — was placeholder from Phase 1
- Modify: `src/components/billing/PaymentModal.tsx` — filter methods by `enabledPaymentMethods`
- Modify: `src/lib/pdf/build-props.ts` and `src/lib/pdf/InvoicePdfA4.tsx`, `ReceiptPdfThermal.tsx` — respect three `receiptAppearance` toggles
- Modify: `src/components/billing/BillBuilder.tsx` and its `/bills/new` page — pass `enabledMethods` to `PaymentModal`
- Modify: `src/components/invoices/InvoiceActionBar.tsx` and its parent page — pass `enabledMethods` to `PaymentModal`
- Modify: `src/components/layout/Sidebar.tsx` — hide `/settings` link for non-admin (role passed as prop from `(app)/layout.tsx`)
- Modify: `bbs/prisma/schema.prisma` — add `enabledPaymentMethods` field
- New migration: `bbs/prisma/migrations/<timestamp>_add_enabled_payment_methods/migration.sql`

---

## Data Model Changes

**One Prisma migration.** Adds one field to `BusinessSettings`:

```prisma
model BusinessSettings {
  // ... existing fields ...
  enabledPaymentMethods String[] @default(["CASH","CARD","BANK","CHECK","MOBILE","OTHER"])
  // ... existing fields ...
}
```

Migration SQL:

```sql
ALTER TABLE "BusinessSettings"
  ADD COLUMN "enabledPaymentMethods" TEXT[] NOT NULL
  DEFAULT ARRAY['CASH','CARD','BANK','CHECK','MOBILE','OTHER'];
```

**No other schema changes.** `receiptAppearance Json` already exists; three new keys live inside it and are not typed at the DB level.

---

## Section 1 — Business Info

**Fields** (all optional except `name`):

- `name` (required, max 200)
- `address` (multi-line, max 500)
- `phone` (max 40)
- `email` (max 255, valid email format when non-empty)
- `website` (max 255)
- `taxId` (max 50)
- `currency` (dropdown, single option `USD` — currency lock per original spec)
- `locale` (dropdown, single option `en-US`)
- `timezone` (dropdown — see `settings-options.ts` list below)
- `dateFormat` (dropdown — `MM/dd/yyyy` default, `dd/MM/yyyy`, `yyyy-MM-dd`)

**Logo widget** (separate area at top of section):

- Preview area: shows current logo if `logoUrl` is set (rendered at max 256×256), otherwise a dashed "Upload logo" placeholder square
- Upload input: `image/png,image/jpeg,image/webp`, max 5MB client-checked
- Buttons: `[Change logo]` when set, `[Remove logo]` when set

**Server behavior:**

- `updateBusinessInfo` — Zod-parsed input, all fields updated in one write, one AuditLog row
- `uploadLogo` — FormData with a File, resize + upload path (see Storage section)
- `removeLogo` — deletes the file from Storage, sets `logoUrl = null`

**Save button:** "Save business info" — single button covers all business fields (does NOT save logo — that has its own actions).

### Available option lists (`src/lib/settings-options.ts`)

```ts
export const CURRENCIES = [{ value: "USD", label: "US Dollar" }];
export const LOCALES = [{ value: "en-US", label: "English (US)" }];
export const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" }
];
export const DATE_FORMATS = [
  { value: "MM/dd/yyyy", label: "MM/dd/yyyy (US)" },
  { value: "dd/MM/yyyy", label: "dd/MM/yyyy (EU)" },
  { value: "yyyy-MM-dd", label: "yyyy-MM-dd (ISO)" }
];
```

---

## Section 2 — Tax Rates

**Display:** inline table with header row + one "Add rate" row at the bottom. Only `active === true` rates shown.

**Table columns:** Name · Rate % · Default (radio dot) · Actions.

**Add row:** two inputs (name, rate as string like `"7.0000"`) + Add button. Zod validates `ratePercent` matches `/^\d+(\.\d+)?$/` and parses to a number in `[0, 100]`.

**Row actions:**
- Inline edit: click on Name or Rate cell → becomes an `<input>`, blur triggers save via `updateTaxRate`. Escape cancels.
- `Set default`: calls `setDefaultTaxRate(id)`. Transaction clears `isDefault` on all rows, sets on target. Radio-dot moves accordingly.
- `Archive`: confirmation dialog. Blocked (with error toast) if `isDefault === true`. Otherwise sets `active = false`, row disappears from table.

**No "Show archived" toggle in Phase 5A.** Archived rates stay in the DB (referenced by historical `CatalogItem` / `InvoiceLine` rows) but the UI doesn't list them. If the admin needs to un-archive, they can re-create with the same name.

**Server behaviors:**
- `createTaxRate({name, ratePercent})` — inserts row with `active=true, isDefault=false`
- `updateTaxRate(id, {name, ratePercent})` — updates in place; refuses if the row is archived
- `setDefaultTaxRate(id)` — inside `$transaction`: `updateMany({data: {isDefault: false}})` then `update({where: {id}, data: {isDefault: true}})`
- `archiveTaxRate(id)` — loads row, refuses with `{ok: false, error: "default_rate_cannot_archive"}` if `isDefault === true`; otherwise sets `active = false`

Each action writes one `AuditLog` row with `entityType: "TaxRate"`, action names `TAX_RATE_CREATED`, `TAX_RATE_UPDATED`, `TAX_RATE_DEFAULTED`, `TAX_RATE_ARCHIVED`.

---

## Section 3 — Invoice Numbering

**Fields:**

- `invoicePrefix` — free text, max 20 chars (validated: matches `/^[A-Z0-9-]+$/i` — letters, digits, hyphens only)
- `nextInvoiceSeq` — integer, `>= current DB value`

**UI:**

```
Prefix                [ BBS_______ ]
Next invoice number   [ 42_________]

Next invoice will be: BBS-2026-0042
```

Live preview line under both inputs, updated in real time on the client using the currently-typed values.

**Warning banner** appears when the typed `nextInvoiceSeq` > current DB value:
> "You're skipping ahead — numbers 42 through 1233 won't be used."

**Save button:** "Save numbering". Server refuses `nextInvoiceSeq < current` with `{ok: false, error: "seq_would_rewind", current: <n>}`. Client displays "Next number can only go forward. Current: N."

**No auto-save.** Explicit action only. Reads happen through the normal Server Action pattern; the atomic invoice-numbering path (`lib/invoice-number.ts::reserveInvoiceNumber` from Phase 2) is untouched.

**Server behavior** (`updateNumbering`):
1. `requireRole(ADMIN)`, Zod-parse input
2. Load current settings inside `$transaction` with `SELECT ... FOR UPDATE` (same pattern as `reserveInvoiceNumber`) to prevent concurrent race with an in-flight invoice creation
3. If `input.nextInvoiceSeq < current.nextInvoiceSeq`, return `{ok: false, error: "seq_would_rewind"}`
4. Update prefix + seq; write AuditLog
5. Return `{ok: true}`

---

## Section 4 — Defaults & Receipt Appearance

Two sub-sections, one Save button.

### Defaults

- `defaultPaymentTerms` (max 200)
- `defaultNotes` (multi-line textarea, max 2000) — pre-fills new invoices' notes field
- `footer` (multi-line textarea, max 2000) — appears at bottom of A4 PDF; conditionally on thermal receipt via `showCustomFooter`

### Receipt appearance (three checkboxes)

- `showBusinessAddress` (default `true`) — controls whether the business address prints on the thermal receipt (address always shows on A4 invoice)
- `showTaxId` (default `true`) — controls tax ID rendering on both PDFs
- `showCustomFooter` (default `true`) — controls whether `footer` text prints on thermal receipt (always shows on A4)

**Storage:** merged into `BusinessSettings.receiptAppearance` JSON. Reading pattern:

```ts
const appearance = settings.receiptAppearance as {
  showBusinessAddress?: boolean;
  showTaxId?: boolean;
  showCustomFooter?: boolean;
} | null;
const showAddress = appearance?.showBusinessAddress ?? true;
```

**Merge behavior:** `updateDefaults` reads existing JSON, merges only the three known keys, preserves any unknown keys (forward-compat with future 5C additions). Encapsulated in a pure function `mergeReceiptAppearance(existing, patch)` — unit-tested.

**Save button:** "Save defaults & appearance". One action, one AuditLog row.

---

## Section 5 — Enabled Payment Methods

Six checkboxes:

- ☑ Cash · ☑ Card · ☑ Bank transfer · ☑ Check · ☑ Mobile payment · ☑ Other

Default: all six enabled. Validation: at least one must remain enabled — server refuses empty array.

**Save button:** "Save enabled methods".

**Server behavior** (`updateEnabledMethods(methods: PaymentMethod[])`):
1. `requireRole(ADMIN)`, Zod: `z.array(z.nativeEnum(PaymentMethod)).min(1)`
2. Update `enabledPaymentMethods`; write AuditLog
3. `revalidatePath("/invoices/[id]")`, `revalidatePath("/bills/new")` — payment modal reads this

**Consumer changes** (in the same commit):
- `PaymentModal` accepts an `enabledMethods: PaymentMethod[]` prop and uses it to filter the local `METHODS` array before rendering the `<Select>` options
- `/bills/new/page.tsx` loads settings, passes `enabledMethods` down to `BillBuilder` → `PaymentModal`
- `/invoices/[id]/page.tsx` loads settings, passes `enabledMethods` down to `InvoiceActionBar` → `PaymentModal`

---

## Supabase Storage — Logo Upload

**Bucket:** `bbs-logos`, public read, private write.

**Provisioning:** on first `uploadLogo` invocation, the server calls `supabase.storage.getBucket("bbs-logos")`. If it returns 404, calls `createBucket("bbs-logos", { public: true })`. Idempotent; subsequent calls skip.

**Credentials:** Supabase service role key. `.env.local` gets a new key `SUPABASE_SERVICE_ROLE_KEY` (the value the user shared earlier during Phase 1 brainstorming). Never exposed to the client.

**Server-side client** (`src/lib/storage.ts`):

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
```

`NEXT_PUBLIC_SUPABASE_URL` also gets added to `.env.local`. The BBS Supabase project ref is `jszkptwzikaxdtttzxky` (from Phase 1); the URL is therefore `https://jszkptwzikaxdtttzxky.supabase.co`.

**Upload pipeline** (`uploadLogoImage(fileBuffer, filenameHint)` in `lib/storage.ts`):

1. Ensure bucket exists (idempotent create)
2. `sharp(buffer).resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()`
3. Upload as `logo-{cuid}.webp` with `contentType: "image/webp"`, `upsert: false`
4. Return the public URL

**Server Action** (`uploadLogo`):
1. `requireRole(ADMIN)`, parse `File` from FormData
2. Enforce size (≤ 5MB) and MIME type server-side (`png`, `jpeg`, `webp`)
3. Call `uploadLogoImage()`
4. Inside `$transaction`: delete previous `logoUrl` file (best-effort — log and swallow errors), update `BusinessSettings.logoUrl`, write AuditLog
5. `revalidatePath("/settings")`, revalidate PDF routes

**`removeLogo` action:**
1. `requireRole(ADMIN)`, load current `logoUrl`
2. If set, delete the file from Storage (extract filename from URL)
3. `update` settings with `logoUrl: null`, write AuditLog

**Failure modes:**
- `sharp` throws (e.g., invalid image) → action returns `{ok: false, error: "invalid_image"}`
- Storage upload fails → action returns `{ok: false, error: "storage_upload_failed"}`
- Prior logo file deletion fails → logged, swallowed. Best-effort cleanup; orphan file remains but doesn't break UI.

---

## Server Actions Summary

All in `src/actions/settings.ts`, all `requireRole(ADMIN)`, all wrap the mutation + AuditLog in `prisma.$transaction`.

| Action | Input | AuditLog action |
|---|---|---|
| `updateBusinessInfo(input)` | Business fields except logo | `SETTINGS_BUSINESS_INFO_UPDATED` |
| `uploadLogo(formData)` | File | `SETTINGS_LOGO_UPLOADED` |
| `removeLogo()` | — | `SETTINGS_LOGO_REMOVED` |
| `updateNumbering(input)` | prefix + nextInvoiceSeq | `SETTINGS_NUMBERING_UPDATED` |
| `updateDefaults(input)` | terms/notes/footer + 3 booleans | `SETTINGS_DEFAULTS_UPDATED` |
| `updateEnabledMethods(methods)` | PaymentMethod[] | `SETTINGS_METHODS_UPDATED` |
| `createTaxRate(input)` | name + rate | `TAX_RATE_CREATED` |
| `updateTaxRate(id, input)` | name + rate | `TAX_RATE_UPDATED` |
| `setDefaultTaxRate(id)` | id | `TAX_RATE_DEFAULTED` |
| `archiveTaxRate(id)` | id | `TAX_RATE_ARCHIVED` |

Every action calls `revalidatePath("/settings")` on success. `updateEnabledMethods` and `updateBusinessInfo` also revalidate invoice paths that consume settings.

---

## Zod Schemas (`src/schemas/settings.ts`)

```ts
import { z } from "zod";
import { PaymentMethod } from "@prisma/client";

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  schema.optional().transform((v) => (v ? v : null)).nullable();

export const businessInfoSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().transform((v) => (v ? v : null)).nullable(),
  phone: z.string().trim().max(40).optional().transform((v) => (v ? v : null)).nullable(),
  email: z.string().trim().email().max(255).or(z.literal("")).transform((v) => (v ? v : null)).nullable(),
  website: z.string().trim().max(255).optional().transform((v) => (v ? v : null)).nullable(),
  taxId: z.string().trim().max(50).optional().transform((v) => (v ? v : null)).nullable(),
  currency: z.string().min(1),
  locale: z.string().min(1),
  timezone: z.string().min(1),
  dateFormat: z.string().min(1)
});

export const numberingSchema = z.object({
  invoicePrefix: z.string().trim().min(1).max(20).regex(/^[A-Z0-9-]+$/i),
  nextInvoiceSeq: z.number().int().positive()
});

export const defaultsSchema = z.object({
  defaultPaymentTerms: z.string().trim().max(200).optional().transform((v) => (v ? v : null)).nullable(),
  defaultNotes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)).nullable(),
  footer: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)).nullable(),
  showBusinessAddress: z.boolean(),
  showTaxId: z.boolean(),
  showCustomFooter: z.boolean()
});

export const enabledMethodsSchema = z.object({
  methods: z.array(z.nativeEnum(PaymentMethod)).min(1)
});

export const taxRateCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ratePercent: z.string().trim().regex(/^\d+(\.\d+)?$/).refine(
    (v) => Number(v) >= 0 && Number(v) <= 100,
    "Rate must be between 0 and 100"
  )
});

export const taxRateUpdateSchema = taxRateCreateSchema.extend({
  id: z.string().min(1)
});
```

---

## Pure Helper — `mergeReceiptAppearance`

`src/lib/receipt-appearance.ts`:

```ts
export interface ReceiptAppearance {
  showBusinessAddress: boolean;
  showTaxId: boolean;
  showCustomFooter: boolean;
}

const DEFAULTS: ReceiptAppearance = {
  showBusinessAddress: true,
  showTaxId: true,
  showCustomFooter: true
};

export function readReceiptAppearance(json: unknown): ReceiptAppearance {
  if (!json || typeof json !== "object") return { ...DEFAULTS };
  const obj = json as Record<string, unknown>;
  return {
    showBusinessAddress: typeof obj.showBusinessAddress === "boolean" ? obj.showBusinessAddress : true,
    showTaxId: typeof obj.showTaxId === "boolean" ? obj.showTaxId : true,
    showCustomFooter: typeof obj.showCustomFooter === "boolean" ? obj.showCustomFooter : true
  };
}

export function mergeReceiptAppearance(
  existing: unknown,
  patch: ReceiptAppearance
): Record<string, unknown> {
  const base = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  base.showBusinessAddress = patch.showBusinessAddress;
  base.showTaxId = patch.showTaxId;
  base.showCustomFooter = patch.showCustomFooter;
  return base;
}
```

Pure, no dependencies. Unit-tested.

---

## PDF and PaymentModal Integration

These pieces from Phase 3 need small edits inside Phase 5A tasks:

### `PaymentModal.tsx`

Add prop:
```ts
enabledMethods: PaymentMethod[];
```

Filter the local `METHODS` array:
```ts
const availableMethods = METHODS.filter((m) => enabledMethods.includes(m));
```

Ensure `method` state is initialized to the first available (in case CASH is disabled).

### `InvoicePdfA4.tsx` and `ReceiptPdfThermal.tsx`

Add props from `PdfBusiness`:
```ts
export interface PdfBusiness {
  // ... existing ...
  showBusinessAddress: boolean;
  showTaxId: boolean;
  showCustomFooter: boolean;
}
```

In `InvoicePdfA4`, always show address (A4 is a formal invoice) but conditionally hide taxId; always show footer/paymentTerms (A4 always renders these).

In `ReceiptPdfThermal`, wrap the address block in `{business.showBusinessAddress && ...}`, taxId block similarly, and footer block:
```tsx
{business.showCustomFooter && props.footer && <Text style={styles.footer}>{props.footer}</Text>}
```

### `build-props.ts`

Read `receiptAppearance` via `readReceiptAppearance()` and pass the three booleans through as part of `PdfBusiness`.

---

## UI States (extends existing)

- **Save success:** small green toast (2s auto-dismiss) with `"Saved."`. Use a simple client `useState` per section.
- **Save error:** red banner inside the section, message from `res.error` mapped to user-friendly text (e.g., `"default_rate_cannot_archive"` → `"Set another rate as default first."`).
- **Logo uploading:** upload button disabled + label `"Uploading…"`. Progress not tracked (single small file).
- **Numbering warning:** yellow banner inline when input value > current DB value. Not blocking.
- **Access:** direct GET `/settings` as STAFF/VIEWER redirects (via error boundary triggered by `requireRole`) to `/not-authorized`.

---

## Performance Targets

- `/settings` page load: < 500ms (one BusinessSettings read + one TaxRate.findMany).
- Save action: < 500ms round trip (Supabase pooler).
- Logo upload: < 3s for typical images (< 2MB source, resized to 512×512 WebP).

---

## Testing Plan

### Unit (Vitest)

- `lib/receipt-appearance.test.ts`:
  - `readReceiptAppearance(null)` returns all-true defaults
  - `readReceiptAppearance({})` returns all-true defaults
  - `readReceiptAppearance({ showTaxId: false })` returns `{ showBusinessAddress: true, showTaxId: false, showCustomFooter: true }`
  - `mergeReceiptAppearance` preserves unknown keys in the input
  - `mergeReceiptAppearance` overwrites the three known keys

### Manual smoke (end of Phase 5A)

1. As ADMIN, visit `/settings`. All five sections render with seeded values.
2. Change business name + save. Verify AuditLog row and revalidated `/dashboard` shows new name.
3. Upload a logo. Verify: file in `bbs-logos` bucket, `logoUrl` updated, A4 PDF still renders. (Logo rendering on the PDF is out of scope for 5A — that's a later polish task; the plan will just verify `logoUrl` is set.)
4. Remove the logo. Verify: file deleted from bucket, `logoUrl = null`.
5. Add a new tax rate "Test 5.5%". Verify row appears; new catalog items in `/catalog/new` see it in the dropdown.
6. Try to archive the current default rate. Verify blocked with error message.
7. Set the new rate as default, then archive the old default. Verify success.
8. Change invoice prefix to `TEST`. Verify next invoice created uses `TEST-2026-...`.
9. Try to lower `nextInvoiceSeq`. Verify blocked with error message.
10. Raise `nextInvoiceSeq` by 100. Create a new invoice — verify it uses the new number.
11. Disable CARD and BANK. Open payment modal on any UNPAID invoice — verify only 4 methods appear.
12. Toggle `showBusinessAddress: false`. Download thermal receipt PDF — verify address not rendered. Toggle back on.
13. As STAFF, visit `/settings` — verify redirect to `/not-authorized`.

---

## Build Phases

Phase 5A does not sub-phase further. Implementation tasks:

1. **Migration + schema** — add `enabledPaymentMethods` field
2. **Install deps** — `sharp`, `@supabase/supabase-js`; add env vars
3. **Pure helper (TDD)** — `receipt-appearance.ts` + tests
4. **Storage helper** — `lib/storage.ts` with bucket-provisioning + upload
5. **Zod schemas** — `schemas/settings.ts`
6. **Server Actions** — `actions/settings.ts` (all ten actions)
7. **Section components** — one client component per section
8. **`/settings` page** composing all five section components
9. **Consumer updates** — PaymentModal, PDF renderers, sidebar
10. **End-to-end smoke verification**

Each task ships one commit (a couple of the smaller ones may bundle).

---

## Out of Scope for Phase 5A

- **Staff CRUD + audit log viewer** — Phase 5B
- **A11y pass, E2E tests, Lighthouse, deploy** — Phase 5C
- **"Show archived" toggle for tax rates**
- **Multi-currency support** — spec locks USD
- **Custom brand colors on PDFs** — deferred
- **Logo rendering on PDFs** — data pipeline set up in 5A (upload → `logoUrl`), actually rendering the image inside the react-pdf `Image` component is a small 5C polish task
- **Per-invoice payment method override**
- **Bulk import of tax rates or business info** — no realistic use case
