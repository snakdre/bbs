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
