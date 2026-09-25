"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { voidInvoice } from "@/actions/payments";

interface Props {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  hasPayments: boolean;
}

export function VoidModal({ open, onClose, invoiceId, invoiceNumber, hasPayments }: Props) {
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const res = await voidInvoice({ invoiceId, reason });
        if (!res.ok) {
          setBanner(
            res.error === "already_terminal"
              ? "This invoice is already void or refunded."
              : "Void failed. Please try again."
          );
          return;
        }
        onClose();
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Void failed.");
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Void invoice · ${invoiceNumber}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div
          className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2"
          role="alert"
        >
          Voiding cancels this invoice.
          {hasPayments
            ? " Existing payments will be automatically refunded."
            : ""}
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
          label="Reason *"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div className="flex gap-2 justify-end">
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            autoFocus
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={isPending || reason.trim().length < 3}
          >
            {isPending ? "Voiding…" : "Void invoice"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
