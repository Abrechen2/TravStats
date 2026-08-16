import type { Cruise } from "../../types/cruise";
import type { GeoJSONFeature } from "../../types";
import {
  effectiveTimedSequence,
  type EffectiveSequenceEntry,
} from "../Cruise/cruisePorts";

/**
 * Helpers that drive the Globe time-slider. Everything here is pure
 * (Date in, primitive or POJO out) so the unit tests don't need any
 * React or Zustand setup.
 */

/** Per-leg date metadata. Each cruise contributes (n_sequence_entries - 1)
 * entries — one for each consecutive pair in the *effective* sequence
 * (departure port → port calls → arrival port, via `effectiveTimedSequence`),
 * in itinerary order. */
export interface CruiseLegDates {
  cruiseId: string;
  fromPortId: number;
  toPortId: number;
  /** When the ship departs the `from` entry. Falls back to
   * `cruise.startDate + (fromEntry.dayNumber - 1) days` if the explicit
   * `departureTime` is null. */
  startDate: Date;
  /** When the ship arrives at the `to` entry. Falls back analogously. */
  endDate: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const safeDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Per-leg dates for one cruise. Returns an empty list if the cruise has no
 * usable startDate AND no per-stop times — there's nothing to pin a date to.
 *
 * Walks the SAME effective sequence the geometry endpoint uses, departure and
 * arrival ports included. Building it from stop rows alone (as this did until
 * 2026-08-16) dropped the first and last leg, because those two ports live on
 * the cruise row — and `GlobeView` pairs geometry to dates by
 * `fromPortId:toPortId`, so those legs simply vanished in slider mode.
 */
export const computeCruiseLegDates = (cruise: Cruise): CruiseLegDates[] => {
  const cruiseStart = safeDate(cruise.startDate);
  const seq = effectiveTimedSequence(cruise);
  if (seq.length < 2) return [];

  const entryDate = (e: EffectiveSequenceEntry, which: "arrival" | "departure"): Date | null => {
    const explicit = safeDate(which === "arrival" ? e.arrivalTime : e.departureTime);
    if (explicit) return explicit;
    if (cruiseStart) {
      // dayNumber is 1-based. Day 1 = cruiseStart at midnight UTC.
      return new Date(cruiseStart.getTime() + (e.dayNumber - 1) * ONE_DAY_MS);
    }
    return null;
  };

  const out: CruiseLegDates[] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const from = seq[i];
    const to = seq[i + 1];
    const start = entryDate(from, "departure") ?? entryDate(from, "arrival");
    const end = entryDate(to, "arrival") ?? entryDate(to, "departure");
    if (!start || !end) continue;
    out.push({
      cruiseId: cruise.id,
      fromPortId: from.port.id,
      toPortId: to.port.id,
      startDate: start,
      // If the data is corrupt and end < start, force a zero-length window so
      // the leg appears at exactly start and stays.
      endDate: end.getTime() < start.getTime() ? start : end,
    });
  }
  return out;
};

/** Earliest & latest date across every flight + cruise. Returns null
 * when nothing has any usable date (unusual — would mean a brand-new
 * empty account). */
export const computeTimeRange = (
  flights: GeoJSONFeature[],
  cruises: Cruise[]
): { min: Date; max: Date } | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const f of flights) {
    const d = safeDate(f.properties.departureTime);
    if (d) {
      const t = d.getTime();
      if (t < min) min = t;
      if (t > max) max = t;
    }
    const a = safeDate(f.properties.arrivalTime);
    if (a) {
      const t = a.getTime();
      if (t > max) max = t;
    }
  }

  for (const c of cruises) {
    const s = safeDate(c.startDate);
    if (s) {
      const t = s.getTime();
      if (t < min) min = t;
      if (t > max) max = t;
    }
    const e = safeDate(c.endDate);
    if (e) {
      const t = e.getTime();
      if (t > max) max = t;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: new Date(min), max: new Date(max) };
};

/* ---------------------- Activity histogram ---------------------- */

export interface MonthBucket {
  /** First instant of the month (UTC). */
  start: Date;
  flights: number;
  cruises: number;
}

/**
 * Monthly activity counts for the time histogram — one bucket per month
 * from rangeMin's month through rangeMax's month (inclusive). Flights are
 * counted by departureTime, cruises by startDate. Pure; buckets are
 * contiguous so the histogram's x-axis maps linearly to time.
 */
export const computeMonthlyBuckets = (
  flights: GeoJSONFeature[],
  cruises: Cruise[],
  rangeMin: Date,
  rangeMax: Date
): MonthBucket[] => {
  const key = (d: Date): string => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const fCount = new Map<string, number>();
  const cCount = new Map<string, number>();
  for (const f of flights) {
    const d = safeDate(f.properties.departureTime);
    if (d) fCount.set(key(d), (fCount.get(key(d)) ?? 0) + 1);
  }
  for (const c of cruises) {
    const d = safeDate(c.startDate);
    if (d) cCount.set(key(d), (cCount.get(key(d)) ?? 0) + 1);
  }

  const buckets: MonthBucket[] = [];
  const cur = new Date(Date.UTC(rangeMin.getUTCFullYear(), rangeMin.getUTCMonth(), 1));
  const end = new Date(Date.UTC(rangeMax.getUTCFullYear(), rangeMax.getUTCMonth(), 1));
  // Guard against a pathological range producing thousands of buckets.
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 1200) {
    const k = key(cur);
    buckets.push({
      start: new Date(cur),
      flights: fCount.get(k) ?? 0,
      cruises: cCount.get(k) ?? 0,
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
    guard++;
  }
  return buckets;
};

/* ---------------------- Live-mode visibility ---------------------- */

/** A flown flight is visible from departureTime forward — a "I've
 * been there" mark, not an in-flight animation. Flights without a
 * departureTime stay hidden in live mode (we have no way to time
 * them). */
export const flightVisibleLive = (flight: GeoJSONFeature, currentDate: Date): boolean => {
  const d = safeDate(flight.properties.departureTime);
  return d !== null && d.getTime() <= currentDate.getTime();
};

/** Returns 0 if the leg hasn't started yet, 1 if it's fully drawn,
 * or a fractional progress in [0, 1) while the ship is between ports.
 * Zero-duration legs (start === end) collapse to 0/1 with no
 * intermediate phase. */
export const legProgress = (leg: CruiseLegDates, currentDate: Date): number => {
  const t = currentDate.getTime();
  const s = leg.startDate.getTime();
  const e = leg.endDate.getTime();
  if (t < s) return 0;
  if (t >= e) return 1;
  if (e === s) return 1;
  return (t - s) / (e - s);
};

/* --------------------- Filter-mode visibility --------------------- */

/** Filter mode is inclusive on both ends. A flight on the filter end
 * date is visible. */
export const flightVisibleFilter = (flight: GeoJSONFeature, start: Date, end: Date): boolean => {
  const d = safeDate(flight.properties.departureTime);
  if (!d) return false;
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
};

/** A leg overlaps a filter window if any part of [legStart, legEnd]
 * intersects [start, end]. Easier as the negation of "fully outside". */
export const legVisibleFilter = (leg: CruiseLegDates, start: Date, end: Date): boolean => {
  return leg.endDate.getTime() >= start.getTime() && leg.startDate.getTime() <= end.getTime();
};

/* --------------------- Polyline truncation --------------------- */

/**
 * Return the leading prefix of a polyline that covers `progress` of
 * its total great-circle length. Used in live mode to draw the part
 * of a cruise leg that the ship has already traversed. The breakpoint
 * vertex is interpolated linearly in lat/lon space — fine for the
 * ~50-150 km segment scale this runs at; great-circle interpolation
 * would be an over-engineered nicety.
 *
 * @param coords [lat, lng] pairs (react-globe.gl convention).
 * @param progress 0 = empty, 1 = the full input.
 */
export const truncatePolyline = (
  coords: Array<[number, number]>,
  progress: number
): Array<[number, number]> => {
  if (progress >= 1 || coords.length < 2) return coords;
  if (progress <= 0) return [];

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineKm(coords[i - 1], coords[i]);
    segLengths.push(d);
    total += d;
  }
  if (total === 0) return coords;

  const target = total * progress;
  let acc = 0;
  const out: Array<[number, number]> = [coords[0]];
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (acc + segLen >= target) {
      const remain = target - acc;
      const t = segLen === 0 ? 1 : remain / segLen;
      const a = coords[i];
      const b = coords[i + 1];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      return out;
    }
    out.push(coords[i + 1]);
    acc += segLen;
  }
  return out;
};

const EARTH_RADIUS_KM = 6371;

const haversineKm = (a: [number, number], b: [number, number]): number => {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};
