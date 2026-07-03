import type { JSX } from "react";

interface TrendDeltaProps {
  current: number;
  previous: number;
  compareLabel?: string;
}

// Token-based delta pill. Supersedes the raw-Tailwind DeltaBadge; the Overview
// tab keeps its own DeltaInfo-based badge. Percent is hidden when previous<=0
// (no meaningful ratio), matching the aggregate.delta() convention.
export default function TrendDelta({ current, previous, compareLabel }: TrendDeltaProps): JSX.Element {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null;
  const sign = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const arrow = sign === "up" ? "↑" : sign === "down" ? "↓" : "→";
  const signStr = diff > 0 ? "+" : "";
  const bg =
    sign === "up" ? "rgba(63, 185, 80, 0.18)" : sign === "down" ? "rgba(248, 81, 73, 0.18)" : "var(--bg-elevated)";
  const fg = sign === "up" ? "var(--success)" : sign === "down" ? "var(--danger)" : "var(--text-muted)";

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold font-mono"
      style={{ background: bg, color: fg }}
    >
      {arrow} {signStr}
      {diff}
      {pct !== null && (
        <span>
          ({signStr}
          {pct}%)
        </span>
      )}
      {compareLabel && (
        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{compareLabel}</span>
      )}
    </span>
  );
}
