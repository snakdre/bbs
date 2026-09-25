"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { DiscountPicker, type DiscountValue } from "./DiscountPicker";

export interface DraftLine {
  key: string; // client-side stable key
  catalogItemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: DiscountValue;
  taxRateId: string | null;
}

interface Props {
  line: DraftLine;
  taxRates: { id: string; name: string; ratePercent: string }[];
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}

export function LineItemRow({ line, taxRates, onChange, onRemove }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start bg-surface-raised border border-border rounded p-3">
      <div className="md:col-span-4">
        <Input
          label="Description"
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="md:col-span-2">
        <Input
          label="Qty"
          inputMode="decimal"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
        />
      </div>
      <div className="md:col-span-2">
        <Input
          label="Unit price"
          inputMode="decimal"
          value={line.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value })}
        />
      </div>
      <div className="md:col-span-2">
        <DiscountPicker value={line.discount} onChange={(v) => onChange({ discount: v })} />
      </div>
      <div className="md:col-span-2">
        <Select
          label="Tax"
          value={line.taxRateId ?? ""}
          onChange={(e) => onChange({ taxRateId: e.target.value || null })}
        >
          <option value="">None</option>
          {taxRates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.ratePercent}%)
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-12 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
