/**
 * Single source of truth for temporal status derivation (spec
 * 2026-07-17-status-from-dates). The stored status columns are a CACHE of
 * these functions: write paths call them, the hourly sweep converges drift.
 * Slack constants copy the retired one-way flips exactly
 * (zombie flip 6h/30h, past-cruise 48h).
 *
 * Hysteresis in the slack band: Derivers return the conservative default
 * ("scheduled") for the entire FLIGHT_ARRIVAL_SLACK_HOURS window (now-6h to now)
 * on WRITE paths — this is the safe value for incoming API data. However, the
 * sweep's flown→scheduled revert intentionally covers only STRICTLY FUTURE dates,
 * leaving the slack band untouched. This asymmetry is deliberate: inside the
 * band, a stored "flown" is legitimate (from user/parser-set values, script/seed
 * writes, or pre-existing data—never from applyPendingUpdate, which deliberately
 * never touches status; the only automated status writers are the legacy one-way
 * flips this sweep replaces, transitionZombieFlights and transitionPastCruises,
 * retired in a follow-up task, whose 6h/30h/48h cutoffs equal these slack
 * constants), and the sweep must not fight that deliberate data. The band acts as
 * a hysteresis zone, protecting intentional user/import data from repeated
 * reversions on the hourly tick.
 */
export const FLIGHT_ARRIVAL_SLACK_HOURS = 6;
export const FLIGHT_DEPARTURE_SLACK_HOURS = 30;
export const CRUISE_SLACK_HOURS = 48;
export const FLIGHT_PASSTHROUGH = ["cancelled", "historical", "duplicated"] as const;
export const CRUISE_PASSTHROUGH = ["cancelled", "historical"] as const;

const H = 60 * 60 * 1000;

export function deriveFlightStatus(input: {
  departureTime: Date | null;
  arrivalTime: Date | null;
  current: string;
  now?: Date;
}): string {
  const { departureTime, arrivalTime, current } = input;
  if ((FLIGHT_PASSTHROUGH as readonly string[]).includes(current)) return current;
  const nowMs = (input.now ?? new Date()).getTime();
  if (arrivalTime != null) {
    return nowMs - arrivalTime.getTime() > FLIGHT_ARRIVAL_SLACK_HOURS * H ? "flown" : "scheduled";
  }
  if (departureTime != null) {
    return nowMs - departureTime.getTime() > FLIGHT_DEPARTURE_SLACK_HOURS * H
      ? "flown"
      : "scheduled";
  }
  return current;
}

export function deriveCruiseStatus(input: {
  startDate: Date | null;
  endDate: Date | null;
  current: string;
  now?: Date;
}): string {
  const { startDate, endDate, current } = input;
  if ((CRUISE_PASSTHROUGH as readonly string[]).includes(current)) return current;
  const nowMs = (input.now ?? new Date()).getTime();
  const slack = CRUISE_SLACK_HOURS * H;
  if (startDate == null && endDate == null) return current;
  if (startDate != null && nowMs < startDate.getTime()) return "scheduled";
  if (endDate != null) {
    if (nowMs - endDate.getTime() > slack) return "flown";
    // A known end date within slack only means "in_progress" if the start
    // date is also known (and, per the branch above, already past/now) —
    // a null start with a future/near end is a not-yet-started cruise, not
    // an ongoing one. Keeps this deriver in agreement with the sweep's
    // cruiseToInProgress, which requires startDate != null too.
    return startDate != null ? "in_progress" : "scheduled";
  }
  // start only: no in_progress without an end — flown once start+slack is past
  return startDate != null && nowMs - startDate.getTime() > slack ? "flown" : "scheduled";
}

/**
 * Extract a trip's date bounds from its linked flights + cruises — the
 * earliest segment start and the latest segment end. Shared by the sweep
 * (statusSweep.ts) and the per-trip recompute service (tripStatusService.ts)
 * so the two write paths can never drift on how bounds are computed.
 * A flight/cruise missing its end date falls back to its start date (a
 * single-ended segment still contributes a point-in-time bound).
 */
export function tripDateBounds(
  flights: Array<{ departureTime: Date | null; arrivalTime: Date | null }>,
  cruises: Array<{ startDate: Date | null; endDate: Date | null }>,
): { earliestStart: Date | null; latestEnd: Date | null } {
  const starts = [
    ...flights.map((f) => f.departureTime),
    ...cruises.map((c) => c.startDate),
  ].filter((d): d is Date => d != null);
  const ends = [
    ...flights.map((f) => f.arrivalTime ?? f.departureTime),
    ...cruises.map((c) => c.endDate ?? c.startDate),
  ].filter((d): d is Date => d != null);
  return {
    earliestStart: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
    latestEnd: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
  };
}

export function deriveTripStatus(input: {
  earliestStart: Date | null;
  latestEnd: Date | null;
  now?: Date;
}): "planned" | "in_progress" | "completed" | null {
  const { earliestStart, latestEnd } = input;
  if (earliestStart == null && latestEnd == null) return null;
  const nowMs = (input.now ?? new Date()).getTime();
  const start = earliestStart ?? latestEnd!;
  const end = latestEnd ?? earliestStart!;
  if (nowMs < start.getTime()) return "planned";
  if (nowMs > end.getTime()) return "completed";
  return "in_progress";
}
