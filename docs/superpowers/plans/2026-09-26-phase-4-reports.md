# Phase 4 — Reports, Revenue Chart, CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/reports` page with seven cash-basis report sections, a reusable pure-SVG revenue chart on both `/dashboard` and `/reports`, and per-report CSV export — all without a schema migration and driven by URL params interpreted in `BusinessSettings.timezone`.

**Architecture:** Two new pure modules (`lib/timezone.ts::resolveRange`, `lib/csv.ts::toCsv`) are TDD'd with no Prisma. `lib/reports.ts` holds seven typed query functions consumed by both the Server-Component page sections and seven CSV `GET` routes. `RevenueChart` is a stateless server-rendered SVG with two variants (compact/full). `DateRangePicker` is the only client component — all state lives in URL params, causing full page re-renders.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5, Tailwind, Vitest — all installed from Phases 1–3. No new dependencies.

---

## Decisions carried in from spec

Full spec: `docs/superpowers/specs/2026-09-26-phase-4-reports-design.md`.

- **Single `/reports` page**, seven sections, sticky date-range picker
- **Preset dropdown + custom range**; timezone from `BusinessSettings.timezone`
- **Cash-basis revenue**: `Payment.paidAt` minus `Refund.refundedAt`, both scoped to the range
- **Drafts excluded** from every report
- **Chart:** solid gold bars, pure SVG, no library
- **Toggle auto-adjusts range** (Daily→30d, Weekly→90d, Monthly→1yr) unless user set a custom range
- **CSV filenames:** `bbs-{report}-{from}_to_{to}.csv`, UTF-8 with BOM, plain dollar strings, `YYYY-MM-DD` dates
- **Access:** `requireRole(ADMIN, STAFF, VIEWER)` on page + all CSV routes
- **Aging report is a snapshot** — ignores date range, uses `now`

---

## File Structure

**New files:**

```
bbs/
  src/
    lib/
      timezone.ts                              ← pure range resolution (TDD)
      csv.ts                                   ← pure RFC 4180 serialization (TDD)
      reports.ts                               ← seven typed query functions
    __tests__/
      timezone.test.ts
      csv.test.ts
    components/
      charts/
        RevenueChart.tsx                       ← pure SVG, server
      reports/
        DateRangePicker.tsx                    ← client, URL-driven
        ReportSection.tsx                      ← shared section wrapper
    app/
      (app)/
        reports/
          page.tsx                             ← MODIFIED: full reports page (was placeholder in Phase 1)
          revenue.csv/route.ts
          aging.csv/route.ts
          payment-methods.csv/route.ts
          taxes.csv/route.ts
          discounts.csv/route.ts
          refunds.csv/route.ts
          top-items.csv/route.ts
        dashboard/
          page.tsx                             ← MODIFIED: add compact RevenueChart
```

**Modified files:**

Only two: `/reports/page.tsx` (which was never actually created in Phase 1 — the sidebar link points to it but the file doesn't exist yet) and `/dashboard/page.tsx` (Phase 3 has the real KPI queries; Phase 4 adds the chart card).

Each file has one clear responsibility. `lib/timezone.ts` and `lib/csv.ts` are Prisma-free. `lib/reports.ts` is Prisma-adjacent but returns plain typed shapes. All CSV routes share the same shape via a tiny helper.

---

## Task 1: Timezone Resolver — Failing Tests

**Files:**
- Create: `bbs/src/__tests__/timezone.test.ts`

- [ ] **Step 1: Create `bbs/src/__tests__/timezone.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveRange } from "@/lib/timezone";

// Fixed reference "now" — 2026-09-24 15:00 UTC, which is 2026-09-24 11:00 in America/New_York.
const NOW = new Date("2026-09-24T15:00:00Z");
const TZ = "America/New_York";

function resolve(params: Record<string, string | undefined>) {
  return resolveRange(params, TZ, NOW);
}

describe("resolveRange presets in America/New_York", () => {
  it("today: 2026-09-24 covers 04:00Z–next 04:00Z", () => {
    const r = resolve({ range: "today" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(r.label).toBe("Today");
  });

  it("yesterday: 2026-09-23 in ET", () => {
    const r = resolve({ range: "yesterday" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-09-23T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(r.label).toBe("Yesterday");
  });

  it("last-7d: 7 full ET days ending at today's ET midnight", () => {
    const r = resolve({ range: "last-7d" });
    if ("error" in r) throw new Error("unexpected error");
    // from = 2026-09-18 00:00 ET = 04:00Z
    expect(r.from.toISOString()).toBe("2026-09-18T04:00:00.000Z");
    // to = today 00:00 ET = 04:00Z of 2026-09-25? No — "last 7 days" INCLUDES today.
    // Convention: to = tomorrow 00:00 ET so today is fully included.
    expect(r.to.toISOString()).toBe("2026-09-25T04:00:00.000Z");
  });

  it("last-30d: same convention, 30 days", () => {
    const r = resolve({ range: "last-30d" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-08-26T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-25T04:00:00.000Z");
  });

  it("this-month: from Sep 1 00:00 ET to Oct 1 00:00 ET", () => {
    const r = resolve({ range: "this-month" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });

  it("last-month: August 2026", () => {
    const r = resolve({ range: "last-month" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("this-year: Jan 1 to Jan 1 next year", () => {
    const r = resolve({ range: "this-year" });
    if ("error" in r) throw new Error("unexpected error");
    // Jan 1 2026 in ET = 05:00Z (EST, UTC-5)
    expect(r.from.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("all-time: from epoch to now", () => {
    const r = resolve({ range: "all-time" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.getTime()).toBe(0);
    // 'to' is the exact reference NOW
    expect(r.to.getTime()).toBe(NOW.getTime());
  });
});

describe("resolveRange custom", () => {
  it("parses YYYY-MM-DD in the business timezone", () => {
    const r = resolve({ range: "custom", from: "2026-09-01", to: "2026-09-15" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    // 'to' is inclusive: 2026-09-15 covers up to 2026-09-16 00:00 ET
    expect(r.to.toISOString()).toBe("2026-09-16T04:00:00.000Z");
  });

  it("from and to same day", () => {
    const r = resolve({ range: "custom", from: "2026-09-05", to: "2026-09-05" });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-09-05T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });

  it("returns error when from > to", () => {
    const r = resolve({ range: "custom", from: "2026-09-15", to: "2026-09-01" });
    expect(r).toEqual({ error: "invalid_range" });
  });

  it("returns error when custom range is missing dates", () => {
    const r = resolve({ range: "custom" });
    expect(r).toEqual({ error: "invalid_range" });
  });

  it("returns error on malformed date string", () => {
    const r = resolve({ range: "custom", from: "not-a-date", to: "2026-09-01" });
    expect(r).toEqual({ error: "invalid_range" });
  });
});

describe("resolveRange defaults and DST", () => {
  it("defaults to last-30d when no range param", () => {
    const r = resolve({});
    if ("error" in r) throw new Error("unexpected error");
    expect(r.from.toISOString()).toBe("2026-08-26T04:00:00.000Z");
  });

  it("handles DST spring-forward (March 8 2026 in ET)", () => {
    // Reference: 2026-03-10 12:00Z, DST already active (UTC-4)
    const beforeDst = new Date("2026-03-10T12:00:00Z");
    const r = resolveRange({ range: "today" }, TZ, beforeDst);
    if ("error" in r) throw new Error("unexpected error");
    // 2026-03-10 00:00 EDT = 04:00Z
    expect(r.from.toISOString()).toBe("2026-03-10T04:00:00.000Z");
  });

  it("handles DST fall-back (November 1 2026 in ET)", () => {
    // Reference: 2026-11-02 12:00Z, EST now (UTC-5)
    const afterDst = new Date("2026-11-02T12:00:00Z");
    const r = resolveRange({ range: "today" }, TZ, afterDst);
    if ("error" in r) throw new Error("unexpected error");
    // 2026-11-02 00:00 EST = 05:00Z
    expect(r.from.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run in `bbs/`:

```bash
npm test
```

Expected: FAIL with "Cannot find module '@/lib/timezone'". All 60 existing tests still pass.

---

## Task 2: Timezone Resolver — Implementation

**Files:**
- Create: `bbs/src/lib/timezone.ts`

- [ ] **Step 1: Create `bbs/src/lib/timezone.ts`**

```ts
export interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
}

export type ResolveRangeResult = ResolvedRange | { error: "invalid_range" };

/**
 * Get the calendar Y/M/D of a Date as seen in a specific timezone.
 */
function getCalendarDate(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Given a calendar date (year/month/day) in a timezone, return the UTC Date
 * corresponding to that date's 00:00:00 local wall-clock time.
 * Works across DST boundaries by iteratively correcting the offset.
 */
function utcFromLocalMidnight(
  year: number,
  month: number,
  day: number,
  tz: string
): Date {
  // Start with a naive guess: UTC midnight of the same Y/M/D.
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // Correct: find what wall-clock time this guess actually represents in the TZ,
  // and shift by the difference.
  for (let i = 0; i < 3; i++) {
    const cal = getCalendarDate(guess, tz);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(guess);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const dayDiff =
      (cal.year - year) * 366 + (cal.month - month) * 31 + (cal.day - day);
    const shiftMinutes = dayDiff * 24 * 60 + hour * 60 + minute;
    if (shiftMinutes === 0) break;
    guess = new Date(guess.getTime() - shiftMinutes * 60_000);
  }
  return guess;
}

function addDays(d: Date, days: number, tz: string): Date {
  const cal = getCalendarDate(d, tz);
  return utcFromLocalMidnight(cal.year, cal.month, cal.day + days, tz);
}

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYmd(s: string): { year: number; month: number; day: number } | null {
  if (!isValidDateString(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
}

const PRESETS = new Set([
  "today",
  "yesterday",
  "last-7d",
  "last-30d",
  "this-month",
  "last-month",
  "this-year",
  "all-time",
  "custom"
]);

const LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "last-7d": "Last 7 days",
  "last-30d": "Last 30 days",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "all-time": "All time"
};

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  tz: string,
  now: Date = new Date()
): ResolveRangeResult {
  const range = params.range && PRESETS.has(params.range) ? params.range : "last-30d";

  if (range === "custom") {
    const fromParsed = params.from ? parseYmd(params.from) : null;
    const toParsed = params.to ? parseYmd(params.to) : null;
    if (!fromParsed || !toParsed) return { error: "invalid_range" };
    const from = utcFromLocalMidnight(fromParsed.year, fromParsed.month, fromParsed.day, tz);
    // 'to' is inclusive: end of the day = start of next day
    const to = utcFromLocalMidnight(toParsed.year, toParsed.month, toParsed.day + 1, tz);
    if (from.getTime() > to.getTime()) return { error: "invalid_range" };
    return { from, to, label: `${params.from} – ${params.to}` };
  }

  const todayCal = getCalendarDate(now, tz);
  const todayStart = utcFromLocalMidnight(todayCal.year, todayCal.month, todayCal.day, tz);
  const tomorrowStart = addDays(todayStart, 1, tz);

  switch (range) {
    case "today":
      return { from: todayStart, to: tomorrowStart, label: LABELS.today };
    case "yesterday": {
      const yesterday = addDays(todayStart, -1, tz);
      return { from: yesterday, to: todayStart, label: LABELS.yesterday };
    }
    case "last-7d": {
      const from = addDays(todayStart, -6, tz);
      return { from, to: tomorrowStart, label: LABELS["last-7d"] };
    }
    case "last-30d": {
      const from = addDays(todayStart, -29, tz);
      return { from, to: tomorrowStart, label: LABELS["last-30d"] };
    }
    case "this-month": {
      const from = utcFromLocalMidnight(todayCal.year, todayCal.month, 1, tz);
      const to = utcFromLocalMidnight(todayCal.year, todayCal.month + 1, 1, tz);
      return { from, to, label: LABELS["this-month"] };
    }
    case "last-month": {
      const from = utcFromLocalMidnight(todayCal.year, todayCal.month - 1, 1, tz);
      const to = utcFromLocalMidnight(todayCal.year, todayCal.month, 1, tz);
      return { from, to, label: LABELS["last-month"] };
    }
    case "this-year": {
      const from = utcFromLocalMidnight(todayCal.year, 1, 1, tz);
      const to = utcFromLocalMidnight(todayCal.year + 1, 1, 1, tz);
      return { from, to, label: LABELS["this-year"] };
    }
    case "all-time":
      return { from: new Date(0), to: now, label: LABELS["all-time"] };
    default:
      return { from: addDays(todayStart, -29, tz), to: tomorrowStart, label: LABELS["last-30d"] };
  }
}
```

- [ ] **Step 2: Run tests, expect pass**

Run in `bbs/`:

```bash
npm test
```

Expected: all tests pass. Total ~78 (60 prior + 18 timezone).

- [ ] **Step 3: Commit**

```bash
git add bbs/src/__tests__/timezone.test.ts bbs/src/lib/timezone.ts
git commit -m "feat: add pure timezone-aware range resolver"
```

---

## Task 3: CSV Serializer — Failing Tests

**Files:**
- Create: `bbs/src/__tests__/csv.test.ts`

- [ ] **Step 1: Create `bbs/src/__tests__/csv.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

const BOM = "﻿";
const CRLF = "\r\n";

describe("toCsv", () => {
  it("serializes headers and rows with CRLF and UTF-8 BOM", () => {
    const csv = toCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
    expect(csv).toBe(`${BOM}a,b${CRLF}1,2${CRLF}3,4${CRLF}`);
  });

  it("returns just BOM + headers when rows is empty", () => {
    const csv = toCsv(["x"], []);
    expect(csv).toBe(`${BOM}x${CRLF}`);
  });

  it("quotes fields containing commas", () => {
    const csv = toCsv(["a"], [["hello, world"]]);
    expect(csv).toBe(`${BOM}a${CRLF}"hello, world"${CRLF}`);
  });

  it('doubles embedded double quotes and wraps in quotes', () => {
    const csv = toCsv(["a"], [['she said "hi"']]);
    expect(csv).toBe(`${BOM}a${CRLF}"she said ""hi"""${CRLF}`);
  });

  it("quotes fields containing newlines", () => {
    const csv = toCsv(["a"], [["line1\nline2"]]);
    expect(csv).toBe(`${BOM}a${CRLF}"line1\nline2"${CRLF}`);
  });

  it("quotes fields containing carriage returns", () => {
    const csv = toCsv(["a"], [["line1\rline2"]]);
    expect(csv).toBe(`${BOM}a${CRLF}"line1\rline2"${CRLF}`);
  });

  it("does not quote plain alphanumeric fields", () => {
    const csv = toCsv(["a"], [["hello123"]]);
    expect(csv).toBe(`${BOM}a${CRLF}hello123${CRLF}`);
  });

  it("does not quote empty strings", () => {
    const csv = toCsv(["a", "b"], [["", "x"]]);
    expect(csv).toBe(`${BOM}a,b${CRLF},x${CRLF}`);
  });

  it("handles mixed-quoting rows correctly", () => {
    const csv = toCsv(
      ["name", "note"],
      [["Alice", "hi"], ["Bob, Jr.", "she said \"ok\""], ["Cara", ""]]
    );
    expect(csv).toBe(
      `${BOM}name,note${CRLF}Alice,hi${CRLF}"Bob, Jr.","she said ""ok"""${CRLF}Cara,${CRLF}`
    );
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run in `bbs/`:

```bash
npm test
```

Expected: FAIL with "Cannot find module '@/lib/csv'".

---

## Task 4: CSV Serializer — Implementation

**Files:**
- Create: `bbs/src/lib/csv.ts`

- [ ] **Step 1: Create `bbs/src/lib/csv.ts`**

```ts
const BOM = "﻿";
const CRLF = "\r\n";

function escapeField(value: string): string {
  if (value === "") return "";
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeField).join(",");
  const bodyLines = rows.map((row) => row.map(escapeField).join(","));
  const allLines = [headerLine, ...bodyLines];
  return BOM + allLines.join(CRLF) + CRLF;
}
```

- [ ] **Step 2: Run tests, expect pass**

Run in `bbs/`:

```bash
npm test
```

Expected: all tests pass. Total ~87 (78 prior + 9 csv).

- [ ] **Step 3: Commit**

```bash
git add bbs/src/__tests__/csv.test.ts bbs/src/lib/csv.ts
git commit -m "feat: add pure RFC 4180 CSV serializer with UTF-8 BOM"
```

---

## Task 5: Reports Data Module

**Files:**
- Create: `bbs/src/lib/reports.ts`

This module is Prisma-adjacent — it queries the DB but returns plain typed shapes. Not unit-tested (integration-tested by the manual smoke). Focus is correctness of the aggregation queries and cash-basis math.

- [ ] **Step 1: Create `bbs/src/lib/reports.ts`**

```ts
import { prisma } from "@/lib/prisma";
import type { PaymentMethod } from "@prisma/client";

export interface ReportRange {
  from: Date;
  to: Date;
}

export type Granularity = "daily" | "weekly" | "monthly";

// ────────────────────────────────────────────────────────────────
// 1. Revenue (bucketed)
// ────────────────────────────────────────────────────────────────

export interface RevenueBucket {
  label: string;
  startDate: Date;
  paymentsCents: number;
  refundsCents: number;
  netCents: number;
}

/**
 * Get calendar Y/M/D in a timezone.
 */
function calDate(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: g("year"), month: g("month"), day: g("day") };
}

function utcMidnight(y: number, m: number, d: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const cal = calDate(guess, tz);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(guess);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const min = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const diff = (cal.year - y) * 366 + (cal.month - m) * 31 + (cal.day - d);
    const shift = diff * 24 * 60 + h * 60 + min;
    if (shift === 0) break;
    guess = new Date(guess.getTime() - shift * 60_000);
  }
  return guess;
}

function bucketKey(d: Date, granularity: Granularity, tz: string): { key: string; startDate: Date; label: string } {
  const cal = calDate(d, tz);
  if (granularity === "daily") {
    const key = `${cal.year}-${String(cal.month).padStart(2, "0")}-${String(cal.day).padStart(2, "0")}`;
    return { key, startDate: utcMidnight(cal.year, cal.month, cal.day, tz), label: key };
  }
  if (granularity === "monthly") {
    const key = `${cal.year}-${String(cal.month).padStart(2, "0")}`;
    return { key, startDate: utcMidnight(cal.year, cal.month, 1, tz), label: key };
  }
  // weekly: bucket by Monday of the week (ISO)
  const dow = new Date(Date.UTC(cal.year, cal.month - 1, cal.day)).getUTCDay(); // 0=Sun
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const mondayStart = utcMidnight(cal.year, cal.month, cal.day + daysToMonday, tz);
  const monCal = calDate(mondayStart, tz);
  const key = `${monCal.year}-${String(monCal.month).padStart(2, "0")}-${String(monCal.day).padStart(2, "0")}`;
  return { key, startDate: mondayStart, label: `Wk ${key}` };
}

function enumerateBuckets(range: ReportRange, granularity: Granularity, tz: string): { key: string; startDate: Date; label: string }[] {
  const out: { key: string; startDate: Date; label: string }[] = [];
  const seen = new Set<string>();
  let cursor = new Date(range.from.getTime());
  while (cursor.getTime() < range.to.getTime()) {
    const b = bucketKey(cursor, granularity, tz);
    if (!seen.has(b.key)) {
      out.push(b);
      seen.add(b.key);
    }
    // advance by one day
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

export async function getRevenueReport(
  range: ReportRange,
  granularity: Granularity,
  tz: string
): Promise<RevenueBucket[]> {
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { paidAt: { gte: range.from, lt: range.to } },
      select: { amountCents: true, paidAt: true }
    }),
    prisma.refund.findMany({
      where: { refundedAt: { gte: range.from, lt: range.to } },
      select: { amountCents: true, refundedAt: true }
    })
  ]);

  const buckets = enumerateBuckets(range, granularity, tz);
  const paymentsByKey = new Map<string, number>();
  const refundsByKey = new Map<string, number>();

  for (const p of payments) {
    const key = bucketKey(p.paidAt, granularity, tz).key;
    paymentsByKey.set(key, (paymentsByKey.get(key) ?? 0) + p.amountCents);
  }
  for (const r of refunds) {
    const key = bucketKey(r.refundedAt, granularity, tz).key;
    refundsByKey.set(key, (refundsByKey.get(key) ?? 0) + r.amountCents);
  }

  return buckets.map((b) => {
    const pay = paymentsByKey.get(b.key) ?? 0;
    const ref = refundsByKey.get(b.key) ?? 0;
    return {
      label: b.label,
      startDate: b.startDate,
      paymentsCents: pay,
      refundsCents: ref,
      netCents: pay - ref
    };
  });
}

// ────────────────────────────────────────────────────────────────
// 2. Aging (snapshot)
// ────────────────────────────────────────────────────────────────

export interface AgingBucket {
  bucket: "Not yet due" | "1-30 days" | "31-60 days" | "61-90 days" | "90+ days";
  invoiceCount: number;
  balanceCents: number;
}

export async function getAgingReport(now: Date = new Date()): Promise<AgingBucket[]> {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["UNPAID", "PARTIAL"] } },
    select: { balanceCents: true, dueAt: true }
  });

  const buckets: Record<AgingBucket["bucket"], { count: number; total: number }> = {
    "Not yet due": { count: 0, total: 0 },
    "1-30 days": { count: 0, total: 0 },
    "31-60 days": { count: 0, total: 0 },
    "61-90 days": { count: 0, total: 0 },
    "90+ days": { count: 0, total: 0 }
  };

  for (const inv of invoices) {
    const ageMs = inv.dueAt ? now.getTime() - inv.dueAt.getTime() : -1;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    let key: AgingBucket["bucket"];
    if (ageDays < 1) key = "Not yet due";
    else if (ageDays <= 30) key = "1-30 days";
    else if (ageDays <= 60) key = "31-60 days";
    else if (ageDays <= 90) key = "61-90 days";
    else key = "90+ days";
    buckets[key].count += 1;
    buckets[key].total += inv.balanceCents;
  }

  return (Object.keys(buckets) as AgingBucket["bucket"][]).map((k) => ({
    bucket: k,
    invoiceCount: buckets[k].count,
    balanceCents: buckets[k].total
  }));
}

// ────────────────────────────────────────────────────────────────
// 3. Payment methods
// ────────────────────────────────────────────────────────────────

export interface PaymentMethodRow {
  method: PaymentMethod;
  count: number;
  amountCents: number;
  percentOfTotal: number;
}

export async function getPaymentMethodsReport(range: ReportRange): Promise<PaymentMethodRow[]> {
  const rows = await prisma.payment.groupBy({
    by: ["method"],
    where: { paidAt: { gte: range.from, lt: range.to } },
    _sum: { amountCents: true },
    _count: { _all: true }
  });
  const totalAmount = rows.reduce((s, r) => s + (r._sum.amountCents ?? 0), 0);
  return rows
    .map((r) => ({
      method: r.method,
      count: r._count._all,
      amountCents: r._sum.amountCents ?? 0,
      percentOfTotal: totalAmount === 0 ? 0 : ((r._sum.amountCents ?? 0) / totalAmount) * 100
    }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

// ────────────────────────────────────────────────────────────────
// 4. Taxes
// ────────────────────────────────────────────────────────────────

export interface TaxRateRow {
  taxRateId: string;
  name: string;
  ratePercent: string;
  taxableBaseCents: number;
  taxCents: number;
}

export async function getTaxesReport(range: ReportRange): Promise<TaxRateRow[]> {
  // Invoices with at least one payment in the range and status PAID or PARTIAL.
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["PAID", "PARTIAL"] },
      payments: { some: { paidAt: { gte: range.from, lt: range.to } } }
    },
    select: {
      id: true,
      taxCents: true,
      subtotalCents: true,
      discountCents: true,
      totalCents: true,
      paidCents: true,
      status: true,
      lines: { include: { taxRate: true } },
      payments: {
        where: { paidAt: { gte: range.from, lt: range.to } },
        select: { amountCents: true }
      }
    }
  });

  const byRate = new Map<string, TaxRateRow>();

  for (const inv of invoices) {
    // Determine the fraction of this invoice's totals attributable to the range.
    // PAID invoices with any payment in range → 100%.
    // PARTIAL invoices → proportional to (in-range payments / totalCents).
    const inRangePaid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
    const fraction =
      inv.status === "PAID" ? 1 : inv.totalCents === 0 ? 0 : inRangePaid / inv.totalCents;

    for (const line of inv.lines) {
      if (!line.taxRate) continue;
      const rateStr = line.taxRate.ratePercent.toString();
      const rate = Number(rateStr) / 100;
      const attributedLineTotal = line.lineTotalCents * fraction;
      const attributedTax = attributedLineTotal * rate;
      const key = line.taxRate.id;
      const prev = byRate.get(key) ?? {
        taxRateId: line.taxRate.id,
        name: line.taxRate.name,
        ratePercent: rateStr,
        taxableBaseCents: 0,
        taxCents: 0
      };
      prev.taxableBaseCents += Math.round(attributedLineTotal);
      prev.taxCents += Math.round(attributedTax);
      byRate.set(key, prev);
    }
  }

  return Array.from(byRate.values()).sort((a, b) => b.taxCents - a.taxCents);
}

// ────────────────────────────────────────────────────────────────
// 5. Discounts
// ────────────────────────────────────────────────────────────────

export interface DiscountRow {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  issuedAt: Date;
  invoiceDiscountCents: number;
  lineDiscountCents: number;
  totalDiscountCents: number;
}

export async function getDiscountsReport(range: ReportRange): Promise<DiscountRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["PAID", "PARTIAL", "REFUNDED"] },
      payments: { some: { paidAt: { gte: range.from, lt: range.to } } }
    },
    include: {
      customer: true,
      lines: true
    },
    orderBy: { issuedAt: "desc" }
  });

  return invoices
    .map((inv) => {
      const lineDisc = inv.lines.reduce((s, l) => {
        if (l.discountType === "NONE") return s;
        if (l.discountType === "FIXED") {
          return s + Math.min(Number(l.discountValue), l.unitPriceCents * Number(l.quantity));
        }
        // PERCENT
        const gross = l.unitPriceCents * Number(l.quantity);
        return s + Math.round(gross * (Number(l.discountValue) / 100));
      }, 0);
      const invDisc = inv.discountCents;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer.name,
        issuedAt: inv.issuedAt,
        invoiceDiscountCents: invDisc,
        lineDiscountCents: lineDisc,
        totalDiscountCents: invDisc + lineDisc
      };
    })
    .filter((row) => row.totalDiscountCents > 0);
}

// ────────────────────────────────────────────────────────────────
// 6. Refunds
// ────────────────────────────────────────────────────────────────

export interface RefundRow {
  refundedAt: Date;
  invoiceNumber: string;
  customerName: string;
  amountCents: number;
  reason: string;
  staffName: string;
}

export async function getRefundsReport(range: ReportRange): Promise<RefundRow[]> {
  const refunds = await prisma.refund.findMany({
    where: { refundedAt: { gte: range.from, lt: range.to } },
    include: {
      invoice: { include: { customer: true } },
      staff: { select: { name: true } }
    },
    orderBy: { refundedAt: "desc" }
  });
  return refunds.map((r) => ({
    refundedAt: r.refundedAt,
    invoiceNumber: r.invoice.invoiceNumber,
    customerName: r.invoice.customer.name,
    amountCents: r.amountCents,
    reason: r.reason,
    staffName: r.staff.name
  }));
}

// ────────────────────────────────────────────────────────────────
// 7. Top items
// ────────────────────────────────────────────────────────────────

export interface TopItemRow {
  catalogItemId: string | null;
  itemName: string;
  sku: string | null;
  qtySold: string;
  revenueCents: number;
}

export async function getTopItemsReport(range: ReportRange, limit: number = 20): Promise<TopItemRow[]> {
  const lines = await prisma.invoiceLine.findMany({
    where: {
      invoice: {
        status: { in: ["PAID", "PARTIAL", "REFUNDED"] },
        payments: { some: { paidAt: { gte: range.from, lt: range.to } } }
      }
    },
    include: { catalogItem: true }
  });

  const byItem = new Map<string, { name: string; sku: string | null; qty: number; revenue: number; id: string | null }>();
  for (const l of lines) {
    const key = l.catalogItemId ?? "__uncategorized__";
    const name = l.catalogItem?.name ?? l.description;
    const sku = l.catalogItem?.sku ?? null;
    const prev = byItem.get(key) ?? { name, sku, qty: 0, revenue: 0, id: l.catalogItemId };
    prev.qty += Number(l.quantity);
    prev.revenue += l.lineTotalCents;
    byItem.set(key, prev);
  }

  return Array.from(byItem.values())
    .map((v) => ({
      catalogItemId: v.id,
      itemName: v.name,
      sku: v.sku,
      qtySold: v.qty.toString(),
      revenueCents: v.revenue
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, limit);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/lib/reports.ts
git commit -m "feat: add seven report data functions (cash-basis, TZ-aware bucketing)"
```

---

## Task 6: Revenue Chart Component

**Files:**
- Create: `bbs/src/components/charts/RevenueChart.tsx`

- [ ] **Step 1: Create `bbs/src/components/charts/RevenueChart.tsx`**

```tsx
import { formatUSD } from "@/lib/money";

interface Bucket {
  label: string;
  valueCents: number;
}

interface Props {
  buckets: Bucket[];
  variant: "compact" | "full";
  totalLabel: string;
  rangeLabel: string;
  granularity?: "daily" | "weekly" | "monthly";
}

export function RevenueChart({ buckets, variant, totalLabel, rangeLabel, granularity }: Props) {
  const maxValue = Math.max(1, ...buckets.map((b) => b.valueCents));
  const hasData = buckets.some((b) => b.valueCents > 0);
  const width = 360;
  const height = variant === "compact" ? 140 : 220;
  const barGap = 4;
  const barWidth = buckets.length > 0 ? (width - barGap * (buckets.length + 1)) / buckets.length : 0;

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-muted text-[10px] uppercase tracking-widest">Revenue</div>
          <div className="text-gold text-2xl font-bold tabular mt-1">{totalLabel}</div>
          <div className="text-muted text-xs mt-1">{rangeLabel}</div>
        </div>
        {variant === "full" && granularity && (
          <div className="text-muted text-[10px] uppercase tracking-widest">
            {granularity}
          </div>
        )}
      </div>

      {hasData ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block" role="img" aria-label={`Revenue chart, ${rangeLabel}`}>
            {/* Gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <line
                key={frac}
                x1="0"
                y1={height * frac}
                x2={width}
                y2={height * frac}
                stroke="#2A2A2A"
                strokeWidth="0.5"
                strokeDasharray={frac === 1 ? undefined : "2 2"}
              />
            ))}
            {/* Bars */}
            {buckets.map((b, i) => {
              const barHeight = b.valueCents === 0 ? 4 : Math.max(2, (b.valueCents / maxValue) * (height - 8));
              const x = barGap + i * (barWidth + barGap);
              const y = height - barHeight;
              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="#D4B44A"
                  opacity={b.valueCents === 0 ? 0.3 : 1}
                >
                  <title>{`${b.label}: ${formatUSD(b.valueCents)}`}</title>
                </rect>
              );
            })}
          </svg>
          {buckets.length > 0 && (
            <div className="flex justify-between text-muted text-[10px] mt-2">
              <span>{buckets[0]?.label}</span>
              <span>{buckets[buckets.length - 1]?.label}</span>
            </div>
          )}
        </>
      ) : (
        <div className="text-muted text-sm text-center py-12">No revenue in this range yet.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/components/charts/RevenueChart.tsx
git commit -m "feat: add pure-SVG RevenueChart with compact/full variants"
```

---

## Task 7: Date Range Picker Component

**Files:**
- Create: `bbs/src/components/reports/DateRangePicker.tsx`

- [ ] **Step 1: Create `bbs/src/components/reports/DateRangePicker.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const PRESETS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last-7d", label: "Last 7 days" },
  { value: "last-30d", label: "Last 30 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
  { value: "all-time", label: "All time" },
  { value: "custom", label: "Custom" }
];

const GRANULARITY: { value: string; label: string; defaultRange: string }[] = [
  { value: "daily", label: "Daily", defaultRange: "last-30d" },
  { value: "weekly", label: "Weekly", defaultRange: "last-7d" },
  { value: "monthly", label: "Monthly", defaultRange: "this-year" }
];

export function DateRangePicker() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const range = params.get("range") ?? "last-30d";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const granularity = params.get("granularity") ?? "daily";

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => {
      router.push(`/reports?${next.toString()}`);
    });
  }

  function onRangeChange(newRange: string) {
    if (newRange === "custom") {
      updateParams({ range: "custom" });
    } else {
      updateParams({ range: newRange, from: null, to: null });
    }
  }

  function onGranularityChange(newGran: string) {
    const preset = GRANULARITY.find((g) => g.value === newGran);
    // Only auto-adjust range if not custom
    if (range !== "custom" && preset) {
      updateParams({ granularity: newGran, range: preset.defaultRange });
    } else {
      updateParams({ granularity: newGran });
    }
  }

  return (
    <div className="sticky top-0 z-10 bg-bg py-3 flex flex-wrap items-center gap-3 border-b border-border">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Range</span>
        <select
          value={range}
          onChange={(e) => onRangeChange(e.target.value)}
          disabled={isPending}
          className="h-9 px-2 rounded bg-surface-raised border border-border text-text text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {range === "custom" && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => updateParams({ from: e.target.value })}
              disabled={isPending}
              className="h-9 px-2 rounded bg-surface-raised border border-border text-text text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => updateParams({ to: e.target.value })}
              disabled={isPending}
              className="h-9 px-2 rounded bg-surface-raised border border-border text-text text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </label>
        </>
      )}

      <div className="ml-auto flex gap-0 border border-border rounded overflow-hidden">
        {GRANULARITY.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => onGranularityChange(g.value)}
            disabled={isPending}
            className={
              "px-3 h-9 text-xs font-medium transition-colors " +
              (granularity === g.value
                ? "bg-gold text-bg"
                : "bg-surface-raised text-text hover:bg-surface")
            }
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/components/reports/DateRangePicker.tsx
git commit -m "feat: add URL-driven DateRangePicker with granularity toggle"
```

---

## Task 8: Report Section Wrapper Component

**Files:**
- Create: `bbs/src/components/reports/ReportSection.tsx`

- [ ] **Step 1: Create `bbs/src/components/reports/ReportSection.tsx`**

```tsx
import Link from "next/link";

interface Props {
  title: string;
  subtitle?: string;
  totalLabel?: string;
  csvHref?: string;
  children: React.ReactNode;
}

export function ReportSection({ title, subtitle, totalLabel, csvHref, children }: Props) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-baseline gap-3">
          {totalLabel && (
            <span className="text-gold text-2xl font-bold tabular">{totalLabel}</span>
          )}
          {csvHref && (
            <Link
              href={csvHref}
              className="text-xs px-3 h-9 flex items-center rounded bg-surface-raised border border-border text-text hover:bg-surface"
            >
              Export CSV
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add bbs/src/components/reports/ReportSection.tsx
git commit -m "feat: add ReportSection wrapper for reports page layout"
```

---

## Task 9: Reports Page — Server Component

**Files:**
- Create: `bbs/src/app/(app)/reports/page.tsx`

- [ ] **Step 1: Create `bbs/src/app/(app)/reports/page.tsx`**

```tsx
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";
import { resolveRange } from "@/lib/timezone";
import {
  getRevenueReport,
  getAgingReport,
  getPaymentMethodsReport,
  getTaxesReport,
  getDiscountsReport,
  getRefundsReport,
  getTopItemsReport,
  type Granularity
} from "@/lib/reports";
import { RevenueChart } from "@/components/charts/RevenueChart";
import { DateRangePicker } from "@/components/reports/DateRangePicker";
import { ReportSection } from "@/components/reports/ReportSection";

function buildCsvHref(base: string, searchParams: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function ReportsPage({
  searchParams
}: {
  searchParams: { range?: string; from?: string; to?: string; granularity?: string };
}) {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);

  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone ?? "America/New_York";
  const now = new Date();

  const resolved = resolveRange(searchParams, tz, now);
  if ("error" in resolved) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <DateRangePicker />
        <div
          role="alert"
          className="mt-4 text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
        >
          Invalid date range. Please pick a valid From and To.
        </div>
      </div>
    );
  }

  const granularity: Granularity =
    searchParams.granularity === "weekly" || searchParams.granularity === "monthly"
      ? searchParams.granularity
      : "daily";

  const [revenue, aging, methods, taxes, discounts, refunds, topItems] = await Promise.all([
    getRevenueReport(resolved, granularity, tz),
    getAgingReport(now),
    getPaymentMethodsReport(resolved),
    getTaxesReport(resolved),
    getDiscountsReport(resolved),
    getRefundsReport(resolved),
    getTopItemsReport(resolved, 20)
  ]);

  const totalRevenue = revenue.reduce((s, b) => s + b.netCents, 0);
  const totalOutstanding = aging.reduce((s, b) => s + b.balanceCents, 0);
  const totalPayments = methods.reduce((s, m) => s + m.amountCents, 0);
  const totalTax = taxes.reduce((s, t) => s + t.taxCents, 0);
  const totalDiscounts = discounts.reduce((s, d) => s + d.totalDiscountCents, 0);
  const totalRefunds = refunds.reduce((s, r) => s + r.amountCents, 0);
  const distinctItems = topItems.length;

  const csvParams: Record<string, string | undefined> = {
    range: searchParams.range,
    from: searchParams.from,
    to: searchParams.to,
    granularity: searchParams.granularity
  };

  return (
    <div>
      <div className="mb-2">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted mt-1">{resolved.label}</p>
      </div>

      <DateRangePicker />

      <div className="mt-6">
        <RevenueChart
          buckets={revenue.map((r) => ({ label: r.label, valueCents: r.netCents }))}
          variant="full"
          totalLabel={formatUSD(totalRevenue)}
          rangeLabel={resolved.label}
          granularity={granularity}
        />
      </div>

      {/* Revenue table */}
      <ReportSection
        title="Revenue"
        subtitle={`${revenue.length} ${granularity === "daily" ? "days" : granularity === "weekly" ? "weeks" : "months"}`}
        totalLabel={formatUSD(totalRevenue)}
        csvHref={buildCsvHref("/reports/revenue.csv", csvParams)}
      >
        {revenue.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No revenue in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Payments</th>
                  <th className="text-right px-4 py-3">Refunds</th>
                  <th className="text-right px-4 py-3">Net</th>
                </tr>
              </thead>
              <tbody>
                {revenue.map((b) => (
                  <tr key={b.label} className="border-t border-border">
                    <td className="px-4 py-2 text-text font-mono text-xs">{b.label}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(b.paymentsCents)}</td>
                    <td className="px-4 py-2 text-right text-danger-bright tabular">
                      {b.refundsCents > 0 ? `-${formatUSD(b.refundsCents)}` : "$0.00"}
                    </td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(b.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Aging (snapshot, ignores range) */}
      <ReportSection
        title="Paid vs Outstanding"
        subtitle={`As of ${now.toISOString().slice(0, 10)}`}
        totalLabel={formatUSD(totalOutstanding)}
        csvHref={buildCsvHref("/reports/aging.csv", csvParams)}
      >
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised text-muted uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Aging bucket</th>
                <th className="text-right px-4 py-3">Invoices</th>
                <th className="text-right px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((a) => (
                <tr key={a.bucket} className="border-t border-border">
                  <td className="px-4 py-2 text-text">{a.bucket}</td>
                  <td className="px-4 py-2 text-right text-text tabular">{a.invoiceCount}</td>
                  <td className="px-4 py-2 text-right text-text tabular">{formatUSD(a.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>

      {/* Payment methods */}
      <ReportSection
        title="Payment methods"
        subtitle={`${methods.length} method${methods.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalPayments)}
        csvHref={buildCsvHref("/reports/payment-methods.csv", csvParams)}
      >
        {methods.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No payments in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Method</th>
                  <th className="text-right px-4 py-3">Count</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-right px-4 py-3">% of total</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((m) => (
                  <tr key={m.method} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{m.method}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{m.count}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(m.amountCents)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{m.percentOfTotal.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Taxes */}
      <ReportSection
        title="Taxes collected"
        subtitle={`${taxes.length} rate${taxes.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalTax)}
        csvHref={buildCsvHref("/reports/taxes.csv", csvParams)}
      >
        {taxes.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No taxable payments in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Tax rate</th>
                  <th className="text-right px-4 py-3">Rate</th>
                  <th className="text-right px-4 py-3">Taxable base</th>
                  <th className="text-right px-4 py-3">Tax collected</th>
                </tr>
              </thead>
              <tbody>
                {taxes.map((t) => (
                  <tr key={t.taxRateId} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{t.name}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{t.ratePercent}%</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(t.taxableBaseCents)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(t.taxCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Discounts */}
      <ReportSection
        title="Discounts issued"
        subtitle={`${discounts.length} invoice${discounts.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalDiscounts)}
        csvHref={buildCsvHref("/reports/discounts.csv", csvParams)}
      >
        {discounts.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No discounts issued in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Invoice</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Invoice disc.</th>
                  <th className="text-right px-4 py-3">Line disc.</th>
                  <th className="text-right px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.invoiceId} className="border-t border-border">
                    <td className="px-4 py-2 text-gold font-mono text-xs">{d.invoiceNumber}</td>
                    <td className="px-4 py-2 text-text">{d.customerName}</td>
                    <td className="px-4 py-2 text-text">{d.issuedAt.toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(d.invoiceDiscountCents)}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(d.lineDiscountCents)}</td>
                    <td className="px-4 py-2 text-right text-gold tabular">{formatUSD(d.totalDiscountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Refunds */}
      <ReportSection
        title="Refunds & voids"
        subtitle={`${refunds.length} refund${refunds.length === 1 ? "" : "s"}`}
        totalLabel={formatUSD(totalRefunds)}
        csvHref={buildCsvHref("/reports/refunds.csv", csvParams)}
      >
        {refunds.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No refunds in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Invoice</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-left px-4 py-3">Reason</th>
                  <th className="text-left px-4 py-3">Staff</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{r.refundedAt.toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 text-gold font-mono text-xs">{r.invoiceNumber}</td>
                    <td className="px-4 py-2 text-text">{r.customerName}</td>
                    <td className="px-4 py-2 text-right text-danger-bright tabular">
                      {formatUSD(r.amountCents)}
                    </td>
                    <td className="px-4 py-2 text-muted text-xs">{r.reason}</td>
                    <td className="px-4 py-2 text-muted">{r.staffName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Top items */}
      <ReportSection
        title="Top products & services"
        subtitle={`${distinctItems} item${distinctItems === 1 ? "" : "s"} sold`}
        csvHref={buildCsvHref("/reports/top-items.csv", csvParams)}
      >
        {topItems.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
            No items sold in this range.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-muted uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-left px-4 py-3">SKU</th>
                  <th className="text-right px-4 py-3">Qty sold</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((t) => (
                  <tr key={t.catalogItemId ?? t.itemName} className="border-t border-border">
                    <td className="px-4 py-2 text-text">{t.itemName}</td>
                    <td className="px-4 py-2 text-muted font-mono text-xs">{t.sku ?? "—"}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{t.qtySold}</td>
                    <td className="px-4 py-2 text-right text-text tabular">{formatUSD(t.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add "bbs/src/app/(app)/reports/page.tsx"
git commit -m "feat: add /reports page with seven cash-basis report sections"
```

---

## Task 10: CSV Route Helper

**Files:**
- Create: `bbs/src/lib/reports-csv.ts`

Shared helper that the seven CSV routes use to build the response.

- [ ] **Step 1: Create `bbs/src/lib/reports-csv.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { resolveRange, type ResolvedRange } from "@/lib/timezone";
import { toCsv } from "@/lib/csv";
import { fromCents } from "@/lib/money";

export interface CsvRouteContext {
  range: ResolvedRange;
  tz: string;
  granularity: "daily" | "weekly" | "monthly";
  searchParams: URLSearchParams;
}

export async function loadCsvContext(request: Request): Promise<
  { ok: true; ctx: CsvRouteContext } | { ok: false; response: NextResponse }
> {
  await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const url = new URL(request.url);
  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone ?? "America/New_York";

  const params = {
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined
  };
  const resolved = resolveRange(params, tz);
  if ("error" in resolved) {
    return { ok: false, response: new NextResponse("Invalid date range", { status: 400 }) };
  }

  const rawGran = url.searchParams.get("granularity");
  const granularity: "daily" | "weekly" | "monthly" =
    rawGran === "weekly" || rawGran === "monthly" ? rawGran : "daily";

  return { ok: true, ctx: { range: resolved, tz, granularity, searchParams: url.searchParams } };
}

export function csvResponse(reportName: string, ctx: CsvRouteContext, csv: string): NextResponse {
  const fromStr = ctx.range.from.toISOString().slice(0, 10);
  const toStr = new Date(ctx.range.to.getTime() - 1).toISOString().slice(0, 10);
  const filename = `bbs-${reportName}-${fromStr}_to_${toStr}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store"
    }
  });
}

export { toCsv, fromCents };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bbs/src/lib/reports-csv.ts
git commit -m "feat: add shared CSV route helper for /reports/*.csv endpoints"
```

---

## Task 11: CSV Routes (all seven, one commit)

**Files:**
- Create: `bbs/src/app/(app)/reports/revenue.csv/route.ts`
- Create: `bbs/src/app/(app)/reports/aging.csv/route.ts`
- Create: `bbs/src/app/(app)/reports/payment-methods.csv/route.ts`
- Create: `bbs/src/app/(app)/reports/taxes.csv/route.ts`
- Create: `bbs/src/app/(app)/reports/discounts.csv/route.ts`
- Create: `bbs/src/app/(app)/reports/refunds.csv/route.ts`
- Create: `bbs/src/app/(app)/reports/top-items.csv/route.ts`

- [ ] **Step 1: Create `bbs/src/app/(app)/reports/revenue.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getRevenueReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getRevenueReport(ctx.range, ctx.granularity, ctx.tz);
  const csv = toCsv(
    ["Date", "Payments", "Refunds", "Net"],
    rows.map((r) => [
      r.label,
      fromCents(r.paymentsCents),
      fromCents(r.refundsCents),
      fromCents(r.netCents)
    ])
  );
  return csvResponse("revenue", ctx, csv);
}
```

- [ ] **Step 2: Create `bbs/src/app/(app)/reports/aging.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getAgingReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getAgingReport(new Date());
  const csv = toCsv(
    ["Aging bucket", "Invoice count", "Balance"],
    rows.map((r) => [r.bucket, r.invoiceCount.toString(), fromCents(r.balanceCents)])
  );
  return csvResponse("aging", ctx, csv);
}
```

- [ ] **Step 3: Create `bbs/src/app/(app)/reports/payment-methods.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getPaymentMethodsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getPaymentMethodsReport(ctx.range);
  const csv = toCsv(
    ["Method", "Count", "Amount", "Percent of total"],
    rows.map((r) => [
      r.method,
      r.count.toString(),
      fromCents(r.amountCents),
      r.percentOfTotal.toFixed(2)
    ])
  );
  return csvResponse("payment-methods", ctx, csv);
}
```

- [ ] **Step 4: Create `bbs/src/app/(app)/reports/taxes.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getTaxesReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getTaxesReport(ctx.range);
  const csv = toCsv(
    ["Tax rate", "Rate percent", "Taxable base", "Tax collected"],
    rows.map((r) => [
      r.name,
      r.ratePercent,
      fromCents(r.taxableBaseCents),
      fromCents(r.taxCents)
    ])
  );
  return csvResponse("taxes", ctx, csv);
}
```

- [ ] **Step 5: Create `bbs/src/app/(app)/reports/discounts.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getDiscountsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getDiscountsReport(ctx.range);
  const csv = toCsv(
    ["Invoice number", "Customer", "Issued", "Invoice discount", "Line discounts", "Total discount"],
    rows.map((r) => [
      r.invoiceNumber,
      r.customerName,
      r.issuedAt.toISOString().slice(0, 10),
      fromCents(r.invoiceDiscountCents),
      fromCents(r.lineDiscountCents),
      fromCents(r.totalDiscountCents)
    ])
  );
  return csvResponse("discounts", ctx, csv);
}
```

- [ ] **Step 6: Create `bbs/src/app/(app)/reports/refunds.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getRefundsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getRefundsReport(ctx.range);
  const csv = toCsv(
    ["Date", "Invoice number", "Customer", "Amount", "Reason", "Staff"],
    rows.map((r) => [
      r.refundedAt.toISOString().slice(0, 10),
      r.invoiceNumber,
      r.customerName,
      fromCents(r.amountCents),
      r.reason,
      r.staffName
    ])
  );
  return csvResponse("refunds", ctx, csv);
}
```

- [ ] **Step 7: Create `bbs/src/app/(app)/reports/top-items.csv/route.ts`**

```ts
import { csvResponse, fromCents, loadCsvContext, toCsv } from "@/lib/reports-csv";
import { getTopItemsReport } from "@/lib/reports";

export async function GET(request: Request) {
  const loaded = await loadCsvContext(request);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const rows = await getTopItemsReport(ctx.range, 20);
  const csv = toCsv(
    ["Item", "SKU", "Quantity sold", "Revenue"],
    rows.map((r) => [
      r.itemName,
      r.sku ?? "",
      r.qtySold,
      fromCents(r.revenueCents)
    ])
  );
  return csvResponse("top-items", ctx, csv);
}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add "bbs/src/app/(app)/reports/"
git commit -m "feat: add seven CSV export routes for reports"
```

---

## Task 12: Dashboard Chart Integration

**Files:**
- Modify: `bbs/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Replace `bbs/src/app/(app)/dashboard/page.tsx` with this exact content**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole, Role } from "@/lib/permissions";
import { formatUSD } from "@/lib/money";
import { getRevenueReport } from "@/lib/reports";
import { RevenueChart } from "@/components/charts/RevenueChart";

export default async function DashboardPage() {
  const user = await requireRole(Role.ADMIN, Role.STAFF, Role.VIEWER);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const settings = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  const tz = settings?.timezone ?? "America/New_York";

  // 30-day range for the chart, ending at now
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [todaysPaid, outstandingAgg, completedCount, overdueCount, chartData] =
    await Promise.all([
      prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { paidAt: { gte: startOfDay } }
      }),
      prisma.invoice.aggregate({
        _sum: { balanceCents: true },
        where: { status: { in: ["UNPAID", "PARTIAL"] } }
      }),
      prisma.invoice.count({ where: { status: "PAID" } }),
      prisma.invoice.count({
        where: {
          status: { in: ["UNPAID", "PARTIAL"] },
          dueAt: { lt: now }
        }
      }),
      getRevenueReport({ from: thirtyDaysAgo, to: now }, "daily", tz)
    ]);

  const kpis = [
    { label: "Today's Revenue", value: formatUSD(todaysPaid._sum.amountCents ?? 0) },
    { label: "Outstanding", value: formatUSD(outstandingAgg._sum.balanceCents ?? 0) },
    { label: "Completed", value: String(completedCount) },
    { label: "Overdue", value: String(overdueCount) }
  ];

  const totalChart = chartData.reduce((s, b) => s + b.netCents, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Dashboard</h1>
        <p className="text-sm text-muted mt-1">Welcome back, {user.name ?? "there"}.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-surface border border-border rounded-lg p-5">
            <div className="text-xs text-muted uppercase tracking-wide">{kpi.label}</div>
            <div className="mt-2 text-2xl font-semibold text-gold tabular">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <RevenueChart
          buckets={chartData.map((b) => ({ label: b.label, valueCents: b.netCents }))}
          variant="compact"
          totalLabel={formatUSD(totalChart)}
          rangeLabel="Last 30 days"
        />
        <div className="text-right mt-2">
          <Link href="/reports" className="text-xs text-muted hover:text-text underline">
            View full reports →
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run in `bbs/`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add "bbs/src/app/(app)/dashboard/page.tsx"
git commit -m "feat: add compact revenue chart to dashboard with link to full reports"
```

---

## Task 13: End-to-End Phase 4 Verification

- [ ] **Step 1: Run all unit tests**

Run in `bbs/`:

```bash
npm test
```

Expected: ~87 tests pass (60 prior + 18 timezone + 9 csv).

- [ ] **Step 2: Clean stale `.next` and build**

Run in `bbs/`:

```bash
rm -rf .next 2>/dev/null; npm run build
```

Expected: build succeeds; new routes appear in the summary:
- `/reports`
- `/reports/revenue.csv`
- `/reports/aging.csv`
- `/reports/payment-methods.csv`
- `/reports/taxes.csv`
- `/reports/discounts.csv`
- `/reports/refunds.csv`
- `/reports/top-items.csv`

- [ ] **Step 3: Start the dev server**

Run in `bbs/`:

```bash
npm run dev
```

- [ ] **Step 4: Sign in and load /reports**

Sign in as `admin@bricebeauty.example` / `admin1234`. Visit `/reports`.

Expected:
- Sticky filter bar at top with preset dropdown (defaults to "Last 30 days"), granularity toggle showing "Daily" active
- Revenue chart shows bars for the days with payments (from prior smoke data)
- Seven report sections all render with expected data

- [ ] **Step 5: Toggle granularity to Weekly**

Click "Weekly" in the granularity pill. URL should update to `?range=last-7d&granularity=weekly` (auto-adjusted range from the preset table). Chart re-buckets by week.

- [ ] **Step 6: Switch to Custom range**

Choose "Custom" from the preset dropdown. Enter `from` and `to` dates spanning the smoke-data payments. All sections filter to that range.

- [ ] **Step 7: Test invalid range**

With "Custom" selected, set `from` to a date after `to`. Expected: red "Invalid date range" banner replaces the report sections.

- [ ] **Step 8: Download CSVs**

For each section, click "Export CSV". Verify:
- File downloads with name `bbs-{report}-{from}_to_{to}.csv`
- File opens cleanly in a text viewer with UTF-8 BOM
- First row is column headers
- Money is plain dollar strings (`154.72`, no `$`)
- Dates are `YYYY-MM-DD`

For revenue CSV, verify with:

```bash
curl -s -b /tmp/cj "http://localhost:3000/reports/revenue.csv?range=last-30d&granularity=daily" -o /tmp/revenue.csv -w "%{http_code} %{content_type}\n"
head -c 3 /tmp/revenue.csv | xxd | head -1     # should show EF BB BF (UTF-8 BOM)
head -5 /tmp/revenue.csv
```

Expected: `200 text/csv; charset=utf-8`, BOM present, header row is `Date,Payments,Refunds,Net`.

- [ ] **Step 9: Load /dashboard**

Visit `/dashboard`. Verify:
- Existing 4 KPI cards still present
- Compact revenue chart below shows 30-day daily bars
- "View full reports →" link at bottom-right of the chart card links to `/reports`

- [ ] **Step 10: VIEWER role access**

Sign in as `viewer@bricebeauty.example` / `viewer1234` (created in Phase 3 smoke). Verify:
- `/reports` loads (VIEWER has report access)
- All CSVs download successfully
- Cannot open Record Payment / Void / Refund modals from any invoice page

- [ ] **Step 11: Stop dev server, commit any stragglers**

```bash
ps -ef | grep "next-server\|next dev" | grep -v grep | awk '{print $2}' | xargs -r kill
git status
```

If any files were unintentionally modified (build output should be in `.next/` which is gitignored), review and commit or discard.

---

## Phase 4 Done When

- `npm test` passes 87 tests
- `npm run build` completes; 8 new routes appear in the route summary
- `/reports` shows all seven sections + revenue chart, driven by URL params
- Date-range presets and custom range work; DST-safe
- Granularity toggle auto-adjusts range and re-buckets the chart + revenue table
- Invalid custom ranges show a banner
- Every CSV downloads with UTF-8 BOM, RFC 4180 quoting, plain-number money
- Dashboard has a compact 30-day chart with a link to /reports
- VIEWER can access reports and download CSVs; mutating actions remain gated
- 12 commits on the branch (final count depends on whether Task 11 lands as one commit or spreads across smaller ones — plan bundles into one)

Commits list:

1. feat: add pure timezone-aware range resolver
2. feat: add pure RFC 4180 CSV serializer with UTF-8 BOM
3. feat: add seven report data functions (cash-basis, TZ-aware bucketing)
4. feat: add pure-SVG RevenueChart with compact/full variants
5. feat: add URL-driven DateRangePicker with granularity toggle
6. feat: add ReportSection wrapper for reports page layout
7. feat: add /reports page with seven cash-basis report sections
8. feat: add shared CSV route helper for /reports/*.csv endpoints
9. feat: add seven CSV export routes for reports
10. feat: add compact revenue chart to dashboard with link to full reports

---

## What Phase 5 Will Build On

- `lib/timezone.ts` — reused when Settings lets users change timezone (needs to invalidate report caches, if any)
- `lib/csv.ts` — reused for the audit-log CSV export in Phase 5
- `lib/reports.ts` — Settings will surface any tax rate that appears in taxes report
- `RevenueChart` — reusable if Phase 5 adds a customer-detail revenue mini-chart
- `DateRangePicker` — reusable for the audit-log viewer's date filter
