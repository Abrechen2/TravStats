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
 * The day a stage arrives. A booking that states its arrival is the truth:
 * a night ferry booked 23:00 → 07:00 lands the next day even with no duration
 * on the stage. Otherwise the departure plus the duration, read on the
 * destination's clock when both ends have a known zone, so a late crossing
 * into a zone ahead lands on the day it is there. An unknown time or duration
 * still counts as 0 (plan Task 4, rule 2).
 */
function arrivalDay({ departDay, stage, anchor, from, to }: StageTiming): string {
  if (anchor?.arrivalDay && daysBetween(departDay, anchor.arrivalDay) >= 0)
    return anchor.arrivalDay;
  if (stage.overnight) return addDays(departDay, 1);
  const time = anchor?.time ? anchor.time : stage.departTime;
  const duration = stage.durationMinutes ?? 0;
  const fromZone = (anchor?.time && anchor.timezone) || from.place.zone;
  const toZone = (anchor?.time && anchor.arrivalTimezone) || to?.place.zone;
  if (time && stage.durationMinutes !== null && fromZone && toZone && fromZone !== toZone) {
    const start = machineInstant(`${departDay}T${time.slice(0, 5)}`, fromZone);
    if (start) return localDay(new Date(start.getTime() + duration * 60_000), toZone);
  }
  return addDays(departDay, Math.floor((minuteOfDay(time) + duration) / MINUTES_PER_DAY));
}

/**
 * Lays the active route out on the calendar. Booked stages and pinned stations
 * are anchors: their day is never moved. A route that reaches an anchor late
 * is reported as a conflict; reaching it early is a gap, not a finding.
 */
export function scheduleRoute(state: PlanState): RouteSchedule {
  const { stations, stages, startDay } = state;
  const result: RouteSchedule = {
    stations: stations.map((s) => ({ stationId: s.id, arriveDay: null, departDay: null })),
    stages: stages.map((g) => ({ stageId: g.id, departDay: null, arriveDay: null })),
    lastDay: null,
    conflicts: [],
  };
  if (!startDay) return result;

  const bookings = new Map(state.bookings.map((b) => [b.id, b]));
  let arrive = startDay;
  stations.forEach((station, i) => {
    if (station.pinnedDay && station.pinnedDay !== arrive) {
      if (daysBetween(station.pinnedDay, arrive) > 0) {
        result.conflicts.push({
          kind: "anchor_shift",
          anchorId: station.id,
          plannedDay: station.pinnedDay,
          requiredDay: arrive,
        });
      }
      arrive = station.pinnedDay;
    }
    const depart = addDays(arrive, station.nights);
    result.stations[i] = { stationId: station.id, arriveDay: arrive, departDay: depart };
    result.lastDay = depart;

    const next = stations[i + 1];
    if (!next) return;
    const stageIndex = stages.findIndex(
      (g) => g.fromStationId === station.id && g.toStationId === next.id
    );
    const stage = stageIndex >= 0 ? stages[stageIndex] : null;
    if (!stage) {
      arrive = depart;
      return;
    }
    const booking = stage.bookingId ? bookings.get(stage.bookingId) : undefined;
    const anchorDay = booking && !booking.placeholder ? booking.day : null;
    // An anchored stage is compared against what the route itself requires, so
    // a stale `departDay` on the stage cannot hide a late arrival.
    const required = anchorDay ? depart : (stage.departDay ?? depart);
    let departDay = required;
    if (anchorDay) {
      if (daysBetween(anchorDay, required) > 0) {
        result.conflicts.push({
          kind: "anchor_shift",
          anchorId: stage.id,
          plannedDay: anchorDay,
          requiredDay: required,
        });
      }
      departDay = anchorDay;
    }
    arrive = arrivalDay({
      departDay,
      stage,
      anchor: anchorDay ? booking : undefined,
      from: station,
      to: next,
    });
    result.stages[stageIndex] = { stageId: stage.id, departDay, arriveDay: arrive };
  });
  return result;
}
