import { daysBetween, fromDbDate, toDbDate } from "../../shared/time/localDate";
import { scheduleRoute } from "./routeSchedule";
import type { PlanFinding, PlanStage, PlanState, PlanStation } from "./types";

const SECTION = "route";
const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;
const PLACEHOLDER_INFO_DAYS = 21;
const PLACEHOLDER_ATTENTION_DAYS = 7;
const FERRY_MIN_CONNECTION_MINUTES = 120;
/** Spec §5.4: a single driving day longer than this is worth a second look. */
const LONG_DRIVE_MINUTES = { relaxed: 300, balanced: 420, busy: 540 } as const;
/** Modes that need a booking (or at least a placeholder) to be a plan. */
const BOOKABLE_MODES = new Set<PlanStage["mode"]>(["ferry", "rail", "flight"]);

/** A conscious decision hides a finding for good, a dismissal until its facts change. */
export function isSuppressed(state: PlanState, id: string, fingerprint: string): boolean {
  const decision = state.decisions.find((d) => d.id === id);
  return decision?.choice === "conscious" || decision?.fingerprint === fingerprint;
}

function minuteOfDay(time: string | null): number | null {
  const match = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function addDays(day: string, count: number): string {
  return fromDbDate(new Date(toDbDate(day).getTime() + count * MS_PER_DAY));
}

/** Findings that only exist on a route plan; they pass through the same suppression as the rest. */
export function routeFindings(state: PlanState, today: string): PlanFinding[] {
  const findings: PlanFinding[] = [];
  function add(
    id: string,
    code: string,
    params: PlanFinding["params"],
    facts: unknown,
    severity: PlanFinding["severity"] = "info"
  ) {
    const fingerprint = JSON.stringify(facts);
    if (isSuppressed(state, id, fingerprint)) return;
    findings.push({ id, code, section: SECTION, params, fingerprint, severity });
  }

  const schedule = scheduleRoute(state);
  const station = (id: string): PlanStation | undefined => state.stations.find((s) => s.id === id);
  const stageDays = (stage: PlanStage) => schedule.stages.find((g) => g.stageId === stage.id);
  const bookingOf = (stage: PlanStage) => state.bookings.find((b) => b.id === stage.bookingId);
  const title = (id: string) => station(id)?.title ?? "";
  const label = (stage: PlanStage) => `${title(stage.fromStationId)} → ${title(stage.toStationId)}`;

  for (const stage of state.stages)
    if (!bookingOf(stage) && BOOKABLE_MODES.has(stage.mode))
      add(
        "stageUndecided:" + stage.id,
        "stageUndecided",
        { from: title(stage.fromStationId), to: title(stage.toStationId), mode: stage.mode },
        [stage.fromStationId, stage.toStationId, stage.mode]
      );

  for (const booking of state.bookings) {
    if (!booking.placeholder) continue;
    const stage = state.stages.find((g) => g.bookingId === booking.id || g.id === booking.stageId);
    if (booking.stageId && !stage) continue; // a variant's placeholder is not on the active route
    const departDay = (stage && stageDays(stage)?.departDay) || booking.day;
    if (!departDay) continue;
    const days = daysBetween(today, departDay);
    if (days < 0 || days > PLACEHOLDER_INFO_DAYS) continue;
    const urgent = days <= PLACEHOLDER_ATTENTION_DAYS;
    add(
      "placeholderDue:" + booking.id,
      "placeholderDue",
      { title: booking.title, days },
      [booking.id, departDay, urgent],
      urgent ? "attention" : "info"
    );
  }

  for (const s of state.stations)
    if (s.nights > 0 && s.night.kind === "idea" && s.night.candidates.length === 0)
      add("nightUndecided:" + s.id, "nightUndecided", { station: s.title }, [s.id, s.nights]);

  for (const conflict of schedule.conflicts) {
    const stage = state.stages.find((g) => g.id === conflict.anchorId);
    add(
      "scheduleConflict:" + conflict.anchorId,
      "scheduleConflict",
      {
        anchor: stage ? label(stage) : title(conflict.anchorId),
        plannedDay: conflict.plannedDay,
        requiredDay: conflict.requiredDay,
      },
      [conflict.anchorId, conflict.plannedDay, conflict.requiredDay],
      "attention"
    );
  }

  const driveLimit = LONG_DRIVE_MINUTES[state.pace];
  for (const stage of state.stages)
    if (
      stage.mode === "drive" &&
      stage.durationMinutes !== null &&
      stage.durationMinutes > driveLimit
    )
      add(
        "longDrive:" + stage.id,
        "longDrive",
        {
          from: title(stage.fromStationId),
          to: title(stage.toStationId),
          hours: Math.round(stage.durationMinutes / 6) / 10,
        },
        [stage.id, stage.durationMinutes, state.pace]
      );

  for (const ferry of state.stages) {
    if (ferry.mode !== "ferry") continue;
    const from = station(ferry.fromStationId);
    // Only a pass-through station has a same-day connection to miss.
    if (!from || from.nights > 0) continue;
    const incoming = state.stages.find((g) => g.toStationId === from.id);
    const incomingDays = incoming && stageDays(incoming);
    const ferryDay = stageDays(ferry)?.departDay;
    const ferryTime = bookingOf(ferry)?.time ?? ferry.departTime;
    const ferryMinute = minuteOfDay(ferryTime);
    const incomingMinute = minuteOfDay(
      incoming ? (bookingOf(incoming)?.time ?? incoming.departTime) : null
    );
    if (
      !incoming ||
      incoming.durationMinutes === null ||
      !incomingDays?.departDay ||
      !ferryDay ||
      ferryMinute === null ||
      incomingMinute === null
    )
      continue;
    const arrival =
      daysBetween(ferryDay, incomingDays.departDay) * MINUTES_PER_DAY +
      incomingMinute +
      incoming.durationMinutes;
    const minutes = ferryMinute - arrival;
    if (minutes < FERRY_MIN_CONNECTION_MINUTES)
      add(
        "ferryConnection:" + ferry.id,
        "ferryConnection",
        { ferry: bookingOf(ferry)?.title || label(ferry), minutes: Math.max(0, minutes) },
        [ferry.id, incoming.id, minutes, ferryTime],
        "attention"
      );
  }

  for (const item of state.items) {
    if (item.kind !== "activity" || !item.stationId || !item.day) continue;
    if (item.execution === "cancelled" || item.execution === "skipped") continue;
    const index = state.stations.findIndex((s) => s.id === item.stationId);
    const window = index >= 0 ? schedule.stations[index] : undefined;
    if (!window?.arriveDay || !window.departDay) continue;
    if (item.day >= window.arriveDay && item.day <= window.departDay) continue;
    add(
      "dayTripOutside:" + item.id,
      "dayTripOutside",
      { title: item.title, station: state.stations[index].title },
      [item.id, item.day, window.arriveDay, window.departDay],
      "attention"
    );
  }
  return findings;
}

/**
 * Nights a route covers: every night spent at a station (any night state —
 * undecided is `nightUndecided`'s business, not a gap) and every overnight
 * stage. A night is named after the evening it starts.
 */
export function routeCoveredNights(state: PlanState): Set<string> {
  const covered = new Set<string>();
  const schedule = scheduleRoute(state);
  const nightsBetween = (from: string | null, to: string | null) => {
    if (!from || !to) return;
    for (let n = 0; n < daysBetween(from, to); n++) covered.add(addDays(from, n));
  };
  for (const s of schedule.stations) nightsBetween(s.arriveDay, s.departDay);
  for (const stage of state.stages) {
    const days = schedule.stages.find((g) => g.stageId === stage.id);
    if (stage.overnight) nightsBetween(days?.departDay ?? null, days?.arriveDay ?? null);
  }
  return covered;
}
