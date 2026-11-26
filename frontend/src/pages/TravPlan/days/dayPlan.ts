/** Pure builder of the day plan: one row per calendar day of the trip. No React, no network. */
import type {
  PlanBooking,
  PlanItem,
  PlanStage,
  PlanState,
  PlanStation,
  PlanTask,
  RouteSchedule,
} from "../../../lib/api/travplan";

export interface DayLeg {
  stage: PlanStage;
  from: PlanStation;
  to: PlanStation;
}

export interface DayRow {
  day: string;
  /** Where the night after this day is spent; null when the day is unknown or there is none. */
  night: PlanStation | null;
  /** Stations reached on this day. */
  arrivals: PlanStation[];
  legs: DayLeg[];
  items: PlanItem[];
  /** Bookings on this day that no stage carries (a stage's booking shows with its leg). */
  bookings: PlanBooking[];
  tasks: PlanTask[];
  free: boolean;
}

export interface DayPlan {
  days: DayRow[];
  /** Stations the schedule cannot place yet, in route order. */
  undated: PlanStation[];
}

const isActive = (i: PlanItem) => i.execution !== "cancelled" && i.execution !== "skipped";
const byTime = (a: PlanItem, b: PlanItem) => (a.time ?? "99").localeCompare(b.time ?? "99");

/**
 * Every day of the trip with what happens on it. A day the schedule cannot place stays
 * without a night rather than borrowing the previous one, so "where do we sleep?" is never
 * answered with a guess; the stations behind it are listed as undated.
 */
export function buildDayPlan(
  state: PlanState,
  schedule: RouteSchedule | undefined,
  days: string[]
): DayPlan {
  const station = new Map(state.stations.map((s) => [s.id, s]));
  const rows = schedule?.stations ?? [];
  const stageRows = schedule?.stages ?? [];
  // A booking a stage or an entry carries shows there; one whose entry was skipped or cancelled
  // stays out with it rather than coming back as a loose booking.
  const carried = new Set(
    [...state.stages.map((g) => g.bookingId), ...state.items.map((i) => i.bookingId)].filter(
      Boolean
    )
  );
  const nightAt = (day: string) => {
    const row = rows.find(
      (r) => r.arriveDay !== null && r.departDay !== null && r.arriveDay <= day && day < r.departDay
    );
    return row ? (station.get(row.stationId) ?? null) : null;
  };
  const legsOn = (day: string): DayLeg[] =>
    state.stages.flatMap((stage) => {
      const from = station.get(stage.fromStationId),
        to = station.get(stage.toStationId),
        departs = stageRows.find((r) => r.stageId === stage.id)?.departDay ?? null;
      return from && to && departs === day ? [{ stage, from, to }] : [];
    });
  const placed = new Set(rows.filter((r) => r.arriveDay !== null).map((r) => r.stationId));
  return {
    days: days.map((day) => ({
      day,
      night: nightAt(day),
      arrivals: rows
        .filter((r) => r.arriveDay === day)
        .flatMap((r) => station.get(r.stationId) ?? [])
        // The start is not "reached" on the first day; it is where the trip begins.
        .filter((s) => s.id !== state.stations[0]?.id),
      legs: legsOn(day),
      items: state.items.filter((i) => i.day === day && isActive(i)).sort(byTime),
      bookings: state.bookings.filter((b) => b.day === day && !carried.has(b.id)),
      tasks: state.tasks.filter((t) => t.due === day && !t.done),
      free: state.freeDays.includes(day),
    })),
    undated: state.shape === "route" ? state.stations.filter((s) => !placed.has(s.id)) : [],
  };
}

export interface DaySpan {
  /** The first day's row; a span of quiet days shares its night. */
  row: DayRow;
  /** Zero-based index of the first and last day in the trip. */
  first: number;
  last: number;
  lastDay: string;
}

const quiet = (r: DayRow) =>
  !r.legs.length && !r.items.length && !r.bookings.length && !r.tasks.length && !r.free;

/**
 * Consecutive days with nothing on them and the same night fold into one span, so three weeks
 * on one campsite read as one line, not twenty-one empty cards. A day with anything on it
 * always stands alone, and so does the last day, which has no night to share.
 */
export function foldQuietDays(days: DayRow[]): DaySpan[] {
  return days.reduce<DaySpan[]>((spans, row, i) => {
    const prev = spans[spans.length - 1];
    const joins =
      prev &&
      i < days.length - 1 &&
      quiet(prev.row) &&
      quiet(row) &&
      prev.row.night?.id === row.night?.id;
    if (joins) return [...spans.slice(0, -1), { ...prev, last: i, lastDay: row.day }];
    return [...spans, { row, first: i, last: i, lastDay: row.day }];
  }, []);
}
