import { RAIL_GEOMETRY_FALLBACK_REASONS } from "../../schemas/rail";
import { railProviderSwitches } from "./lookup";
import { fetchTransitousLine } from "./lookup/transitous";
import { railRoutingBaseUrl, routeRailLine } from "./openRailRouting";
import { isTracedShape, lineLengthKm, sliceBetween, type LonLat } from "./railGeometryMath";

/**
 * Which line a journey is drawn with (spec 2026-09-25-rail-domain,
 * "Geometry"). Fetched ONCE, when the journey is saved with a Transitous
 * match or its stations change, and frozen with the row: a timetable changes,
 * the ride that happened does not.
 */

/**
 * Why a Transitous match was saved without its traced line. Null when no
 * traced line was asked for (no match, or a db-rest match, which traces
 * nothing) — a straight line there is the plan, not a failure.
 */
export type GeometryFallbackReason = (typeof RAIL_GEOMETRY_FALLBACK_REASONS)[number];

export interface JourneyGeometry {
  geometry: LonLat[] | null;
  geometrySource: "straight" | "transitous" | "openrailrouting";
  /**
   * Why the line is not the train's own trace. Null when nothing that was
   * asked for failed. On an `openrailrouting` line it names why the Transitous
   * trace was not used (null when there was no match to trace).
   */
  fallback: GeometryFallbackReason | null;
}

const straight = (fallback: GeometryFallbackReason | null): JourneyGeometry => ({
  geometry: null,
  geometrySource: "straight",
  fallback,
});

/**
 * The Transitous trace between the two stations, or the straight line when
 * there is no Transitous match, the provider is switched off or does not
 * answer, a station is not on the traced line, or the "trace" is really a
 * chain of station-to-station chords (a feed without shapes) — a straight
 * line is never stored under the name `transitous`. Every one of those but
 * the first says why, so the caller can tell the user instead of saving in
 * silence.
 */
async function transitousGeometry(input: {
  lookupProvider: string | null;
  lookupRef: string | null;
  dep: { lat: number; lon: number };
  arr: { lat: number; lon: number };
}): Promise<JourneyGeometry> {
  if (input.lookupProvider !== "transitous" || !input.lookupRef) return straight(null);
  if (!(await railProviderSwitches()).transitous) return straight("providerDisabled");
  const line = await fetchTransitousLine(input.lookupRef);
  if (!line) return straight("providerUnavailable");
  const slice = sliceBetween(line, [input.dep.lon, input.dep.lat], [input.arr.lon, input.arr.lat]);
  if (!slice) return straight("stationOffLine");
  if (!isTracedShape(slice)) return straight("untracedShape");
  return { geometry: slice, geometrySource: "transitous", fallback: null };
}

/**
 * Which line a journey is saved with. The train's own Transitous trace first;
 * without one, and only where the admin configured an OpenRailRouting, the
 * line over the tracks between the stations (and the stops between them, in
 * order, when known) — ONE request per save. Its failure is reported as
 * `railRoutingUnavailable` / `railRoutingNoRoute` and the journey keeps the
 * straight line under the name `straight`, never a chord presented as routed.
 */
export async function resolveJourneyGeometry(input: {
  lookupProvider: string | null;
  lookupRef: string | null;
  dep: { lat: number; lon: number };
  arr: { lat: number; lon: number };
  via?: ReadonlyArray<{ lat: number; lon: number }>;
}): Promise<JourneyGeometry> {
  const traced = await transitousGeometry(input);
  if (traced.geometrySource !== "straight") return traced;
  const baseUrl = await railRoutingBaseUrl();
  if (!baseUrl) return traced;
  const points: LonLat[] = [input.dep, ...(input.via ?? []), input.arr].map((p) => [p.lon, p.lat]);
  const routed = await routeRailLine(baseUrl, points);
  if (!routed.ok) {
    return straight(routed.reason === "noRoute" ? "railRoutingNoRoute" : "railRoutingUnavailable");
  }
  // The routed line ends at the rail network's nearest node; the stations'
  // own positions are its ends, as a Transitous slice has them.
  const line: LonLat[] = [points[0], ...routed.line.slice(1, -1), points[points.length - 1]];
  return { geometry: line, geometrySource: "openrailrouting", fallback: traced.fallback };
}

/** One decimal, like the great-circle figure beside it. */
export function tracedLengthKm(geometry: LonLat[]): number {
  return Math.round(lineLengthKm(geometry) * 10) / 10;
}

/** A stored `geometry` value read back, or null when it is not a line. */
export function readStoredLine(value: unknown): LonLat[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const ok = value.every(
    (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number")
  );
  return ok ? (value as LonLat[]) : null;
}

/** The stored row as the edit rule reads it. */
export interface StoredJourneyLine {
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  lookupProvider: string | null;
  lookupRef: string | null;
  geometry: unknown;
  geometrySource: string;
}

/**
 * What an edit did to the line: left it alone (`unchanged`), fetched it again
 * (`refetched`), or tried to and kept the frozen one (`kept`) because the new
 * answer was worse than what the row already had.
 */
export type GeometryEdit =
  | { kind: "unchanged" }
  | { kind: "refetched"; geo: JourneyGeometry }
  | {
      kind: "kept";
      line: LonLat[];
      geometrySource: string;
      fallback: GeometryFallbackReason | null;
    };

/**
 * How close a stored line is to the ride that happened: the train's own trace,
 * then a line over the tracks (routed, or brought from a roadtrip), then the
 * chord. An edit never trades a line for a worse one because a fetch failed.
 */
function lineRank(geometrySource: string): number {
  if (geometrySource === "transitous") return 2;
  return geometrySource === "straight" || geometrySource === "none" ? 0 : 1;
}

const sameLookup = (
  a: { provider: string | null; ref: string | null },
  b: { provider: string | null; ref: string | null }
): boolean => a.provider === b.provider && a.ref === b.ref;

/**
 * The edit rule for the frozen line (review 2026-09-26, finding 1). The form
 * sends both stations and the match on EVERY save, so "was it in the body" is
 * no signal: the line is fetched again only when the coordinates of a station
 * or the identity of the match actually differ from the stored row. Editing a
 * seat or the placeholder noon of a converted ride leaves the line alone.
 *
 * When it IS fetched again and the answer is not a Transitous trace (a
 * straight line, or a line OpenRailRouting routed after the trace failed),
 * the stored line survives if it is at least as good and still runs between
 * the (possibly moved) stations — a traced
 * or roadtrip line is never thrown away because a re-fetch failed, and a line
 * whose match the user kept is re-cut rather than dropped when a station moves
 * along it. Only a deliberate change of the match (or its removal) with a
 * clean answer replaces it.
 */
export async function resolveEditedGeometry(
  existing: StoredJourneyLine,
  next: {
    lookup: { provider: string | null; ref: string | null };
    dep: { lat: number; lon: number };
    arr: { lat: number; lon: number };
  }
): Promise<GeometryEdit> {
  const lookupChanged = !sameLookup(next.lookup, {
    provider: existing.lookupProvider,
    ref: existing.lookupRef,
  });
  const stationsMoved =
    next.dep.lat !== existing.depLat ||
    next.dep.lon !== existing.depLon ||
    next.arr.lat !== existing.arrLat ||
    next.arr.lon !== existing.arrLon;
  if (!lookupChanged && !stationsMoved) return { kind: "unchanged" };

  const geo = await resolveJourneyGeometry({
    lookupProvider: next.lookup.provider,
    lookupRef: next.lookup.ref,
    dep: next.dep,
    arr: next.arr,
  });
  if (geo.geometrySource === "transitous") return { kind: "refetched", geo };

  const failed = geo.fallback !== null;
  const stored = existing.geometrySource === "straight" ? null : readStoredLine(existing.geometry);
  // A line routed over the tracks is the next best thing to a trace, not its
  // equal: a stored trace whose re-fetch failed is not swapped for it.
  const storedAtLeastAsGood = lineRank(existing.geometrySource) >= lineRank(geo.geometrySource);
  if (stored && storedAtLeastAsGood && (failed || !lookupChanged)) {
    const slice = sliceBetween(stored, [next.dep.lon, next.dep.lat], [next.arr.lon, next.arr.lat]);
    if (slice && isTracedShape(slice)) {
      return {
        kind: "kept",
        line: slice,
        geometrySource: existing.geometrySource,
        fallback: geo.fallback,
      };
    }
  }
  return { kind: "refetched", geo };
}
