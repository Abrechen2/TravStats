/**
 * Frontend MIRROR of the lodging half of `backend/src/shared/statusDerivation.ts`,
 * following the same backend/frontend mirror convention as `shared/domains.ts`.
 *
 * Lodging keeps a "cancelled" checkbox and shows the reader what the dates imply
 * for the other three states — the case where the client has to compute the same
 * answer the server will store.
 *
 * The FLIGHT deriver joined it when `duplicated` stopped being a travel state on
 * screen. A duplicate is a data-quality mark, not a place on the journey, so the
 * row shows what the DATES say ("geflogen", "geplant") and carries the duplicate
 * as a separate grey tag. Computing that here rather than in the cell keeps the
 * two sides of the mirror answerable by the same truth table.
 *
 * The rules MUST stay identical to the backend. Both sides are covered by tests
 * asserting the same truth table; change one without the other and those
 * disagree, which is the point of having them.
 */

/** Only a cancellation survives derivation — lodging has no historical/duplicated. */
export const LODGING_PASSTHROUGH = ["cancelled"] as const;

/** Statuses the backend deriver never overwrites. Mirrors FLIGHT_PASSTHROUGH. */
export const FLIGHT_PASSTHROUGH = ["cancelled", "historical", "duplicated"] as const;

/** Slack bands, copied from the backend constants of the same name. */
export const FLIGHT_ARRIVAL_SLACK_HOURS = 6;
export const FLIGHT_DEPARTURE_SLACK_HOURS = 30;

const HOUR_MS = 60 * 60 * 1000;

/**
 * What the dates say a flight is. Identical rules to the backend deriver.
 *
 * `passthrough: false` asks the question the display needs for a duplicate:
 * "ignore the stored marker, where is this flight in time?" — the backend never
 * needs that, because it is storing the marker rather than drawing it.
 */
export function deriveFlightStatus(input: {
  departureTime: Date | null;
  arrivalTime: Date | null;
  current: string;
  now?: Date;
  passthrough?: boolean;
}): string {
  const { departureTime, arrivalTime, current, passthrough = true } = input;
  if (passthrough && (FLIGHT_PASSTHROUGH as readonly string[]).includes(current)) return current;
  const nowMs = (input.now ?? new Date()).getTime();
  if (arrivalTime != null) {
    return nowMs - arrivalTime.getTime() > FLIGHT_ARRIVAL_SLACK_HOURS * HOUR_MS
      ? "flown"
      : "scheduled";
  }
  if (departureTime != null) {
    return nowMs - departureTime.getTime() > FLIGHT_DEPARTURE_SLACK_HOURS * HOUR_MS
      ? "flown"
      : "scheduled";
  }
  return current;
}

/**
 * "Check-In und Check-Out vergangen = abgeschlossen, Check-In vergangen aber
 * Check-Out Zukunft = laufend, Check-In und Check-Out Zukunft = geplant"
 * (Alex, Discord 2026-07-12).
 *
 * No slack band, unlike flights (6h/30h) and cruises (48h): a check-out is a
 * calendar fact the user typed, not a revisable estimate.
 */
export function deriveLodgingStatus(input: {
  checkIn: Date | null;
  checkOut: Date | null;
  current: string;
  now?: Date;
}): string {
  const { checkIn, checkOut, current } = input;
  if ((LODGING_PASSTHROUGH as readonly string[]).includes(current)) return current;
  if (checkIn == null && checkOut == null) return current;
  const nowMs = (input.now ?? new Date()).getTime();
  const start = checkIn ?? checkOut!;
  const end = checkOut ?? checkIn!;
  if (nowMs < start.getTime()) return "scheduled";
  if (nowMs >= end.getTime()) return "completed";
  return "in_progress";
}
