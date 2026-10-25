import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { TravTrackMonths } from "../../../lib/api/travtrackMonths";
import { COUNTRY_NUMERIC_TO_ALPHA2, UNCODED_SHAPES } from "../../../shared/geo/countryNumeric";

/**
 * The Track map's countries layer (TravTrack plan T5.3, "Länder"): which
 * countries the shown span touched, from what the server already derived
 * safely — the monthly values' country codes (UTC months, built from the
 * privacy-safe line). No endpoint answers countries for an arbitrary span,
 * so the layer colours the countries of every month the span touches, and
 * the hint says so. Shapes come from the boundaries the frontend ships.
 */

/** `YYYY-MM` of every UTC month the span `[fromDay, toDay]` touches. */
export function monthsOfSpan(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let [y, m] = [Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7))];
  const end = toDay.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) return out;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/** The years a span touches, for the monthly-values reads. */
export const yearsOfSpan = (fromDay: string, toDay: string): number[] => {
  const years: number[] = [];
  for (let y = Number(fromDay.slice(0, 4)); y <= Number(toDay.slice(0, 4)); y++) years.push(y);
  return years;
};

export interface VisitedCountries {
  /** ISO alpha-2 codes, sorted. */
  codes: string[];
  /** Touched months still being recomputed: their countries may still change. */
  pending: string[];
}

/** The countries of the months the span touches, from the years' monthly values. */
export function visitedCountriesOf(
  years: readonly TravTrackMonths[],
  fromDay: string,
  toDay: string
): VisitedCountries {
  const touched = new Set(monthsOfSpan(fromDay, toDay));
  const codes = new Set<string>();
  const pending = new Set<string>();
  for (const year of years) {
    for (const month of year.months) {
      if (touched.has(month.month)) month.countries.forEach((c) => codes.add(c.toUpperCase()));
    }
    for (const month of year.pending) if (touched.has(month)) pending.add(month);
  }
  return { codes: [...codes].sort(), pending: [...pending].sort() };
}

/** The alpha-2 code of one shipped shape, or null for a shape no code names. */
export function shapeCode(shape: Feature<Geometry>): string | null {
  const id = shape.id === undefined || shape.id === null ? null : String(shape.id).padStart(3, "0");
  if (id && COUNTRY_NUMERIC_TO_ALPHA2[id]) return COUNTRY_NUMERIC_TO_ALPHA2[id];
  const name = (shape.properties as { name?: unknown } | null)?.name;
  return typeof name === "string" ? (UNCODED_SHAPES[name] ?? null) : null;
}

/** The shapes of the visited countries only — the others are not drawn at all. */
export function visitedShapes(
  world: FeatureCollection<Geometry>,
  codes: readonly string[]
): Feature<Geometry>[] {
  const wanted = new Set(codes);
  return world.features.filter((f) => {
    const code = shapeCode(f);
    return code !== null && wanted.has(code);
  });
}
