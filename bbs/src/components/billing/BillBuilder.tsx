"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { computeInvoiceTotals } from "@/lib/billing";
import { toCents } from "@/lib/money";
import type { DiscountInput, LineInput } from "@/lib/billing-types";
import { CustomerPicker, type PickedCustomer } from "./CustomerPicker";
import { CatalogPicker, type CatalogPick } from "./CatalogPicker";
import { DiscountPicker, type DiscountValue } from "./DiscountPicker";
import { LineItemRow, type DraftLine } from "./LineItemRow";
import { TotalsPanel } from "./TotalsPanel";
import { PaymentModal } from "./PaymentModal";
import { createDraftBill } from "@/actions/bills";

interface Props {
  taxRates: { id: string; name: string; ratePercent: string }[];
  defaultTaxRateId: string | null;
}

function makeKey() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyDiscount(): DiscountValue {
  return { kind: "NONE", value: "0" };
}

function safeToCents(s: string): number {
  try {
    return toCents(s);
  } catch {
    return 0;
  }
}

function toEngineLine(
  line: DraftLine,
  taxPercentById: Map<string, number>
): LineInput {
  const qty = Number(line.quantity);
  const discount: DiscountInput =
    line.discount.kind === "NONE"
      ? { kind: "NONE", value: 0 }
      : line.discount.kind === "PERCENT"
      ? { kind: "PERCENT", value: Number(line.discount.value) || 0 }
      : { kind: "FIXED", value: safeToCents(line.discount.value) };
  return {
    unitPriceCents: safeToCents(line.unitPrice),
    quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
    discount,
    taxRatePercent: line.taxRateId ? taxPercentById.get(line.taxRateId) ?? 0 : 0
  };
}

export function BillBuilder({ taxRates, defaultTaxRateId }: Props) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState<DiscountValue>(emptyDiscount());
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [chargeAfterSave, setChargeAfterSave] = useState<{
    id: string;
    invoiceNumber: string;
    balanceCents: number;
  } | null>(null);

  const taxPercentById = useMemo(
    () => new Map(taxRates.map((t) => [t.id, Number(t.ratePercent)])),
    [taxRates]
  );

  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        lines.map((l) => toEngineLine(l, taxPercentById)),
        invoiceDiscount.kind === "NONE"
          ? { kind: "NONE", value: 0 }
          : invoiceDiscount.kind === "PERCENT"
          ? { kind: "PERCENT", value: Number(invoiceDiscount.value) || 0 }
          : { kind: "FIXED", value: safeToCents(invoiceDiscount.value) }
      ),
    [lines, invoiceDiscount, taxPercentById]
  );

  function addBlankLine() {
    setLines((prev) => [
      ...prev,
      {
        key: makeKey(),
        catalogItemId: null,
        description: "",
        quantity: "1",
        unitPrice: "0.00",
        discount: emptyDiscount(),
        taxRateId: defaultTaxRateId
      }
    ]);
  }

  function addCatalogLine(pick: CatalogPick) {
    setLines((prev) => [
      ...prev,
      {
        key: makeKey(),
        catalogItemId: pick.id,
        description: pick.name,
        quantity: "1",
        unitPrice: pick.unitPrice,
        discount: emptyDiscount(),
        taxRateId: pick.taxRateId
      }
    ]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function canSubmit(): boolean {
    if (!customer) return false;
    if (lines.length === 0) return false;
    if (lines.some((l) => !l.description.trim())) return false;
    return true;
  }

  function submit(mode: "draft" | "charge") {
    setBanner(null);
    if (!canSubmit() || !customer) {
      setBanner("Add a customer and at least one line item.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await createDraftBill({
          customerId: customer.id,
          lines: lines.map((l) => ({
            catalogItemId: l.catalogItemId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
            taxRateId: l.taxRateId
          })),
          invoiceDiscount,
          notes: notes.trim() ? notes.trim() : null,
          dueAt: dueAt ? dueAt : null,
          chargeImmediately: mode === "charge"
        });
        if (mode === "charge") {
          setChargeAfterSave({
            id: res.invoice.id,
            invoiceNumber: res.invoice.invoiceNumber,
            balanceCents: res.invoice.balanceCents
          });
        } else {
          router.push(`/invoices/${res.invoice.id}`);
          router.refresh();
        }
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {banner && (
          <div role="alert" className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2">
            {banner}
          </div>
        )}

        <section className="bg-surface border border-border rounded-lg p-5">
          <h2 className="text-sm uppercase text-muted tracking-wide mb-3">Customer</h2>
          <CustomerPicker value={customer} onChange={setCustomer} />
        </section>

        <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase text-muted tracking-wide">Line items</h2>
            <Button type="button" size="sm" variant="ghost" onClick={addBlankLine}>
              + Custom line
            </Button>
          </div>
          <CatalogPicker onPick={addCatalogLine} />
          <div className="space-y-3">
            {lines.map((line) => (
              <LineItemRow
                key={line.key}
                line={line}
                taxRates={taxRates}
                onChange={(patch) => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
              />
            ))}
            {lines.length === 0 && (
              <div className="text-center text-muted text-sm py-6 border border-dashed border-border rounded">
                No items yet. Pick from catalog above or add a custom line.
              </div>
            )}
          </div>
        </section>

        <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <h2 className="text-sm uppercase text-muted tracking-wide">Invoice-level</h2>
          <DiscountPicker
            label="Invoice discount"
            value={invoiceDiscount}
            onChange={setInvoiceDiscount}
          />
          <Input
            label="Due date"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
          <div>
            <label htmlFor="notes" className="block text-sm text-muted mb-1">
              Notes
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <TotalsPanel totals={totals} />
        <Button
          type="button"
          onClick={() => submit("charge")}
          disabled={isPending || !canSubmit()}
          className="w-full"
        >
          {isPending ? "Saving…" : "Save & charge"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => submit("draft")}
          disabled={isPending || !canSubmit()}
          className="w-full"
        >
          Save draft
        </Button>
      </div>

      {chargeAfterSave && (
        <PaymentModal
          open={true}
          onClose={() => {
            const id = chargeAfterSave.id;
            setChargeAfterSave(null);
            router.push(`/invoices/${id}`);
            router.refresh();
          }}
          invoice={chargeAfterSave}
        />
      )}
    </div>
  );
}
