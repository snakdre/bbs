"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createCustomer, updateCustomer } from "@/actions/customers";

interface FormValues {
  name: string;
  company: string;
  email: string;
  phone: string;
  billingAddress: string;
  taxId: string;
  notes: string;
}

interface CustomerFormProps {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<FormValues>;
  onSaved?: (customer: { id: string; name: string; email: string | null }) => void;
}

export function CustomerForm({ mode, id, initial, onSaved }: CustomerFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    name: initial?.name ?? "",
    company: initial?.company ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    billingAddress: initial?.billingAddress ?? "",
    taxId: initial?.taxId ?? "",
    notes: initial?.notes ?? ""
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function bind<K extends keyof FormValues>(name: K) {
    return {
      name,
      value: values[name],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setValues((v) => ({ ...v, [name]: e.target.value })),
      error: errors[name]
    };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setBanner(null);
    startTransition(async () => {
      try {
        const res =
          mode === "create"
            ? await createCustomer(values)
            : await updateCustomer(id!, values);
        if (!res.ok) {
          setBanner("A customer with that email already exists.");
          return;
        }
        onSaved?.(res.customer);
        if (mode === "create") {
          router.push(`/customers/${res.customer.id}`);
        } else {
          router.push(`/customers/${id}`);
        }
        router.refresh();
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
      {banner && (
        <div role="alert" className="text-sm text-danger-bright bg-danger/10 border border-danger rounded px-3 py-2">
          {banner}
        </div>
      )}
      <Input label="Name *" required {...bind("name")} />
      <Input label="Company" {...bind("company")} />
      <Input label="Email" type="email" {...bind("email")} />
      <Input label="Phone" {...bind("phone")} />
      <Input label="Billing address" {...bind("billingAddress")} />
      <Input label="Tax ID" {...bind("taxId")} />
      <Input label="Notes" {...bind("notes")} />
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create customer" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
