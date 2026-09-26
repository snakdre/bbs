import Link from "next/link";

interface Props {
  title: string;
  subtitle?: string;
  totalLabel?: string;
  csvHref?: string;
  children: React.ReactNode;
}

export function ReportSection({ title, subtitle, totalLabel, csvHref, children }: Props) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-baseline gap-3">
          {totalLabel && (
            <span className="text-gold text-2xl font-bold tabular">{totalLabel}</span>
          )}
          {csvHref && (
            <Link
              href={csvHref}
              className="text-xs px-3 h-9 flex items-center rounded bg-surface-raised border border-border text-text hover:bg-surface"
            >
              Export CSV
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
