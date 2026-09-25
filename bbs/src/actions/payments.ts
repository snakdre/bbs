"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Role, requireRole } from "@/lib/permissions";
import { toCents } from "@/lib/money";
import { reconcileInvoice } from "@/lib/payments";
import {
  recordPaymentSchema,
  refundPaymentSchema,
  voidInvoiceSchema
} from "@/schemas/payment";

async function writeAudit(
  tx: Prisma.TransactionClient,
  args: {
    action: string;
    entityType: string;
    entityId: string;
    userId: string;
    before?: unknown;
    after?: unknown;
  }
) {
  await tx.auditLog.create({
    data: {
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      userId: args.userId,
      before: args.before as Prisma.InputJsonValue | undefined,
      after: args.after as Prisma.InputJsonValue | undefined
    }
  });
}

export async function recordPayment(raw: unknown) {
  const user = await requireRole(Role.ADMIN, Role.STAFF);
  const input = recordPaymentSchema.parse(raw);

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId }
  });
  if (!invoice) {
    return { ok: false as const, error: "invoice_not_found" };
  }
  if (invoice.status === "VOID" || invoice.status === "REFUNDED" || invoice.status === "PAID") {
    return { ok: false as const, error: "invoice_terminal" };
  }

  const tenderedCents = toCents(input.tendered);
  const appliedCents = Math.min(tenderedCents, invoice.balanceCents);
  const changeCents = tenderedCents - appliedCents;

  let note = input.note;
  if (changeCents > 0) {
    const prefix = `Tendered $${input.tendered}, change $${(changeCents / 100).toFixed(2)}. `;
    note = note ? `${prefix}${note}` : prefix.trim();
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amountCents: appliedCents,
          method: input.method,
          paidAt,
          referenceNumber: input.referenceNumber,
          staffId: user.id,
          note,
          idempotencyKey: input.idempotencyKey
        }
      });

      const [payments, refunds] = await Promise.all([
        tx.payment.findMany({
          where: { invoiceId: invoice.id },
          select: { amountCents: true }
        }),
        tx.refund.findMany({
          where: { invoiceId: invoice.id },
          select: { amountCents: true }
        })
      ]);

      const reconciled = reconcileInvoice(
        { totalCents: invoice.totalCents, status: invoice.status },
        payments,
        refunds
      );

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidCents: reconciled.paidCents,
          balanceCents: reconciled.balanceCents,
          status: reconciled.status
        }
      });

      await writeAudit(tx, {
        action: "PAYMENT_RECORDED",
        entityType: "Invoice",
        entityId: invoice.id,
        userId: user.id,
        before: { status: invoice.status, paidCents: invoice.paidCents },
        after: {
          status: updated.status,
          paidCents: updated.paidCents,
          paymentId: payment.id,
          amountCents: payment.amountCents
        }
      });

      return { payment, invoice: updated };
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoice.id}`);
    revalidatePath(`/customers/${invoice.customerId}`);
    revalidatePath("/dashboard");
    return { ok: true as const, payment: result.payment, invoice: result.invoice };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Idempotency dedup: fetch existing payment.
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      const currentInvoice = await prisma.invoice.findUnique({
        where: { id: invoice.id }
      });
      return {
        ok: true as const,
        payment: existing!,
        invoice: currentInvoice!,
        deduplicated: true as const
      };
    }
    throw err;
  }
}

export async function voidInvoice(raw: unknown) {
  const user = await requireRole(Role.ADMIN);
  const input = voidInvoiceSchema.parse(raw);

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: {
      payments: { include: { refunds: true } }
    }
  });
  if (!invoice) return { ok: false as const, error: "invoice_not_found" };
  if (invoice.status === "VOID" || invoice.status === "REFUNDED") {
    return { ok: false as const, error: "already_terminal" };
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const p of invoice.payments) {
      const alreadyRefunded = p.refunds.reduce((s, r) => s + r.amountCents, 0);
      const unrefunded = p.amountCents - alreadyRefunded;
      if (unrefunded > 0) {
        await tx.refund.create({
          data: {
            invoiceId: invoice.id,
            paymentId: p.id,
            amountCents: unrefunded,
            reason: `Invoice voided: ${input.reason}`,
            staffId: user.id
          }
        });
      }
    }

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "VOID",
        paidCents: 0,
        balanceCents: 0
      }
    });

    await writeAudit(tx, {
      action: "INVOICE_VOIDED",
      entityType: "Invoice",
      entityId: invoice.id,
      userId: user.id,
      before: { status: invoice.status, paidCents: invoice.paidCents },
      after: { status: updated.status, reason: input.reason }
    });

    return updated;
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);
  revalidatePath(`/customers/${invoice.customerId}`);
  revalidatePath("/dashboard");
  return { ok: true as const, invoice: result };
}

export async function refundPayment(raw: unknown) {
  const user = await requireRole(Role.ADMIN);
  const input = refundPaymentSchema.parse(raw);

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { invoice: true }
  });
  if (!payment) return { ok: false as const, error: "payment_not_found" };

  const requestedCents = toCents(input.amount);
  const invoiceId = payment.invoiceId;
  const invoice = payment.invoice;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Recompute refundable INSIDE the transaction so concurrent refunds
      // against the same payment can't both pass a stale check.
      const currentRefunds = await tx.refund.findMany({
        where: { paymentId: payment.id },
        select: { amountCents: true }
      });
      const alreadyRefunded = currentRefunds.reduce((s, r) => s + r.amountCents, 0);
      const refundable = payment.amountCents - alreadyRefunded;
      const refundCents = Math.min(requestedCents, refundable);
      if (refundCents <= 0) {
        // Signal the outer catch to translate this into a soft error.
        throw new NothingToRefundError();
      }

      const refund = await tx.refund.create({
        data: {
          invoiceId,
          paymentId: payment.id,
          amountCents: refundCents,
          reason: input.reason,
          note: input.note,
          staffId: user.id
        }
      });

      const [payments, refunds] = await Promise.all([
        tx.payment.findMany({
          where: { invoiceId },
          select: { amountCents: true }
        }),
        tx.refund.findMany({
          where: { invoiceId },
          select: { amountCents: true }
        })
      ]);

      const reconciled = reconcileInvoice(
        { totalCents: invoice.totalCents, status: invoice.status },
        payments,
        refunds
      );

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidCents: reconciled.paidCents,
          balanceCents: reconciled.balanceCents,
          status: reconciled.status
        }
      });

      await writeAudit(tx, {
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        userId: user.id,
        before: { paidCents: invoice.paidCents, status: invoice.status },
        after: {
          refundId: refund.id,
          refundedCents: refundCents,
          newStatus: updated.status,
          reason: input.reason
        }
      });

      return { refund, invoice: updated };
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/customers/${invoice.customerId}`);
    revalidatePath("/dashboard");
    return { ok: true as const, refund: result.refund, invoice: result.invoice };
  } catch (err) {
    if (err instanceof NothingToRefundError) {
      return { ok: false as const, error: "nothing_to_refund" };
    }
    throw err;
  }
}

class NothingToRefundError extends Error {
  constructor() {
    super("nothing_to_refund");
    this.name = "NothingToRefundError";
  }
}
