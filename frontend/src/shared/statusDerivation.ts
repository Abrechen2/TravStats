/**
 * Frontend MIRROR of the lodging half of `backend/src/shared/statusDerivation.ts`,
 * following the same backend/frontend mirror convention as `shared/domains.ts`.
 *
 * Only the lodging deriver is mirrored, deliberately. Flights, cruises and
 * trips removed their manual status control outright, so no screen needs to
 * predict their derived value. Lodging keeps a "cancelled" checkbox and shows
 * the reader what the dates imply for the other three states, which is the one
 * case where the client has to compute the same answer the server will store.
 *
 * The rules MUST stay identical to the backend. Both sides are covered by tests
 * asserting the same truth table; change one without the other and those
 * disagree, which is the point of having them.
 */

/** Only a cancellation survives derivation — lodging has no historical/duplicated. */
export const LODGING_PASSTHROUGH = ["cancelled"] as const;

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
