import { localDay, machineInstant } from "../../shared/time/instant";
import { daysBetween, fromDbDate, toDbDate } from "../../shared/time/localDate";
import type { PlanBooking, PlanStage, PlanState, PlanStation, RouteSchedule } from "./types";

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

function addDays(day: string, count: number): string {
  return fromDbDate(new Date(toDbDate(day).getTime() + count * MS_PER_DAY));
}

/** Minutes after midnight of `HH:MM`; an unknown or malformed time counts as 0. */
function minuteOfDay(time: string | null): number {
  const match = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

interface StageTiming {
  departDay: string;
  stage: PlanStage;
  /** The real (non-placeholder) booking that anchors the stage, if any. */
  anchor: PlanBooking | undefined;
  from: PlanStation;
  to: PlanStation | undefined;
}

/**
 * The day a stage arrives. A booking that states its arrival is the truth,
 * in either direction: a night ferry booked 23:00 → 07:00 lands the next day
 * even with no duration on the stage, and a flight east across the date line
 * lands on an earlier calendar day than it left. Otherwise the departure plus the duration, read on the
 * destination's clock when both ends have a known zone, so a late crossing
 * into a zone ahead — or a clock change within one zone — lands on the day it
 * is there. An unknown time counts as
 * midnight; an unknown duration leaves the arrival unknown for a ferry, rail
 * or flight (owner, 2026-10-20), but a DRIVE without one arrives the day it
 * left, flagged `assumed` (see `arrivalAssumed`): with no router, every day
 * after the first drive would otherwise stay unknown and nothing could be
 * planned.
 */
function arrivalDay({ departDay, stage, anchor, from, to }: StageTiming): string | null {
  if (anchor?.arrivalDay) return anchor.arrivalDay;
  if (stage.overnight) return addDays(departDay, 1);
  if (stage.durationMinutes === null) return stage.mode === "drive" ? departDay : null;
  const time = anchor?.time ? anchor.time : stage.departTime;
  const duration = stage.durationMinutes;
  const fromZone = (anchor?.time && anchor.timezone) || from.place.zone;
  const toZone = (anchor?.time && anchor.arrivalTimezone) || to?.place.zone;
  // Through the instant even within one zone: a clock change on the way makes
  // the local day differ from plain minute arithmetic.
  if (time && fromZone && toZone) {
    const start = machineInstant(`${departDay}T${time.slice(0, 5)}`, fromZone);
    if (start) return localDay(new Date(start.getTime() + duration * 60_000), toZone);
  }
  return addDays(departDay, Math.floor((minuteOfDay(time) + duration) / MINUTES_PER_DAY));
}

function hasBookedArrival(stage: PlanStage, bookings: PlanBooking[]): boolean {
  const booking = stage.bookingId ? bookings.find((b) => b.id === stage.bookingId) : undefined;
  return Boolean(booking && !booking.placeholder && booking.day && booking.arrivalDay);
}

/**
 * True for a drive whose arrival is only assumed: no duration, not overnight and
 * no booked arrival, so it is taken to arrive the day it left.
 */
export function arrivalAssumed(stage: PlanStage, bookings: PlanBooking[]): boolean {
  return (
    stage.mode === "drive" &&
    !stage.overnight &&
    stage.durationMinutes === null &&
    !hasBookedArrival(stage, bookings)
  );
}

/**
 * True when nothing tells when a stage arrives and nothing can be assumed: no
 * booked arrival, not an overnight crossing, no duration, and not a drive. The
 * arrival then stays unknown.
 */
export function arrivalUndetermined(stage: PlanStage, bookings: PlanBooking[]): boolean {
  if (stage.overnight || stage.durationMinutes !== null || stage.mode === "drive") return false;
  const booking = stage.bookingId ? bookings.find((b) => b.id === stage.bookingId) : undefined;
  return !(booking && !booking.placeholder && booking.day && booking.arrivalDay);
}

/**
 * The stage joining each pair of consecutive stations, or `null` where none
 * does — after a reorder or a removed station the old stages no longer
 * connect the new neighbours.
 */
export function routeLegs(stations: PlanStation[], stages: PlanStage[]): (PlanStage | null)[] {
  return stations.slice(1).map((next, i) => {
    const from = stations[i];
    return stages.find((g) => g.fromStationId === from.id && g.toStationId === next.id) ?? null;
  });
}

/**
 * Lays the active route out on the calendar. Booked stages and pinned stations
 * are anchors: their day is never moved. A route that reaches an anchor late
 * is reported as a conflict; reaching it early is a gap, not a finding.
 *
 * A leg without a stage is `unresolved`: how long it takes is unknown, so the
 * days after it stay unknown until the next anchor rather than pretending the
 * next station is reached the same day.
 */
export function scheduleRoute(state: PlanState): RouteSchedule {
  const { stations, stages, startDay } = state;
  const legs = routeLegs(stations, stages);
  const result: RouteSchedule = {
    stations: stations.map((s) => ({ stationId: s.id, arriveDay: null, departDay: null })),
    stages: stages.map((g) => ({ stageId: g.id, departDay: null, arriveDay: null })),
    lastDay: null,
    conflicts: [],
    unresolved: legs.flatMap((leg, i) =>
      leg ? [] : [{ fromStationId: stations[i].id, toStationId: stations[i + 1].id }]
    ),
  };
  if (!startDay) return result;

  const bookings = new Map(state.bookings.map((b) => [b.id, b]));
  let arrive: string | null = startDay;
  // True while the day in `arrive` rests on an assumed drive arrival; a pinned
  // station or a booked arrival ends it.
  let assumed = false;
  stations.forEach((station, i) => {
    if (station.pinnedDay) assumed = false;
    if (station.pinnedDay && station.pinnedDay !== arrive) {
      if (arrive && daysBetween(station.pinnedDay, arrive) > 0) {
        result.conflicts.push({
          kind: "anchor_shift",
          anchorId: station.id,
          plannedDay: station.pinnedDay,
          requiredDay: arrive,
        });
      }
      arrive = station.pinnedDay;
    }
    const depart = arrive && addDays(arrive, station.nights);
    result.stations[i] = {
      stationId: station.id,
      arriveDay: arrive,
      departDay: depart,
      ...(assumed && arrive ? { assumed: true } : {}),
    };
    result.lastDay = depart;

    const next = stations[i + 1];
    if (!next) return;
    const stage = legs[i];
    if (!stage) {
      arrive = null;
      assumed = false;
      return;
    }
    const booking = stage.bookingId ? bookings.get(stage.bookingId) : undefined;
    const anchorDay = booking && !booking.placeholder ? booking.day : null;
    // An anchored stage is compared against what the route itself requires, so
    // a stale `departDay` on the stage cannot hide a late arrival.
    const required = anchorDay ? depart : (stage.departDay ?? depart);
    let departDay = required;
    if (anchorDay) {
      if (required && daysBetween(anchorDay, required) > 0) {
        result.conflicts.push({
          kind: "anchor_shift",
          anchorId: stage.id,
          plannedDay: anchorDay,
          requiredDay: required,
        });
      }
      departDay = anchorDay;
    }
    arrive = departDay
      ? arrivalDay({
          departDay,
          stage,
          anchor: anchorDay ? booking : undefined,
          from: station,
          to: next,
        })
      : null;
    // A booked departure day restarts the chain; an assumed drive extends it.
    if (anchorDay) assumed = false;
    const stageAssumed = arrivalAssumed(stage, state.bookings);
    if (stageAssumed) assumed = true;
    result.stages[stages.indexOf(stage)] = {
      stageId: stage.id,
      departDay,
      arriveDay: arrive,
      ...(stageAssumed && arrive ? { assumed: true } : {}),
    };
  });
  return result;
}
