/**
 * The per-aircraft trace files of a tar1090 / readsb receiver (forgejo#408 phase 3).
 *
 * Format source: wiedehopf/readsb `README-json.md` ("trace_full_<hex>.json",
 * "trace_recent_<hex>.json") and the tar1090 front end that consumes them
 * (`html/script.js`, `processTraceData`). A file is
 *
 *   { "icao": "4ca6b6", "r": "EI-DEA", "t": "A320", "timestamp": 1700000000.5,
 *     "trace": [ [secs, lat, lon, alt, gs, track, flags, vrate, detail, …], … ] }
 *
 * `timestamp` is the epoch second the offsets count from; `secs` is the offset
 * of one fix (fractional); `alt` is barometric feet, the string "ground" or
 * null; `gs` knots; `flags` a bit set — bit 0 (1) stale position, bit 1 (2)
 * "new leg" (the aircraft was not heard for a while, or took off/landed).
 * Trailing columns (geometric altitude, detail objects, …) vary by readsb
 * version and are ignored here.
 *
 * Nothing in this file touches the network; the fixtures in
 * `__tests__/traceFixtures.ts` are written in exactly this shape.
 */

import type { FlightTrackPoint } from "../../schemas/flightDevice";

const FEET_TO_METRES = 0.3048;
const KNOTS_TO_MS = 0.514444;
const FLAG_STALE = 1;
const FLAG_NEW_LEG = 2;

export type TraceRefusal = "notATrace" | "noFixes";

export interface TraceLeg {
  points: FlightTrackPoint[];
}

export type TraceParse =
  { ok: true; legs: TraceLeg[]; registration: string | null } | { ok: false; reason: TraceRefusal };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One trace file's JSON as legs of time-ordered fixes. A body of another shape is refused, never read as empty. */
export function parseTrace(body: unknown): TraceParse {
  const file = body as { timestamp?: unknown; trace?: unknown; r?: unknown } | null;
  if (!file || typeof file !== "object" || !isNum(file.timestamp) || !Array.isArray(file.trace)) {
    return { ok: false, reason: "notATrace" };
  }
  const legs: TraceLeg[] = [];
  let current: TraceLeg | null = null;
  for (const row of file.trace) {
    if (!Array.isArray(row)) continue;
    const [secs, lat, lon, alt, gs, , flags] = row as unknown[];
    if (!isNum(secs) || !isNum(lat) || !isNum(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const flagBits = isNum(flags) ? flags : 0;
    // A stale position is the last known one repeated, not a measurement.
    if (flagBits & FLAG_STALE) continue;
    const point: FlightTrackPoint = { t: Math.round((file.timestamp + secs) * 1000), lat, lon };
    if (isNum(alt)) {
      const metres = alt * FEET_TO_METRES;
      if (metres >= -1000 && metres <= 30_000) point.alt = metres;
    }
    if (isNum(gs) && gs >= 0) point.speed = Math.min(gs * KNOTS_TO_MS, 1000);
    if (!current || flagBits & FLAG_NEW_LEG) {
      current = { points: [] };
      legs.push(current);
    }
    current.points.push(point);
  }
  const usable = legs.filter((leg) => leg.points.length > 0);
  if (usable.length === 0) return { ok: false, reason: "noFixes" };
  const registration =
    typeof file.r === "string" && file.r.trim() ? file.r.trim().toUpperCase() : null;
  return { ok: true, legs: usable, registration };
}

/**
 * The leg that overlaps `[fromMs, toMs]` the most (a day file holds every
 * flight of the aircraft that day), or null when none overlaps at all.
 */
export function pickLegInWindow(
  legs: readonly TraceLeg[],
  fromMs: number,
  toMs: number
): TraceLeg | null {
  let best: TraceLeg | null = null;
  let bestOverlap = 0;
  for (const leg of legs) {
    const start = leg.points[0].t;
    const end = leg.points[leg.points.length - 1].t;
    const overlap = Math.min(end, toMs) - Math.max(start, fromMs);
    if (overlap > bestOverlap) {
      best = leg;
      bestOverlap = overlap;
    }
  }
  return best;
}
