/**
 * The route section's stop-assignment refusals (review M4), each in the
 * reader's words. They used to come back as the server's English prose, then
 * as one generic sentence; now each code has its own reason. Mirrors the codes
 * `PUT …/routes/:routeId/stops` sends (backend `routes/trips/tourRoutes.ts`).
 */
export const ROUTE_STOP_ERROR_KEYS: Readonly<Record<string, string>> = {
  ROUTE_STOP_NOT_OWNED: "trips:tours.assignErrors.notOwned",
  ROUTE_STOP_NO_COORDINATE: "trips:tours.assignErrors.noCoordinate",
  ROUTE_STOP_IN_OTHER_SECTION: "trips:tours.assignErrors.inOtherSection",
  ROUTE_STOP_CLAIMED_MEANWHILE: "trips:tours.assignErrors.claimedMeanwhile",
};

/** A refusal that a second press can cure: someone else's claim may be gone by then. */
export const RETRYABLE_ROUTE_STOP_KEYS: ReadonlySet<string> = new Set([
  ROUTE_STOP_ERROR_KEYS.ROUTE_STOP_CLAIMED_MEANWHILE,
]);
