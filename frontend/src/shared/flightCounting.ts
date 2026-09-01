/**
 * Frontend MIRROR of `backend/src/shared/flightCounting.ts`, following the same
 * convention as `shared/domains.ts`, `shared/statusDerivation.ts` and
 * `shared/lodgingCounting.ts`.
 *
 * Two of the five flight statuses mean "this happened":
 *
 *   - `flown`      — it happened, with times the app trusts.
 *   - `historical` — it happened, recorded after the fact, so its times are
 *                    often a placeholder.
 *
 * `scheduled` has not happened yet, `cancelled` never will, and `duplicated` is
 * an open product question — see the backend header, which states it in full.
 * Today it is excluded on both sides, and this file exists so that stays true
 * on both sides at once.
 *
 * The client needs its own copy because the map decides the same question
 * locally and does not ask the server: `layers/routesLayer.ts` and `GlobeView`
 * split each route into flown-vs-scheduled to colour it, `AirportTooltip` only
 * adds kilometres for legs that were actually covered, and `Stats.tsx` /
 * `AdvancedStatsPage` filter a raw flight list before computing anything. Those
 * numbers sit on screen next to the server's own, so the two rules disagreeing
 * would be visible as two different answers on one page.
 *
 * The rules MUST stay identical to the backend. Both sides are covered by tests
 * asserting the same truth table; change one without the other and those
 * disagree, which is the point of having them.
 *
 * NOT mirrored: the Prisma `where` fragment, which has no meaning here.
 */

/** The statuses that mean "this flight actually happened". */
export const COUNTABLE_FLIGHT_STATUSES = ["flown", "historical"] as const;

export type CountableFlightStatus = (typeof COUNTABLE_FLIGHT_STATUSES)[number];

/** The one field this rule reads. Structural, so a `Flight` and a GeoJSON
 *  feature's `properties` both satisfy it without a cast. */
export interface CountableFlight {
  status: string;
}

/** Status-level predicate, for the sites that hold a bare string. */
export function isCountableFlightStatus(status: string): boolean {
  return (COUNTABLE_FLIGHT_STATUSES as readonly string[]).includes(status);
}

/** Row-level predicate, for `.filter` sites: `flights.filter(isCountableFlight)`. */
export function isCountableFlight(flight: CountableFlight): boolean {
  return isCountableFlightStatus(flight.status);
}
