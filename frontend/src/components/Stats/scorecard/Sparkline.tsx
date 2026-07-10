import type { JSX } from "react";

interface SparklineProps {
  points: number[];
  filled?: boolean;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

// Dependency-free trend preview per HIG "sneak peek" charts: no axes, grid or
// labels — only the data's shape. Uses a fixed 100-wide viewBox scaled to width.
export default function Sparkline({
  points,
  filled = false,
  height = 28,
  strokeWidth = 1.5,
  className,
}: SparklineProps): JSX.Element | null {
  if (points.length === 0) return null;

  const W = 100;
  const H = height;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1; // flat series → straight mid line
  const n = points.length;

  const coords = points.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
  });

  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${coords[0][0]},${H} ${line} ${coords[coords.length - 1][0]},${H}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
      className={className}
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {filled && (
        <polygon points={area} fill="var(--accent-soft, rgba(240,169,71,0.18))" stroke="none" />
      )}
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
