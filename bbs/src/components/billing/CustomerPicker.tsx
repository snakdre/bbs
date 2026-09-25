"use client";

import { useState } from "react";
import { Combobox, type ComboboxItem } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { searchCustomers, createCustomer } from "@/actions/customers";
import { CustomerForm } from "@/components/customers/CustomerForm";

export interface PickedCustomer {
  id: string;
  name: string;
  email: string | null;
}

interface Props {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
}

export function CustomerPicker({ value, onChange }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  async function search(q: string): Promise<(ComboboxItem & PickedCustomer)[]> {
    const results = await searchCustomers(q);
    return results.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: r.email ?? r.phone ?? undefined,
      name: r.name,
      email: r.email
    }));
  }

  return (
    <div className="space-y-2">
      <Combobox
        label="Customer"
        placeholder="Search by name, email, phone…"
        value={
          value
            ? { id: value.id, label: value.name, sublabel: value.email ?? undefined, name: value.name, email: value.email }
            : null
        }
        onSelect={(item) => onChange(item ? { id: item.id, name: item.label, email: item.sublabel ?? null } : null)}
        onSearch={search}
      />
      {!value && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="text-sm text-gold hover:underline"
        >
          + New customer
        </button>
      )}

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="New customer">
        <CustomerForm
          mode="create"
          onSaved={(c) => {
            onChange({ id: c.id, name: c.name, email: c.email });
            setShowCreate(false);
          }}
        />
      </Dialog>
    </div>
  );
}

// Suppress unused import warnings for the create helper (used indirectly through CustomerForm).
void createCustomer;
