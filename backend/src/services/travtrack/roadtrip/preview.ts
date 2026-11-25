import { haversineKm } from "../../../shared/geo/haversine";
import { simplifyDegrees } from "../../schematicPolyline";
import type { StoredPoint } from "../../tripRecording/segments";
import type { Stop } from "../legs";

/**
 * "Als Roadtrip übernehmen" (rc46 extras, part A): the stations and the line a
 * roadtrip would get from a recorded TravTrack span. Pure — the route reads
 * the privacy-safe segments and the stops (`deriveDay`), this turns them into
 * what the preview shows and the roadtrip write sends.
 *
 * - A station is a stop of the span that lasted at least `minDwellMs` and was
 *   not dismissed as a wait, plus the span's first and last fix when no stop
 *   sits there already.
 * - The line between two stations is the recorded fixes between them. Where
 *   the recording has a gap (two fixes in different segments), the two are
 *   joined by a straight chord and that chord is counted as ESTIMATED — it is
 *   drawn dashed and its kilometres are said apart from the measured ones.
 * - A station names the user's place it lies at (within `placeRadiusM`),
 *   otherwise the name the owner accepted for the stop, otherwise nothing:
 *   the dialog then offers "Halt N" for the user to rename.
 */

export const PREVIEW_DEFAULTS = {
  minDwellMs: 15 * 60_000,
  placeRadiusM: 200,
  /** A stop this close to the first/last fix IS the start/end. */
  edgeMs: 10 * 60_000,
  /** The drawn-leg limit of the tour API (`legOverrideSchema`). */
  maxWaypoints: 256,
} as const;

export type PreviewPlace = { id: string; name: string; lat: number; lon: number };

export type PreviewStation = {
  key: string;
  kind: "start" | "stop" | "end";
  name: string | null;
  nameSource: "place" | "stop" | null;
  placeId: string | null;
  lat: number;
  lon: number;
  arriveMs: number | null;
  departMs: number | null;
  dwellMs: number | null;
};

export type PreviewLeg = {
  fromKey: string;
  toKey: string;
  /** `[lon, lat]`, at most `maxWaypoints`, first and last on the stations. */
  coordinates: [number, number][];
  /** The chords drawn across recording gaps, each `[[lon, lat], [lon, lat]]`. */
  estimated: [number, number][][];
  distanceKm: number;
  estimatedKm: number;
};

export type RoadtripPreview = {
  stations: PreviewStation[];
  legs: PreviewLeg[];
  distanceKm: number;
  estimatedKm: number;
};

type Vertex = { t: number; lat: number; lon: number; seg: number };

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => haversineKm(a, b);

function nearestPlace(
  at: { lat: number; lon: number },
  places: readonly PreviewPlace[],
  radiusM: number
): PreviewPlace | null {
  let best: PreviewPlace | null = null;
  let bestM = radiusM;
  for (const p of places) {
    const m = km(at, p) * 1000;
    if (m <= bestM) {
      best = p;
      bestM = m;
    }
  }
  return best;
}

function station(
  kind: PreviewStation["kind"],
  key: string,
  at: { lat: number; lon: number },
  times: { arriveMs: number | null; departMs: number | null },
  stopName: string | null,
  places: readonly PreviewPlace[],
  radiusM: number
): PreviewStation {
  const place = nearestPlace(at, places, radiusM);
  const dwellMs =
    times.arriveMs !== null && times.departMs !== null ? times.departMs - times.arriveMs : null;
  return {
    key,
    kind,
    name: place?.name ?? stopName,
    nameSource: place ? "place" : stopName ? "stop" : null,
    placeId: place?.id ?? null,
    lat: at.lat,
    lon: at.lon,
    ...times,
    dwellMs,
  };
}

function stationsOf(
  vertices: readonly Vertex[],
  stops: readonly Stop[],
  places: readonly PreviewPlace[],
  o: typeof PREVIEW_DEFAULTS
): PreviewStation[] {
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const kept = stops
    .filter((s) => !s.dismissed && s.untilMs - s.fromMs >= o.minDwellMs)
    .sort((a, b) => a.fromMs - b.fromMs);
  const out: PreviewStation[] = [];
  const startsAtStop = kept.length > 0 && kept[0].fromMs - first.t <= o.edgeMs;
  if (!startsAtStop) {
    out.push(
      station(
        "start",
        `start-${first.t}`,
        first,
        { arriveMs: null, departMs: first.t },
        null,
        places,
        o.placeRadiusM
      )
    );
  }
  for (const s of kept) {
    out.push(
      station(
        "stop",
        `stop-${s.fromMs}`,
        s.anchor,
        { arriveMs: s.fromMs, departMs: s.untilMs },
        s.place?.name ?? null,
        places,
        o.placeRadiusM
      )
    );
  }
  const endsAtStop = kept.length > 0 && last.t - kept[kept.length - 1].untilMs <= o.edgeMs;
  if (!endsAtStop) {
    out.push(
      station(
        "end",
        `end-${last.t}`,
        last,
        { arriveMs: last.t, departMs: null },
        null,
        places,
        o.placeRadiusM
      )
    );
  }
  if (out.length > 0) out[0] = { ...out[0], kind: "start" };
  if (out.length > 1) out[out.length - 1] = { ...out[out.length - 1], kind: "end" };
  return out;
}

function legBetween(
  from: PreviewStation,
  to: PreviewStation,
  vertices: readonly Vertex[],
  maxWaypoints: number
): PreviewLeg {
  const fromT = from.departMs ?? from.arriveMs ?? -Infinity;
  const toT = to.arriveMs ?? to.departMs ?? Infinity;
  const inner = vertices.filter((v) => v.t > fromT && v.t < toT);
  const path: Vertex[] = [
    { t: fromT, lat: from.lat, lon: from.lon, seg: inner[0]?.seg ?? -1 },
    ...inner,
    { t: toT, lat: to.lat, lon: to.lon, seg: inner[inner.length - 1]?.seg ?? -1 },
  ];
  let distanceKm = 0;
  let estimatedKm = 0;
  const estimated: [number, number][][] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = km(a, b);
    distanceKm += d;
    // A step across segments (or a leg with no fix at all) is a guess, not a recording.
    if (a.seg !== b.seg || inner.length === 0) {
      estimatedKm += d;
      estimated.push([
        [a.lon, a.lat],
        [b.lon, b.lat],
      ]);
    }
  }
  return {
    fromKey: from.key,
    toKey: to.key,
    coordinates: capWaypoints(
      path.map((v) => [v.lon, v.lat] as [number, number]),
      maxWaypoints
    ),
    estimated,
    distanceKm,
    estimatedKm,
  };
}

/** Douglas-Peucker with a growing tolerance until the line fits the cap. */
export function capWaypoints(points: [number, number][], cap: number): [number, number][] {
  if (points.length <= cap) return points;
  let tolerance = 0.00001;
  let out = simplifyDegrees(points, tolerance);
  while (out.length > cap) {
    tolerance *= 2;
    out = simplifyDegrees(points, tolerance);
  }
  return out;
}

export function buildRoadtripPreview(
  segments: readonly (readonly StoredPoint[])[],
  stops: readonly Stop[],
  places: readonly PreviewPlace[],
  options: Partial<typeof PREVIEW_DEFAULTS> = {}
): RoadtripPreview | null {
  const o = { ...PREVIEW_DEFAULTS, ...options };
  const vertices: Vertex[] = segments.flatMap((s, seg) =>
    s.map(([t, lat, lon]) => ({ t, lat, lon, seg }))
  );
  if (vertices.length === 0) return null;
  vertices.sort((a, b) => a.t - b.t);
  const stations = stationsOf(vertices, stops, places, o);
  const legs: PreviewLeg[] = [];
  for (let i = 1; i < stations.length; i++) {
    legs.push(legBetween(stations[i - 1], stations[i], vertices, o.maxWaypoints));
  }
  return {
    stations,
    legs,
    distanceKm: legs.reduce((n, l) => n + l.distanceKm, 0),
    estimatedKm: legs.reduce((n, l) => n + l.estimatedKm, 0),
  };
}
