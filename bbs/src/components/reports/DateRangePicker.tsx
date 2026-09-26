"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const PRESETS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last-7d", label: "Last 7 days" },
  { value: "last-30d", label: "Last 30 days" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
  { value: "all-time", label: "All time" },
  { value: "custom", label: "Custom" }
];

const GRANULARITY: { value: string; label: string; defaultRange: string }[] = [
  { value: "daily", label: "Daily", defaultRange: "last-30d" },
  { value: "weekly", label: "Weekly", defaultRange: "last-7d" },
  { value: "monthly", label: "Monthly", defaultRange: "this-year" }
];

export function DateRangePicker() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const range = params.get("range") ?? "last-30d";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const granularity = params.get("granularity") ?? "daily";

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => {
      router.push(`/reports?${next.toString()}`);
    });
  }

  function onRangeChange(newRange: string) {
    if (newRange === "custom") {
      updateParams({ range: "custom" });
    } else {
      updateParams({ range: newRange, from: null, to: null });
    }
  }

  function onGranularityChange(newGran: string) {
    const preset = GRANULARITY.find((g) => g.value === newGran);
    // Only auto-adjust range if not custom
    if (range !== "custom" && preset) {
      updateParams({ granularity: newGran, range: preset.defaultRange });
    } else {
      updateParams({ granularity: newGran });
    }
  }

  return (
    <div className="sticky top-0 z-10 bg-bg py-3 flex flex-wrap items-center gap-3 border-b border-border">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">Range</span>
        <select
          value={range}
          onChange={(e) => onRangeChange(e.target.value)}
          disabled={isPending}
          className="h-9 px-2 rounded bg-surface-raised border border-border text-text text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {range === "custom" && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => updateParams({ from: e.target.value })}
              disabled={isPending}
              className="h-9 px-2 rounded bg-surface-raised border border-border text-text text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => updateParams({ to: e.target.value })}
              disabled={isPending}
              className="h-9 px-2 rounded bg-surface-raised border border-border text-text text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </label>
        </>
      )}

      <div className="ml-auto flex gap-0 border border-border rounded overflow-hidden">
        {GRANULARITY.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => onGranularityChange(g.value)}
            disabled={isPending}
            className={
              "px-3 h-9 text-xs font-medium transition-colors " +
              (granularity === g.value
                ? "bg-gold text-bg"
                : "bg-surface-raised text-text hover:bg-surface")
            }
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}
