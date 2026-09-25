import { describe, it, expect } from "vitest";
import { deriveDisplayStatus } from "@/lib/status";
import type { InvoiceStatus } from "@prisma/client";

const NOW = new Date("2026-09-24T12:00:00Z");
const YESTERDAY = new Date("2026-09-23T12:00:00Z");
const TOMORROW = new Date("2026-09-25T12:00:00Z");

function derive(status: InvoiceStatus, dueAt: Date | null) {
  return deriveDisplayStatus({ status, dueAt }, NOW);
}

describe("deriveDisplayStatus", () => {
  it("returns OVERDUE for UNPAID with past dueAt", () => {
    expect(derive("UNPAID", YESTERDAY)).toBe("OVERDUE");
  });

  it("returns OVERDUE for PARTIAL with past dueAt", () => {
    expect(derive("PARTIAL", YESTERDAY)).toBe("OVERDUE");
  });

  it("keeps UNPAID when dueAt is future", () => {
    expect(derive("UNPAID", TOMORROW)).toBe("UNPAID");
  });

  it("keeps UNPAID when dueAt is null", () => {
    expect(derive("UNPAID", null)).toBe("UNPAID");
  });

  it("keeps PARTIAL when dueAt is future", () => {
    expect(derive("PARTIAL", TOMORROW)).toBe("PARTIAL");
  });

  it("keeps PARTIAL when dueAt is null", () => {
    expect(derive("PARTIAL", null)).toBe("PARTIAL");
  });

  it("does not overdue DRAFT even with past dueAt", () => {
    expect(derive("DRAFT", YESTERDAY)).toBe("DRAFT");
  });

  it("does not overdue PAID even with past dueAt", () => {
    expect(derive("PAID", YESTERDAY)).toBe("PAID");
  });

  it("does not overdue VOID even with past dueAt", () => {
    expect(derive("VOID", YESTERDAY)).toBe("VOID");
  });

  it("does not overdue REFUNDED even with past dueAt", () => {
    expect(derive("REFUNDED", YESTERDAY)).toBe("REFUNDED");
  });

  it("does not overdue OVERDUE input (pass-through)", () => {
    // OVERDUE never gets written to the DB, but the function should be a no-op if it is.
    expect(derive("OVERDUE", YESTERDAY)).toBe("OVERDUE");
  });

  it("uses new Date() when no now is supplied", () => {
    // Just verify the function runs without throwing when now defaults.
    expect(deriveDisplayStatus({ status: "UNPAID", dueAt: null })).toBe("UNPAID");
  });
});
