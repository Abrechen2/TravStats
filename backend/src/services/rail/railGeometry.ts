import { railProviderSwitches } from "./lookup";
import { fetchTransitousLine } from "./lookup/transitous";
import { isTracedShape, lineLengthKm, sliceBetween, type LonLat } from "./railGeometryMath";

/**
 * Which line a journey is drawn with (spec 2026-09-25-rail-domain,
 * "Geometry"). Fetched ONCE, when the journey is saved with a Transitous
 * match or its stations change, and frozen with the row: a timetable changes,
 * the ride that happened does not.
 */

export interface JourneyGeometry {
  geometry: LonLat[] | null;
  geometrySource: "straight" | "transitous";
}

const STRAIGHT: JourneyGeometry = { geometry: null, geometrySource: "straight" };

/**
 * The traced line between the two stations, or the straight line when there
 * is no Transitous match, the provider is switched off or does not answer,
 * a station is not on the traced line, or the "trace" is really a chain of
 * station-to-station chords (a feed without shapes) — a straight line is
 * never stored under the name `transitous`.
 */
export async function resolveJourneyGeometry(input: {
  lookupProvider: string | null;
  lookupRef: string | null;
  dep: { lat: number; lon: number };
  arr: { lat: number; lon: number };
}): Promise<JourneyGeometry> {
  if (input.lookupProvider !== "transitous" || !input.lookupRef) return STRAIGHT;
  if (!(await railProviderSwitches()).transitous) return STRAIGHT;
  const line = await fetchTransitousLine(input.lookupRef);
  if (!line) return STRAIGHT;
  const slice = sliceBetween(line, [input.dep.lon, input.dep.lat], [input.arr.lon, input.arr.lat]);
  if (!slice || !isTracedShape(slice)) return STRAIGHT;
  return { geometry: slice, geometrySource: "transitous" };
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
