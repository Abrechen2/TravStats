import { offsetMsAt } from "../../shared/time/zonedParts";

/**
 * VTIMEZONE blocks (RFC 5545 §3.6.5) for the zones the calendar feed writes
 * its local times in — generated from the runtime's own zone data through
 * `Intl`, the primitive `shared/time` already rests on, so the offsets in the
 * feed are the ones the rest of the app computes with. No dependency.
 *
 * The block describes the zone over the years the events touch: one component
 * for the offset in force at the start of that span, then one per transition,
 * each with a single DTSTART onset (no RRULE — an explicit list cannot drift
 * from the zone data, and a past rule change needs no special case). An onset
 * is the local time in the offset in force BEFORE it, as §3.6.5 requires:
 * Berlin's October change reads `DTSTART:…T030000`, `TZOFFSETFROM:+0200`.
 *
 * DAYLIGHT is any offset above the lowest one seen in the span; a zone without
 * a change in the span gets one STANDARD component.
 */

const DAY_MS = 86_400_000;
const SECOND_MS = 1000;

const pad = (n: number): string => String(n).padStart(2, "0");

/** `+0900`, `-0330`, `+054500` (seconds only where the offset has them). */
export function formatIcsOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const total = Math.round(Math.abs(offsetMs) / SECOND_MS);
  const seconds = total % 60;
  const hhmm = `${pad(Math.floor(total / 3600))}${pad(Math.floor(total / 60) % 60)}`;
  return `${sign}${hhmm}${seconds ? pad(seconds) : ""}`;
}

/** `YYYYMMDDTHHMMSS` of an instant shifted by an offset — a floating local time. */
function localStamp(instantMs: number, offsetMs: number): string {
  const iso = new Date(instantMs + offsetMs).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

interface Onset {
  atMs: number;
  fromMs: number;
  toMs: number;
}

/** The first whole second at which the offset differs from the one at `lo`. */
function transitionBetween(zone: string, lo: number, hi: number): number {
  const before = offsetMsAt(lo, zone);
  let a = lo;
  let b = hi;
  while (b - a > SECOND_MS) {
    const mid = a + Math.floor((b - a) / 2 / SECOND_MS) * SECOND_MS;
    if (offsetMsAt(mid, zone) === before) a = mid;
    else b = mid;
  }
  return b;
}

/**
 * The offset at `fromMs` and every change up to `toMs`. Sampled daily, then
 * narrowed to the second: zones change at most a few times a year, never
 * twice within a day.
 */
function onsets(zone: string, fromMs: number, toMs: number): Onset[] | null {
  const first = offsetMsAt(fromMs, zone);
  if (first === null) return null;
  const result: Onset[] = [{ atMs: fromMs, fromMs: first, toMs: first }];
  let previous = first;
  let at = fromMs;
  while (at < toMs) {
    const next = Math.min(at + DAY_MS, toMs);
    const offset = offsetMsAt(next, zone);
    if (offset !== null && offset !== previous) {
      result.push({ atMs: transitionBetween(zone, at, next), fromMs: previous, toMs: offset });
      previous = offset;
    }
    at = next;
  }
  return result;
}

/** Jan 1 of a year at 00:00 UTC. */
const yearStartMs = (year: number): number => Date.UTC(year, 0, 1);

/**
 * The VTIMEZONE lines for `zone` covering the calendar years `fromYear` to
 * `toYear` inclusive (UTC years of the events; one day of margin on each
 * side), or null for a zone the runtime does not know.
 */
export function vtimezoneLines(zone: string, fromYear: number, toYear: number): string[] | null {
  const list = onsets(zone, yearStartMs(fromYear) - DAY_MS, yearStartMs(toYear + 1) + DAY_MS);
  if (!list) return null;
  const lowest = Math.min(...list.map((o) => o.toMs));
  const lines = ["BEGIN:VTIMEZONE", `TZID:${zone}`];
  for (const onset of list) {
    const kind = onset.toMs > lowest ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${localStamp(onset.atMs, onset.fromMs)}`,
      `TZOFFSETFROM:${formatIcsOffset(onset.fromMs)}`,
      `TZOFFSETTO:${formatIcsOffset(onset.toMs)}`,
      `END:${kind}`
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}
