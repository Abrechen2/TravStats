import { useTranslation } from "../../../hooks/useTranslation";
import { Card, token } from "../../../components/ui";
import type { PlanActual, PlanStation } from "../../../lib/api/travplan";

/**
 * The plan's route (dashed, its stations as dots) under the track as it was
 * driven — a sketch, not a map: no tiles, no zoom, equirectangular with the
 * longitude squeezed by the middle latitude so a country keeps its shape. The
 * track arrives privacy-cut from the server and is drawn as it came.
 */

const VIEW_W = 1000;
const MIN_H = 260;
const MAX_H = 560;
const PAD = 48;

type LonLat = [number, number];

/** The projection and the drawing's height, which follows the route's shape. */
function projector(
  points: readonly LonLat[]
): { project: (p: LonLat) => LonLat; height: number } | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const innerW = VIEW_W - 2 * PAD;
  const height = Math.min(MAX_H, Math.max(MIN_H, (spanY / spanX) * innerW + 2 * PAD));
  const scale = Math.min(innerW / spanX, (height - 2 * PAD) / spanY);
  const offX = (VIEW_W - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return {
    height,
    project: ([lon, lat]) => [
      offX + (lon - minLon) * k * scale,
      height - offY - (lat - minLat) * scale,
    ],
  };
}

const path = (line: readonly LonLat[]) =>
  line.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

export function PlanActualSketch({
  stations,
  actual,
}: {
  stations: readonly PlanStation[];
  actual: PlanActual["actual"];
}): JSX.Element | null {
  const { t } = useTranslation("travplan");
  const planned: LonLat[] = stations.map((s) => [s.place.lon, s.place.lat]);
  const segments = actual?.segments ?? [];
  const view = projector([...planned, ...segments.flat()]);
  if (!view) return null;
  const { project, height } = view;
  return (
    <Card>
      <svg
        role="img"
        aria-label={t("actual.sketchLabel")}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <path
          d={path(planned.map(project))}
          fill="none"
          stroke={token("muted")}
          strokeWidth={2}
          strokeDasharray="8 8"
          vectorEffect="non-scaling-stroke"
        />
        {segments.map((line, i) => (
          <path
            key={i}
            d={path(line.map(project))}
            fill="none"
            stroke={token("accent")}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {planned.map((p, i) => {
          const [x, y] = project(p);
          return (
            <g key={stations[i].id}>
              <circle
                cx={x}
                cy={y}
                r={9}
                fill={token("surface")}
                stroke={token("text")}
                strokeWidth={2}
              />
              {/* A label near the right edge is set to the left of its dot, so it is never cut off. */}
              <text
                x={x > VIEW_W * 0.75 ? x - 14 : x + 14}
                y={y - 12}
                textAnchor={x > VIEW_W * 0.75 ? "end" : "start"}
                fill={token("text")}
                fontSize={22}
              >
                {stations[i].title}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="t-caption">{t("actual.sketchLegend")}</p>
    </Card>
  );
}
