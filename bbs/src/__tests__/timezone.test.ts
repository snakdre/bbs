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
