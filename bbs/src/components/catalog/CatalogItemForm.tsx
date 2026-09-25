"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import {
  createCatalogItem,
  updateCatalogItem
} from "@/actions/catalog";

interface FormValues {
  name: string;
  description: string;
  sku: string;
  unitPrice: string;
  taxRateId: string;
  active: boolean;
}

interface Props {
  mode: "create" | "edit";
  id?: string;
  initial?: Partial<FormValues>;
  taxRates: { id: string; name: string; ratePercent: string }[];
}

export function CatalogItemForm({ mode, id, initial, taxRates }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    sku: initial?.sku ?? "",
    unitPrice: initial?.unitPrice ?? "",
    taxRateId: initial?.taxRateId ?? "",
    active: initial?.active ?? true
  });
  const [banner, setBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      try {
        const payload = {
          ...values,
          taxRateId: values.taxRateId || undefined
        };
        if (mode === "create") {
          await createCatalogItem(payload);
        } else {
          await updateCatalogItem(id!, payload);
        }
        router.push("/catalog");
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
      <Input
        label="Name *"
        required
        value={values.name}
        onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
      />
      <Input
        label="Description"
        value={values.description}
        onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
      />
      <Input
        label="SKU"
        value={values.sku}
        onChange={(e) => setValues((v) => ({ ...v, sku: e.target.value }))}
      />
      <Input
        label="Unit price (USD) *"
        required
        inputMode="decimal"
        placeholder="e.g. 12.50"
        value={values.unitPrice}
        onChange={(e) => setValues((v) => ({ ...v, unitPrice: e.target.value }))}
      />
      <Select
        label="Tax rate"
        value={values.taxRateId}
        onChange={(e) => setValues((v) => ({ ...v, taxRateId: e.target.value }))}
      >
        <option value="">None</option>
        {taxRates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.ratePercent}%)
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={values.active}
          onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
          className="h-4 w-4"
        />
        Active
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create item" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
