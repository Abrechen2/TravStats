import logger from "../../utils/logger";

/**
 * Soft warning for past-dated `scheduled` rows (G4) — not rejected so
 * legitimate edge cases (manually re-edited just-departed rows) still succeed,
 * but flagged for ops review since these are almost always a status-flip bug or
 * a year-typo in bulk imports.
 *
 * Moved out of `routes/flights.ts` unchanged: that file is frozen at its size,
 * and filing documents with a new flight needed the lines (forgejo#116).
 */
export function warnIfScheduledInPast(
  userId: string,
  data: { status?: string | null; departureLocal?: string | null; flightNumber?: string | null },
): void {
  if (data.status !== "scheduled" || !data.departureLocal) return;
  const nowIso = new Date().toISOString().slice(0, 19);
  if (data.departureLocal < nowIso) {
    logger.warn({
      operation: "flight_create_scheduled_in_past",
      userId,
      departureLocal: data.departureLocal,
      flightNumber: data.flightNumber,
    });
  }
}
