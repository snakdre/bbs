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
