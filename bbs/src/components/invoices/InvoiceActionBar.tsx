"use client";

import { useState } from "react";
import Link from "next/link";
import type { Role, InvoiceStatus } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { PaymentModal } from "@/components/billing/PaymentModal";
import { VoidModal } from "./VoidModal";

interface Props {
  invoice: {
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    balanceCents: number;
    hasPayments: boolean;
  };
  role: Role;
}

const TERMINAL: InvoiceStatus[] = ["VOID", "REFUNDED"];

export function InvoiceActionBar({ invoice, role }: Props) {
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const isTerminal = TERMINAL.includes(invoice.status);
  const canRecordPayment =
    !isTerminal &&
    invoice.status !== "PAID" &&
    invoice.balanceCents > 0 &&
    (role === "ADMIN" || role === "STAFF");
  const canVoid = role === "ADMIN" && !isTerminal;

  return (
    <div className="flex flex-wrap gap-2">
      {canRecordPayment && (
        <Button onClick={() => setPayOpen(true)}>Record payment</Button>
      )}
      <Link
        href={`/invoices/${invoice.id}/receipt`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button variant="secondary">Print receipt</Button>
      </Link>
      <Link
        href={`/invoices/${invoice.id}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button variant="secondary">Download PDF</Button>
      </Link>
      {canVoid && (
        <Button variant="danger" onClick={() => setVoidOpen(true)}>
          Void invoice
        </Button>
      )}

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoice={{
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          balanceCents: invoice.balanceCents
        }}
      />

      <VoidModal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoiceNumber}
        hasPayments={invoice.hasPayments}
      />
    </div>
  );
}
