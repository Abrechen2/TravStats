import type { JSX } from "react";
import Sparkline from "./Sparkline";
import TrendDelta from "../TrendDelta";

export interface ScorecardTileVM {
  key: string;
  label: string;
  value: string;
  takeaway: string;
  points: number[];
  current: number;
  previous: number;
}

// Hero KPI tile: big value + one-line takeaway (HIG), label-free sparkline
// (HIG sneak-peek), and a delta vs. the previous window (Few: current values
// need history).
export default function ScorecardTile({
  label,
  value,
  takeaway,
  points,
  current,
  previous,
}: ScorecardTileVM): JSX.Element {
  return (
    <div
      className="rounded-lg border p-5 shadow-md flex flex-col gap-2"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        <TrendDelta current={current} previous={previous} />
      </div>
      <span className="text-4xl font-bold tabular-nums" style={{ color: "var(--accent)" }}>
        {value}
      </span>
      <div className="mt-1">
        <Sparkline points={points} filled />
      </div>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {takeaway}
      </span>
    </div>
  );
}
