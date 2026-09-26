import type { Lodging, LodgingStay } from "../../types/lodging";

/** A stay the picker can offer, flattened out of its lodging. */
export interface PickableStay {
  id: string;
  label: string;
  checkIn: string | null;
  checkOut: string | null;
  /** Offered, but marked: a cancelled stay links fine and counts no night. */
  cancelled: boolean;
  lodgingId: string;
  /**
   * Where the lodging is, so linking it can place a station that has no
   * point yet. Null when the lodging was saved without coordinates.
   */
  lat: number | null;
  lon: number | null;
}

/** The station's dates the picker ranks by. */
export interface StationSpan {
  startDate: string | null;
  endDate: string | null;
}

const DAY_MS = 86_400_000;
/** A stay checked in this many days from the station's arrival is "nearby". */
export const NEARBY_DAYS = 3;
/** Lodgings listed at once; a search narrows the rest. */
export const LODGING_LIMIT = 12;
/**
 * Two points closer than this are the same place. A station placed by a
 * search and the lodging's own pin rarely match to the metre, and offering
 * "take the lodging's place" for 30 m would be noise.
 */
const SAME_PLACE_KM = 0.1;

export function toPickable(lodging: Lodging, stay: LodgingStay): PickableStay {
  return {
    id: stay.id,
    label: lodging.name,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    cancelled: stay.status === "cancelled",
    lodgingId: lodging.id,
    lat: lodging.lat ?? null,
    lon: lodging.lon ?? null,
  };
}

function day(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

/** Days between a stay's check-in and the station's arrival; Infinity when either is unknown. */
export function daysFromArrival(stay: { checkIn: string | null }, span: StationSpan): number {
  const a = day(span.startDate);
  const b = day(stay.checkIn);
  return a === null || b === null ? Number.POSITIVE_INFINITY : Math.abs(b - a);
}

/**
 * Whether a stay covers the station: its nights and the station's overlap.
 * A missing end counts as the one night after the start, the same reading
 * the station editor gives a station without a departure.
 */
export function overlapsSpan(
  stay: { checkIn: string | null; checkOut: string | null },
  span: StationSpan
): boolean {
  const s0 = day(span.startDate);
  const t0 = day(stay.checkIn);
  if (s0 === null || t0 === null) return false;
  const s1 = day(span.endDate) ?? s0 + 1;
  const t1 = day(stay.checkOut) ?? t0 + 1;
  return t0 < Math.max(s1, s0 + 1) && s0 < Math.max(t1, t0 + 1);
}

/** Stays with a check-in near the station's arrival, the likeliest answer first. */
export function nearbyStays(lodgings: readonly Lodging[], span: StationSpan): PickableStay[] {
  return lodgings
    .flatMap((l) => l.stays.map((s) => toPickable(l, s)))
    .filter((s) => daysFromArrival(s, span) <= NEARBY_DAYS)
    .sort((a, b) => daysFromArrival(a, span) - daysFromArrival(b, span))
    .slice(0, LODGING_LIMIT);
}

/**
 * Every lodging of the user, whether or not it has a stay yet — the tester's
 * campsite had none, and the picker used to build its list from stays alone,
 * so the lodging could not be found (2026-09-26). A query matches name, city
 * and country; without one, lodgings with a stay near the station's dates
 * come first.
 */
export function matchingLodgings(
  lodgings: readonly Lodging[],
  query: string,
  span: StationSpan
): Lodging[] {
  const q = query.trim().toLowerCase();
  const nearest = (l: Lodging): number =>
    l.stays.reduce((best, s) => Math.min(best, daysFromArrival(s, span)), Number.POSITIVE_INFINITY);
  return lodgings
    .filter(
      (l) =>
        q === "" || [l.name, l.city, l.country].some((v) => (v ?? "").toLowerCase().includes(q))
    )
    .map((l) => ({ l, d: nearest(l) }))
    .sort((a, b) => a.d - b.d || a.l.name.localeCompare(b.l.name))
    .slice(0, LODGING_LIMIT)
    .map(({ l }) => l);
}

/** One lodging's stays, those covering the station first, then the nearest in time. */
export function staysOf(
  lodging: Lodging,
  span: StationSpan
): Array<PickableStay & { fits: boolean }> {
  return lodging.stays
    .map((s) => ({ ...toPickable(lodging, s), fits: overlapsSpan(s, span) }))
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) || daysFromArrival(a, span) - daysFromArrival(b, span)
    );
}

/** Whether two points are further apart than a rounding difference. */
export function isOtherPlace(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): boolean {
  const kmPerDeg = 111.32;
  const dLat = (a.lat - b.lat) * kmPerDeg;
  const dLon = (a.lon - b.lon) * kmPerDeg * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon) > SAME_PLACE_KM;
}
