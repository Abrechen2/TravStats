import { daysBetween } from "../../../shared/time/localDate";
import type { FlightRecord, RecordSnapshot, StayRecord } from "../recordGather";
import type { DataQualityFinding } from "../types";
import { isSetAside } from "./setAside";

/**
 * Entries one traveller cannot all have made (forgejo#282).
 *
 * Two cases, each a question about the PAIR and raised on the later entry:
 *
 * - **Flights**: a flight that departs before an earlier-departing flight has
 *   landed. Compared as real instants only — both ends of both flights must be
 *   certain under the time model (ADR 0002): a date-only row has a 12:00
 *   placeholder, an untagged legacy row may still be fake UTC, and comparing
 *   either would invent overlaps by the hour. **Tolerance: 60 minutes** — a
 *   departure up to an hour before the previous scheduled arrival is not
 *   asked about, which absorbs schedule-versus-actual drift and a minute-level
 *   rounding of either source.
 * - **Stays**: two stays at DIFFERENT lodgings that share at least one night.
 *   A night is the calendar day of a check-in up to (not including) the
 *   check-out day, on the stay's own calendar — so checking out of one house
 *   and into the next on the same day is no overlap. Day precision only; a
 *   month- or year-precision stay names no nights. Two stays in the SAME house
 *   overlapping are a second room or an extension, not a contradiction, and an
 *   exact repeat there is the duplicate check's question.
 *
 * Cancelled rows are ignored, as are pairs the duplicate check already asks
 * about (one question per pair, the more useful one). Each entry carries at
 * most one chronology question: the earliest entry it collides with.
 *
 * Bounded: sorted once, then a sweep over the entries still "open" at each
 * start — that list holds only what genuinely overlaps, so the work is
 * O(n log n + overlaps), never all pairs.
 */

export const FLIGHT_OVERLAP_TOLERANCE_MINUTES = 60;

const pairKey = (a: string, b: string): string => `${a}|${b}`;

interface TimedFlight {
  record: FlightRecord;
  dep: number;
  arr: number;
}

function flightConflicts(
  flights: readonly FlightRecord[],
  skipPairs: ReadonlySet<string>
): DataQualityFinding[] {
  const tolerance = FLIGHT_OVERLAP_TOLERANCE_MINUTES * 60_000;
  const timed: TimedFlight[] = flights
    .filter((f) => !isSetAside(f.status) && f.departureAt && f.arrivalAt)
    .map((f) => ({
      record: f,
      dep: (f.departureAt as Date).getTime(),
      arr: (f.arrivalAt as Date).getTime(),
    }))
    // A flight that lands before it leaves is the time model's own question,
    // and its span would collide with everything around it.
    .filter((f) => f.arr >= f.dep)
    .sort((a, b) => a.dep - b.dep || (a.record.id < b.record.id ? -1 : 1));

  const out: DataQualityFinding[] = [];
  let open: TimedFlight[] = [];
  for (const current of timed) {
    open = open.filter((earlier) => earlier.arr - tolerance > current.dep);
    const clash = open.find(
      (earlier) => !skipPairs.has(pairKey(current.record.id, earlier.record.id))
    );
    if (clash) {
      out.push({
        entityType: "flight",
        entityId: current.record.id,
        kind: "chronology_conflict",
        details: {
          domain: "flight",
          conflictWith: {
            entityType: "flight",
            entityId: clash.record.id,
            label: clash.record.label,
            parentId: null,
          },
          thisStart: new Date(current.dep).toISOString(),
          thisEnd: new Date(current.arr).toISOString(),
          otherStart: new Date(clash.dep).toISOString(),
          otherEnd: new Date(clash.arr).toISOString(),
          overlapMinutes: Math.round((Math.min(clash.arr, current.arr) - current.dep) / 60_000),
          overlapNights: null,
          day: current.record.firstDay,
        },
      });
    }
    open.push(current);
  }
  return out;
}

interface NightSpan {
  record: StayRecord;
  checkIn: string;
  checkOut: string;
}

function stayConflicts(
  stays: readonly StayRecord[],
  skipPairs: ReadonlySet<string>
): DataQualityFinding[] {
  const spans: NightSpan[] = stays
    .filter((s) => !isSetAside(s.status) && s.firstDay && s.lastDay && s.firstDay < s.lastDay)
    .map((s) => ({ record: s, checkIn: s.firstDay as string, checkOut: s.lastDay as string }))
    .sort((a, b) =>
      a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.record.id < b.record.id ? -1 : 1
    );

  const out: DataQualityFinding[] = [];
  let open: NightSpan[] = [];
  for (const current of spans) {
    // ISO days compare as strings; a check-out ON the check-in day shares no night.
    open = open.filter((earlier) => earlier.checkOut > current.checkIn);
    const clash = open.find(
      (earlier) =>
        earlier.record.lodgingId !== current.record.lodgingId &&
        !skipPairs.has(pairKey(current.record.id, earlier.record.id))
    );
    if (clash) {
      const lastShared = clash.checkOut < current.checkOut ? clash.checkOut : current.checkOut;
      out.push({
        entityType: "lodging_stay",
        entityId: current.record.id,
        kind: "chronology_conflict",
        details: {
          domain: "lodging_stay",
          conflictWith: {
            entityType: "lodging_stay",
            entityId: clash.record.id,
            label: clash.record.label,
            parentId: clash.record.lodgingId,
          },
          thisStart: current.checkIn,
          thisEnd: current.checkOut,
          otherStart: clash.checkIn,
          otherEnd: clash.checkOut,
          overlapMinutes: null,
          overlapNights: daysBetween(current.checkIn, lastShared),
          day: current.checkIn,
        },
      });
    }
    open.push(current);
  }
  return out;
}

export function findChronologyConflicts(
  snapshot: Pick<RecordSnapshot, "flights" | "stays">,
  skipPairs: ReadonlySet<string> = new Set()
): DataQualityFinding[] {
  return [
    ...flightConflicts(snapshot.flights, skipPairs),
    ...stayConflicts(snapshot.stays, skipPairs),
  ];
}
