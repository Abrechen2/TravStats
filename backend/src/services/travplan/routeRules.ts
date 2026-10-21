import { daysBetween, fromDbDate, toDbDate } from "../../shared/time/localDate";
import { arrivalUndetermined, routeLegs, scheduleRoute } from "./routeSchedule";
import { machineInstant } from "../../shared/time/instant";
import type { PlanBooking, PlanFinding, PlanStage, PlanState, PlanStation } from "./types";

const SECTION = "route";
const MS_PER_DAY = 86_400_000;
const PLACEHOLDER_INFO_DAYS = 21;
const PLACEHOLDER_ATTENTION_DAYS = 7;
const FERRY_MIN_CONNECTION_MINUTES = 120;
/** The clock a plan without zones is read on — both ends of a comparison alike. */
const FLOATING_ZONE = "UTC";
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

/** A day and clock on a zone that may be unknown. */
interface Clock {
  day: string;
  time: string;
  zone: string | null;
  /** Minutes to add to the clock — a travel duration not yet applied. */
  plusMinutes: number;
}

function clockAt(day: string | null, time: string | null, zone: string | null): Clock | null {
  return day && time && minuteOfDay(time) !== null ? { day, time, zone, plusMinutes: 0 } : null;
}

/**
 * The instant of a clock. Without a zone it is read on a floating clock, which
 * is only sound when the clock it is compared with has no zone either.
 */
function instantOf(clock: Clock): Date | null {
  return machineInstant(`${clock.day}T${clock.time.slice(0, 5)}`, clock.zone ?? FLOATING_ZONE);
}

/**
 * When the incoming stage reaches the ferry's port: its booking's own arrival
 * when it states one, otherwise its departure plus its duration. Null when
 * neither is known.
 */
function connectionArrival(
  incoming: PlanStage,
  booking: PlanBooking | undefined,
  departDay: string | null,
  origin: PlanStation | undefined,
  port: PlanStation
): Clock | null {
  if (booking && !booking.placeholder && booking.arrivalDay && booking.arrivalTime)
    return clockAt(
      booking.arrivalDay,
      booking.arrivalTime,
      booking.arrivalTimezone || port.place.zone
    );
  if (incoming.durationMinutes === null) return null;
  const time = booking?.time ?? incoming.departTime;
  const zone = (booking?.time && booking.timezone) || origin?.place.zone || null;
  const clock = clockAt(departDay, time, zone);
  return clock && { ...clock, plusMinutes: incoming.durationMinutes };
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
      { title: booking.title, days, count: days },
      [booking.id, departDay, urgent],
      urgent ? "attention" : "info"
    );
  }

  for (const s of state.stations)
    if (s.nights > 0 && s.night.kind === "idea" && s.night.candidates.length === 0)
      add("nightUndecided:" + s.id, "nightUndecided", { station: s.title }, [s.id, s.nights]);

  // A leg without a stage leaves every day after it unknown; say so instead
  // of letting the route look complete.
  for (const leg of schedule.unresolved)
    add(
      `stageMissing:${leg.fromStationId}:${leg.toStationId}`,
      "stageMissing",
      { from: title(leg.fromStationId), to: title(leg.toStationId) },
      [leg.fromStationId, leg.toStationId],
      "attention"
    );

  // A stage whose arrival nothing determines leaves the days after it unknown.
  for (const stage of routeLegs(state.stations, state.stages))
    if (stage && arrivalUndetermined(stage, state.bookings))
      add(
        "durationMissing:" + stage.id,
        "durationMissing",
        { from: title(stage.fromStationId), to: title(stage.toStationId) },
        [stage.id, stage.mode],
        "attention"
      );

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
    if (!incoming) continue;
    const ferryBooking = bookingOf(ferry);
    const ferryTime = ferryBooking?.time ?? ferry.departTime;
    const arrival = connectionArrival(
      incoming,
      bookingOf(incoming),
      stageDays(incoming)?.departDay ?? null,
      station(incoming.fromStationId),
      from
    );
    const departure = clockAt(
      stageDays(ferry)?.departDay ?? null,
      ferryTime,
      (ferryBooking?.time && ferryBooking.timezone) || from.place.zone
    );
    if (!arrival || !departure) continue;
    const zones = [arrival.zone, departure.zone];
    // One end on a known zone and the other on none: the gap is unknowable.
    if (zones.some((z) => z) && !zones.every((z) => z)) continue;
    const arrivalAt = instantOf(arrival);
    const departureAt = instantOf(departure);
    if (!arrivalAt || !departureAt) continue;
    const minutes = Math.round(
      (departureAt.getTime() - arrivalAt.getTime()) / 60_000 - arrival.plusMinutes
    );
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
    const owner = station(item.stationId);
    const window = schedule.stations.find((s) => s.stationId === item.stationId);
    if (!window?.arriveDay || !window.departDay) continue;
    if (item.day >= window.arriveDay && item.day <= window.departDay) continue;
    add(
      "dayTripOutside:" + item.id,
      "dayTripOutside",
      { title: item.title, station: owner?.title ?? "" },
      [item.id, item.day, window.arriveDay, window.departDay],
      "attention"
    );
  }
  return findings;
}

/**
 * Nights a route covers, or cannot know about: every night spent at a station (any night state —
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
  // From the last known departure before an unknown arrival (missing stage or
  // duration) to the next known arrival, nobody knows where the nights go:
  // stageMissing / durationMissing speak there, not nightGap. Outside such a
  // stretch a gap is still a gap.
  let unknownFrom: string | null = null;
  schedule.stations.forEach((s, i) => {
    if (!s.arriveDay) {
      unknownFrom ??= schedule.stations[i - 1]?.departDay ?? null;
      return;
    }
    nightsBetween(unknownFrom, s.arriveDay);
    unknownFrom = null;
  });
  nightsBetween(unknownFrom, state.endDay);
  return covered;
}
