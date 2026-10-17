import { daysBetween, fromDbDate, toDbDate } from "../../shared/time/localDate";
import type { PlanState, RouteSchedule } from "./types";

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
    const time = anchorDay && booking?.time ? booking.time : stage.departTime;
    const travelDays = stage.overnight
      ? 1
      : Math.floor((minuteOfDay(time) + (stage.durationMinutes ?? 0)) / MINUTES_PER_DAY);
    arrive = addDays(departDay, travelDays);
    result.stages[stageIndex] = { stageId: stage.id, departDay, arriveDay: arrive };
  });
  return result;
}
