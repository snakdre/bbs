"use client";

import { Fragment, useState } from "react";
import type { PaymentMethod, Role } from "@prisma/client";
import { formatUSD } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { RefundModal } from "./RefundModal";

interface PaymentRow {
  id: string;
  amountCents: number;
  method: PaymentMethod;
  paidAt: Date;
  referenceNumber: string | null;
  staffName: string;
  note: string | null;
  refunds: {
    id: string;
    amountCents: number;
    reason: string;
    refundedAt: Date;
    staffName: string;
  }[];
}

interface Props {
  payments: PaymentRow[];
  role: Role;
}

export function PaymentsSection({ payments, role }: Props) {
  const [refundOpenFor, setRefundOpenFor] = useState<PaymentRow | null>(null);

  if (payments.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 text-center text-muted text-sm">
        No payments recorded.
      </div>
    );
  }

  return (
    <>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-muted uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Reference</th>
              <th className="text-left px-4 py-3">Staff</th>
              {role === "ADMIN" && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const refundedSum = p.refunds.reduce((s, r) => s + r.amountCents, 0);
              const refundable = p.amountCents - refundedSum;
              return (
                <Fragment key={p.id}>
                  <tr className="border-t border-border">
                    <td className="px-4 py-3 text-text tabular">
                      {formatUSD(p.amountCents)}
                    </td>
                    <td className="px-4 py-3 text-text">{p.method}</td>
                    <td className="px-4 py-3 text-text">
                      {p.paidAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-muted font-mono">
                      {p.referenceNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{p.staffName}</td>
                    {role === "ADMIN" && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={refundable <= 0}
                          onClick={() => setRefundOpenFor(p)}
                        >
                          Refund
                        </Button>
                      </td>
                    )}
                  </tr>
                  {p.refunds.map((r) => (
                    <tr key={r.id} className="border-t border-border bg-surface-raised/40">
                      <td className="px-4 py-2 text-danger-bright tabular text-xs pl-8">
                        ↳ -{formatUSD(r.amountCents)}
                      </td>
                      <td className="px-4 py-2 text-muted text-xs" colSpan={role === "ADMIN" ? 5 : 4}>
                        Refund — {r.reason} · {r.refundedAt.toISOString().slice(0, 10)} · {r.staffName}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {refundOpenFor && (
        <RefundModal
          open={!!refundOpenFor}
          onClose={() => setRefundOpenFor(null)}
          payment={{
            id: refundOpenFor.id,
            amountCents: refundOpenFor.amountCents,
            method: refundOpenFor.method,
            paidAt: refundOpenFor.paidAt,
            alreadyRefundedCents: refundOpenFor.refunds.reduce(
              (s, r) => s + r.amountCents,
              0
            )
          }}
        />
      )}
    </>
  );
}
