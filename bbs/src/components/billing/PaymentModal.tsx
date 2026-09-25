"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { formatUSD, fromCents, toCents } from "@/lib/money";
import { recordPayment } from "@/actions/payments";

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: {
    id: string;
    invoiceNumber: string;
    balanceCents: number;
  };
}

const METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK", "CHECK", "MOBILE", "OTHER"];
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK: "Bank transfer",
  CHECK: "Check",
  MOBILE: "Mobile payment",
  OTHER: "Other"
};

function safeToCents(s: string): number {
  try {
    return toCents(s);
  } catch {
    return 0;
  }
}

export function PaymentModal({ open, onClose, invoice }: Props) {
  const router = useRouter();
  // One idempotency key per modal instance, generated at mount.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const [tendered, setTendered] = useState<string>(fromCents(invoice.balanceCents));
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tenderedCents = safeToCents(tendered);
  const appliedCents = Math.min(tenderedCents, invoice.balanceCents);
  const changeCents = Math.max(0, tenderedCents - invoice.balanceCents);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await recordPayment({
          invoiceId: invoice.id,
          tendered,
          method,
          paidAt: null,
          referenceNumber: referenceNumber || null,
          note: note || null,
          idempotencyKey
        });
        if (!res.ok) {
          setBanner(
            res.error === "invoice_terminal"
              ? "This invoice can no longer accept payments."
              : "Payment failed. Please try again."
          );
          return;
        }
        onClose();
        if (res.invoice.status === "PAID") {
          router.push(`/invoices/${invoice.id}/paid?receipt=1`);
        } else {
          router.refresh();
        }
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Payment failed.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Record payment · ${invoice.invoiceNumber}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        {banner && (
          <div
            role="alert"
            className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          >
            {banner}
          </div>
        )}

        <Input
          label="Amount tendered *"
          required
          inputMode="decimal"
          value={tendered}
          onChange={(e) => setTendered(e.target.value)}
        />

        <Select
          label="Method *"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </Select>

        <Input
          label="Reference #"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
        />

        <div>
          <label htmlFor="note" className="block text-sm text-muted mb-1">
            Note
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div
          aria-live="polite"
          className="bg-surface-raised border border-border rounded p-3 text-sm space-y-1"
        >
          <Row label="Balance due" value={formatUSD(invoice.balanceCents)} />
          <Row label="Applied to invoice" value={formatUSD(appliedCents)} />
          {changeCents > 0 && (
            <Row label="Change due" value={formatUSD(changeCents)} accent />
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || appliedCents === 0}>
            {isPending ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={"tabular " + (accent ? "text-gold font-semibold" : "text-text")}>
        {value}
      </span>
    </div>
  );
}
