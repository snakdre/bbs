"use client";

import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";

export type DiscountValue = { kind: "PERCENT" | "FIXED" | "NONE"; value: string };

interface Props {
  label?: string;
  value: DiscountValue;
  onChange: (v: DiscountValue) => void;
}

export function DiscountPicker({ label = "Discount", value, onChange }: Props) {
  return (
    <div>
      <label className="block text-sm text-muted mb-1">{label}</label>
      <div className="flex gap-2">
        <Select
          value={value.kind}
          onChange={(e) =>
            onChange({
              kind: e.target.value as DiscountValue["kind"],
              value: e.target.value === "NONE" ? "0" : value.value
            })
          }
        >
          <option value="NONE">None</option>
          <option value="PERCENT">Percent</option>
          <option value="FIXED">Amount</option>
        </Select>
        {value.kind !== "NONE" && (
          <Input
            inputMode="decimal"
            placeholder={value.kind === "PERCENT" ? "e.g. 10" : "e.g. 5.00"}
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}
