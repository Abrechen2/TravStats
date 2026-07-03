import type { JSX } from "react";

interface TrendDeltaProps {
  current: number;
  previous: number;
  compareLabel?: string;
}

// Token-based delta pill. Supersedes the raw-Tailwind DeltaBadge; the Overview
// tab keeps its own DeltaInfo-based badge. The pill is hidden entirely when
// previous<=0 (no meaningful baseline — e.g. the all-time view, which has no
// previous window by design). Only a unit-agnostic percentage is shown; the
// raw absolute diff is never rendered since consumers pass mixed units
// (km/mi, minutes/hours, currency) that TrendDelta cannot format correctly.
export default function TrendDelta({ current, previous, compareLabel }: TrendDeltaProps): JSX.Element | null {
  if (previous <= 0) {
    return null;
  }

  const pct = Math.round(((current - previous) / previous) * 100);
  const sign = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const arrow = sign === "up" ? "↑" : sign === "down" ? "↓" : "→";
  const bg =
    sign === "up" ? "rgba(63, 185, 80, 0.18)" : sign === "down" ? "rgba(248, 81, 73, 0.18)" : "var(--bg-elevated)";
  const fg = sign === "up" ? "var(--success)" : sign === "down" ? "var(--danger)" : "var(--text-muted)";

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold font-mono"
      style={{ background: bg, color: fg }}
    >
      {arrow} {pct > 0 ? "+" : ""}
      {pct}%
      {compareLabel && (
        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{compareLabel}</span>
      )}
    </span>
  );
}
