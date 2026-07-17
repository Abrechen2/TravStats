/**
 * Single source of truth for temporal status derivation (spec
 * 2026-07-17-status-from-dates). The stored status columns are a CACHE of
 * these functions: write paths call them, the hourly sweep converges drift.
 * Slack constants copy the retired one-way flips exactly
 * (zombie flip 6h/30h, past-cruise 48h).
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
    return nowMs - endDate.getTime() > slack ? "flown" : "in_progress";
  }
  // start only: no in_progress without an end — flown once start+slack is past
  return startDate != null && nowMs - startDate.getTime() > slack ? "flown" : "scheduled";
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
