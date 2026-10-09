import { localDay } from "../time/instant";
import { isValidZone } from "../time/zonedParts";

/**
 * Which part of a roadtrip has happened (forgejo#260) — the ONE rule every
 * roadtrip figure and badge asks, so "recorded" cannot mean two things.
 *
 * A roadtrip is not one event with one date, like a flight; it unfolds. Until
 * this rule existed a roadtrip that had STARTED counted every one of its legs,
 * so the kilometres of next week's ferry were already in the badges on day
 * one (the extension to #179). Now each station and each leg is placed on the
 * calendar of its own place:
 *
 *   - `past`     — its day is before today there: it has happened.
 *   - `current`  — today there: under way, not yet a fact.
 *   - `planned`  — after today there.
 *   - `undated`  — no day recorded.
 *
 * An UNDATED leg or station counts as recorded when the roadtrip as a whole is
 * over or carries no dates at all — that is somebody writing it down after
 * the fact, the rule undated stays and visits follow. On a roadtrip still
 * under way an undated leg is not counted: nobody can say whether it is done.
 *
 * `now` is a parameter so a test can pin the boundary across midnight.
 */
export type RoadtripPhase = "past" | "current" | "planned" | "undated";

/** A station's own days: the wall-clock dates it was stored with (`YYYY-MM-DD`). */
export interface TimelineStation {
  startDate: Date | null;
  endDate: Date | null;
  stopZone: string | null;
  /** The linked stay's dates stand in where the station carries none. */
  lodgingStay: { checkIn: Date | null; checkOut: Date | null } | null;
}

function day(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** First and last day of a station, or nulls when it has none. */
export function stationDays(s: TimelineStation): { first: string | null; last: string | null } {
  const first = day(s.startDate) ?? day(s.lodgingStay?.checkIn ?? null);
  const last = day(s.endDate) ?? day(s.lodgingStay?.checkOut ?? null) ?? first;
  return { first, last };
}

/** Today's date at a station: its own zone where known, UTC otherwise. */
export function todayAt(zone: string | null, now: Date): string {
  return localDay(now, zone && isValidZone(zone) ? zone : "UTC");
}

/** Where a station stands. A night at it is done once its last day has arrived. */
export function stationPhase(s: TimelineStation, now: Date): RoadtripPhase {
  const { first, last } = stationDays(s);
  if (first === null) return "undated";
  const today = todayAt(s.stopZone, now);
  if (first > today) return "planned";
  if ((last ?? first) <= today && first < today) return "past";
  return "current";
}

/**
 * Where a leg stands, by its ARRIVAL: a leg is driven once the station it ends
 * at has been reached. Without an arrival day the departure station's last
 * day stands in.
 */
export function legPhase(from: TimelineStation, to: TimelineStation, now: Date): RoadtripPhase {
  const arrival = stationDays(to).first ?? stationDays(from).last;
  if (arrival === null) return "undated";
  const today = todayAt(to.stopZone ?? from.stopZone, now);
  if (arrival < today) return "past";
  if (arrival === today) return "current";
  return "planned";
}

/** The roadtrip as a whole, from its stations. */
export function roadtripPhase(stations: readonly TimelineStation[], now: Date): RoadtripPhase {
  const phases = stations.map((s) => stationPhase(s, now)).filter((p) => p !== "undated");
  if (phases.length === 0) return "undated";
  if (phases.every((p) => p === "past")) return "past";
  if (phases.every((p) => p === "planned")) return "planned";
  return "current";
}

/** Whether a leg's or station's phase makes it part of the recorded figures. */
export function isRecorded(phase: RoadtripPhase, trip: RoadtripPhase): boolean {
  if (phase === "past") return true;
  return phase === "undated" && (trip === "past" || trip === "undated");
}
