import type { JSX } from "react";
import { token } from "../../../components/ui/tokens";
import type { RoadtripDraft } from "./roadtripDraft";

const W = 640;
const H = 220;
const PAD = 12;

/**
 * The line a roadtrip would get, as a small drawing: the recorded stretches
 * solid, the chords across recording gaps dashed (estimated), the stations as
 * dots. A sketch, not a map — no tiles, no WebGL context in a dialog.
 */
export default function RoadtripSketch({
  draft,
  label,
}: {
  draft: RoadtripDraft;
  label: string;
}): JSX.Element | null {
  const all = [
    ...draft.legs.flatMap((l) => l.coordinates),
    ...draft.stations.map((s): [number, number] => [s.lon, s.lat]),
  ];
  if (all.length === 0) return null;
  const midLat = all.reduce((n, c) => n + c[1], 0) / all.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = all.map((c) => c[0] * k);
  const ys = all.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const scale = Math.min(
    (W - 2 * PAD) / (maxX - minX || 1e-6),
    (H - 2 * PAD) / (maxY - minY || 1e-6)
  );
  const at = ([lon, lat]: [number, number]): string =>
    `${(PAD + (lon * k - minX) * scale).toFixed(1)},${(H - PAD - (lat - minY) * scale).toFixed(1)}`;
  const line = token("live");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      data-testid="roadtrip-sketch"
      style={{ width: "100%", height: "auto", background: token("surface2"), borderRadius: 8 }}
    >
      {draft.legs.map((l) => (
        <polyline
          key={`${l.fromKey}-${l.toKey}`}
          points={l.coordinates.map(at).join(" ")}
          fill="none"
          stroke={line}
          strokeWidth={2}
        />
      ))}
      {draft.legs.flatMap((l) =>
        l.estimated.map((chord, i) => (
          <polyline
            key={`${l.fromKey}-gap-${i}`}
            data-testid="roadtrip-sketch-estimated"
            points={chord.map((c) => at(c as [number, number])).join(" ")}
            fill="none"
            stroke={token("muted")}
            strokeWidth={2}
            strokeDasharray="6 6"
          />
        ))
      )}
      {draft.stations.map((s) => {
        const [x, y] = at([s.lon, s.lat]).split(",");
        return <circle key={s.key} cx={x} cy={y} r={4} fill={token("text")} />;
      })}
    </svg>
  );
}
