"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatUSD, fromCents } from "@/lib/money";
import { refundPayment } from "@/actions/payments";

interface Props {
  open: boolean;
  onClose: () => void;
  payment: {
    id: string;
    amountCents: number;
    method: string;
    paidAt: Date;
    alreadyRefundedCents: number;
  };
}

export function RefundModal({ open, onClose, payment }: Props) {
  const router = useRouter();
  const refundable = payment.amountCents - payment.alreadyRefundedCents;
  const [amount, setAmount] = useState<string>(fromCents(refundable));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await refundPayment({
          paymentId: payment.id,
          amount,
          reason,
          note: note || null
        });
        if (!res.ok) {
          setBanner(
            res.error === "nothing_to_refund"
              ? "This payment has no refundable balance."
              : "Refund failed. Please try again."
          );
          return;
        }
        onClose();
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Refund failed.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Refund payment">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="bg-surface-raised border border-border rounded p-3 text-sm space-y-1">
          <div className="flex justify-between text-muted">
            <span>Payment</span>
            <span className="text-text tabular">
              {formatUSD(payment.amountCents)} · {payment.method}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Already refunded</span>
            <span className="text-text tabular">
              {formatUSD(payment.alreadyRefundedCents)}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Refundable</span>
            <span className="text-gold font-semibold tabular">
              {formatUSD(refundable)}
            </span>
          </div>
        </div>

        {banner && (
          <div
            role="alert"
            className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          >
            {banner}
          </div>
        )}

        <Input
          label="Amount *"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <Input
          label="Reason *"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div>
          <label htmlFor="refund-note" className="block text-sm text-muted mb-1">
            Note
          </label>
          <textarea
            id="refund-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={isPending || reason.trim().length < 3 || refundable <= 0}
          >
            {isPending ? "Refunding…" : "Issue refund"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
