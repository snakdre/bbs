"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from "react";

export interface ComboboxItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface ComboboxProps<T extends ComboboxItem> {
  label: string;
  placeholder?: string;
  value: T | null;
  onSelect: (item: T | null) => void;
  onSearch: (query: string) => Promise<T[]>;
  emptyState?: ReactNode;
  debounceMs?: number;
}

export function Combobox<T extends ComboboxItem>({
  label,
  placeholder,
  value,
  onSelect,
  onSearch,
  emptyState,
  debounceMs = 250
}: ComboboxProps<T>) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await onSearch(query.trim());
        setResults(r);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, debounceMs, onSearch]);

  return (
    <div className="w-full relative">
      <label className="block text-sm text-muted mb-1">{label}</label>
      {value ? (
        <div className="flex items-center justify-between h-11 px-3 rounded bg-surface-raised border border-border">
          <div>
            <div className="text-text">{value.label}</div>
            {value.sublabel && (
              <div className="text-xs text-muted">{value.sublabel}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-muted hover:text-text text-sm"
            aria-label="Clear selection"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="w-full h-11 px-3 rounded bg-surface-raised border border-border text-text focus:outline-none focus:ring-2 focus:ring-gold"
          />
          {open && (query.length > 0 || results.length > 0) && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded border border-border bg-surface shadow-2xl"
            >
              {loading && (
                <li className="px-3 py-2 text-sm text-muted">Searching…</li>
              )}
              {!loading && results.length === 0 && query.trim().length > 0 && (
                <li className="px-3 py-2 text-sm text-muted">
                  {emptyState ?? "No matches"}
                </li>
              )}
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSelect(r);
                      setOpen(false);
                      setQuery("");
                      setResults([]);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-surface-raised text-text"
                  >
                    <div>{r.label}</div>
                    {r.sublabel && (
                      <div className="text-xs text-muted">{r.sublabel}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
