import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import type { Cell } from "../../lib/comparison/compareCells";

/** The categories of the web: one per domain family, so the shape tells who travels how. */
export const RADAR_METRICS: readonly MetricKey[] = [
  "flightKm",
  "countries",
  "nights",
  "railKm",
  "cruiseKm",
  "places",
  "daysAway",
];

export interface RadarAxis {
  key: MetricKey;
  mine: number;
  theirs: number;
}

/**
 * Axes with a real, like-for-like number on BOTH sides and a non-zero maximum. A withheld,
 * partial or unlike figure is not drawn at zero — the axis is left out.
 */
export function radarAxes(cells: Record<string, { mine: Cell; theirs: Cell }>): RadarAxis[] {
  return RADAR_METRICS.flatMap((key) => {
    const c = cells[key];
    // A lower bound ("≥") is no point on a shared scale: leave the axis out, as the bars do.
    if (!c || c.mine.value === null || c.theirs.value === null) return [];
    if (c.mine.partial || c.theirs.partial) return [];
    if (c.mine.value === 0 && c.theirs.value === 0) return [];
    return [{ key, mine: c.mine.value, theirs: c.theirs.value }];
  });
}

const SIZE = 280;
const C = SIZE / 2;
const R = 100;

interface Props {
  axes: RadarAxis[];
  youLabel: string;
  name: string;
}

export default function CompareRadar({ axes, youLabel, name }: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const { colorOf } = useDomainColors();
  if (axes.length < 3)
    return (
      <p className="t-caption" data-testid="radar-too-few">
        {String(t("radar.tooFew"))}
      </p>
    );
  const at = (i: number, share: number): [number, number] => {
    const a = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [C + Math.cos(a) * R * share, C + Math.sin(a) * R * share];
  };
  const shape = (pick: (a: RadarAxis) => number): string =>
    axes
      .map((a, i) => {
        const top = Math.max(a.mine, a.theirs);
        return at(i, pick(a) / top).join(",");
      })
      .join(" ");
  return (
    <figure style={{ margin: 0 }} data-testid="compare-radar">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={String(t("radar.alt", { you: youLabel, name }))}
        style={{ width: "100%", maxWidth: 320, display: "block", margin: "0 auto" }}
      >
        {[0.5, 1].map((r) => (
          <polygon
            key={r}
            points={axes.map((_, i) => at(i, r).join(",")).join(" ")}
            fill="none"
            stroke="var(--ts-border)"
          />
        ))}
        {axes.map((a, i) => {
          const [x, y] = at(i, 1);
          const [lx, ly] = at(i, 1.22);
          const domain = LEADERBOARD_METRICS.find((m) => m.key === a.key)?.domain ?? null;
          return (
            <g key={a.key}>
              <line x1={C} y1={C} x2={x} y2={y} stroke="var(--ts-border)" />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fill={domain ? colorOf(domain) : "var(--ts-text)"}
              >
                {String(t(`metric.${a.key}`))}
              </text>
            </g>
          );
        })}
        <polygon
          points={shape((a) => a.theirs)}
          fill="var(--ts-text)"
          fillOpacity={0.15}
          stroke="var(--ts-text)"
          strokeWidth={1.5}
          data-testid="radar-them"
        />
        <polygon
          points={shape((a) => a.mine)}
          fill="var(--ts-accent)"
          fillOpacity={0.25}
          stroke="var(--ts-accent)"
          strokeWidth={2}
          data-testid="radar-you"
        />
      </svg>
      <figcaption className="t-caption" style={{ textAlign: "center" }}>
        {String(t("radar.hint"))}
      </figcaption>
    </figure>
  );
}
