import { formatUSD } from "@/lib/money";

interface Bucket {
  label: string;
  valueCents: number;
}

interface Props {
  buckets: Bucket[];
  variant: "compact" | "full";
  totalLabel: string;
  rangeLabel: string;
  granularity?: "daily" | "weekly" | "monthly";
}

export function RevenueChart({ buckets, variant, totalLabel, rangeLabel, granularity }: Props) {
  const maxValue = Math.max(1, ...buckets.map((b) => b.valueCents));
  const hasData = buckets.some((b) => b.valueCents > 0);
  const width = 360;
  const height = variant === "compact" ? 140 : 220;
  const barGap = 4;
  const barWidth = buckets.length > 0 ? (width - barGap * (buckets.length + 1)) / buckets.length : 0;

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-muted text-[10px] uppercase tracking-widest">Revenue</div>
          <div className="text-gold text-2xl font-bold tabular mt-1">{totalLabel}</div>
          <div className="text-muted text-xs mt-1">{rangeLabel}</div>
        </div>
        {variant === "full" && granularity && (
          <div className="text-muted text-[10px] uppercase tracking-widest">
            {granularity}
          </div>
        )}
      </div>

      {hasData ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block" role="img" aria-label={`Revenue chart, ${rangeLabel}`}>
            {/* Gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <line
                key={frac}
                x1="0"
                y1={height * frac}
                x2={width}
                y2={height * frac}
                stroke="#2A2A2A"
                strokeWidth="0.5"
                strokeDasharray={frac === 1 ? undefined : "2 2"}
              />
            ))}
            {/* Bars */}
            {buckets.map((b, i) => {
              const barHeight = b.valueCents === 0 ? 4 : Math.max(2, (b.valueCents / maxValue) * (height - 8));
              const x = barGap + i * (barWidth + barGap);
              const y = height - barHeight;
              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="#D4B44A"
                  opacity={b.valueCents === 0 ? 0.3 : 1}
                >
                  <title>{`${b.label}: ${formatUSD(b.valueCents)}`}</title>
                </rect>
              );
            })}
          </svg>
          {buckets.length > 0 && (
            <div className="flex justify-between text-muted text-[10px] mt-2">
              <span>{buckets[0]?.label}</span>
              <span>{buckets[buckets.length - 1]?.label}</span>
            </div>
          )}
        </>
      ) : (
        <div className="text-muted text-sm text-center py-12">No revenue in this range yet.</div>
      )}
    </div>
  );
}
