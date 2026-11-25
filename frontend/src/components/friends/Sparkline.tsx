import type { JSX } from "react";
import type { YearPoint } from "../../lib/comparison/yearly";

const W = 120;
const H = 30;

/** Two small lines on one scale; a null year breaks the line instead of dropping to zero. */
export default function Sparkline({
  mine,
  theirs,
  label,
}: {
  mine: YearPoint[];
  theirs: YearPoint[];
  label: string;
}): JSX.Element {
  const top = Math.max(1, ...[...mine, ...theirs].map((p) => p.value ?? 0));
  const x = (i: number, n: number): number => (n <= 1 ? 0 : (i / (n - 1)) * (W - 2) + 1);
  const y = (v: number): number => H - 2 - (v / top) * (H - 4);
  const path = (pts: YearPoint[]): string =>
    pts
      .map((p, i) => (p.value === null ? null : `${x(i, pts.length)},${y(p.value)}`))
      .reduce<string[][]>((runs, point) => {
        if (point === null) runs.push([]);
        else if (runs.length === 0) runs.push([point]);
        else runs[runs.length - 1].push(point);
        return runs;
      }, [])
      .filter((run) => run.length > 0)
      .map((run) => `M${run.join(" L")}`)
      .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      data-testid="sparkline"
    >
      <path d={path(theirs)} fill="none" stroke="var(--ts-text)" strokeWidth={1.5} opacity={0.7} />
      <path d={path(mine)} fill="none" stroke="var(--ts-accent)" strokeWidth={2} />
    </svg>
  );
}
