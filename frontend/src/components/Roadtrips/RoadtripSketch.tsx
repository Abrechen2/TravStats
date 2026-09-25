import type { JSX } from "react";

import { sketchPath } from "../../lib/roadtrip/roadtripView";

const W = 320;
const H = 120;

/**
 * The list's route sketch: the stations joined in travel order, fitted into
 * the card. Not a map — no land, no scale — just the shape a reader
 * recognises their trip by. A planned roadtrip draws dashed and fainter, the
 * same mark the map gives what has not happened yet.
 */
export default function RoadtripSketch({
  points,
  planned = false,
  height = H,
}: {
  points: ReadonlyArray<readonly [number, number]>;
  planned?: boolean;
  height?: number;
}): JSX.Element {
  const d = sketchPath(points, W, H);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      style={{ display: "block", background: "var(--ts-surface2)" }}
    >
      {d && (
        <path
          d={d}
          fill="none"
          stroke="var(--domain-roadtrip)"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={planned ? "6 5" : undefined}
          strokeOpacity={planned ? 0.7 : 1}
        />
      )}
    </svg>
  );
}
