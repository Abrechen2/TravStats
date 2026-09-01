/**
 * Single source of truth for "does this flight count?".
 *
 * The sibling of `shared/lodgingCounting.ts` and `shared/placeCounting.ts`, and
 * it answers the same owner rule in the shape this domain has. Lodging derives
 * its answer from DATES because its status column is a cache; a flight's is
 * not — `deriveFlightStatus` already folds the calendar into the stored value,
 * and the sweep converges it. So here the status IS the answer, and this file
 * only has to say which statuses mean "this happened".
 *
 * Two of the five do:
 *
 *   - `flown`      — it happened, with times the app trusts.
 *   - `historical` — it happened, recorded after the fact. Times are often a
 *                    placeholder (12:00, or 01-01 for a year-only entry), so it
 *                    is real history with unreliable clocks.
 *
 * The other three do not: `scheduled` has not happened yet, `cancelled` never
 * will, and `duplicated` — see the open question below.
 *
 * ## The second cut, which is NOT this rule
 *
 * Many call sites narrow FURTHER, to `flown` alone, for anything that reads a
 * clock: time-of-day buckets, layovers, average duration, weekday. That is a
 * different question ("are these times trustworthy?") wearing similar clothes,
 * and it is why `historical` is in one filter and out of the one three lines
 * below it. Do not fold those into this module — the pairing is deliberate and
 * each helper documents its own split.
 *
 * ## Open question: does a `duplicated` flight count? (unanswered on purpose)
 *
 * `duplicated` is a real, storable flight status — `FLIGHT_PASSTHROUGH` in
 * shared/statusDerivation.ts carries it, so the sweep never rewrites it. Yet no
 * counting site in the codebase has ever mentioned it, which means today it is
 * excluded from every figure by SILENCE rather than by decision. That silence
 * is what this paragraph exists to break.
 *
 * The status is written by the flights table's "duplicate this row" action
 * (frontend `lib/flightDuplicate.ts`): a template copied off an existing flight
 * with its times deliberately dropped, waiting for the user to give it real
 * dates and move it to `scheduled`. Read that way, excluding it is right — it
 * is a draft, not a journey. But nothing forces the user to ever move it, and
 * an achievement (`duplicated_count`) counts these rows, so the app already
 * treats them as something rather than nothing.
 *
 * Whether they should count is a PRODUCT decision and not a refactor's to make.
 * This module therefore preserves today's behaviour exactly: `duplicated` is
 * out. If the answer changes, it changes here, once.
 *
 * MIRRORED in `frontend/src/shared/flightCounting.ts`. Change both together.
 */

/**
 * The statuses that mean "this flight actually happened".
 *
 * Ordered flown-then-historical to match every `status: { in: [...] }` this
 * replaced, so a query plan or a snapshot test sees no change.
 */
export const COUNTABLE_FLIGHT_STATUSES = ["flown", "historical"] as const;

export type CountableFlightStatus = (typeof COUNTABLE_FLIGHT_STATUSES)[number];

/** The one field this rule reads. Kept structural so a Prisma row, a select
 *  projection and a hand-built test fixture all satisfy it without casting. */
export interface CountableFlight {
  status: string;
}

/**
 * The Prisma `where` fragment for query sites, spread into a larger filter:
 * `{ userId, ...countableFlightWhere() }`.
 *
 * A FUNCTION returning a fresh object, not a shared constant, for the reason
 * the repo's immutability rule exists: a module-level `where` object handed to
 * twenty call sites is twenty aliases of one array, and the first caller that
 * pushes a status onto it changes the other nineteen silently. The cost of
 * allocating a two-element array per query is nothing next to the query.
 *
 * Deliberately typed structurally rather than as `Prisma.FlightWhereInput`, so
 * this file stays importable by the frontend mirror and by tests that have no
 * generated client.
 */
export function countableFlightWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_FLIGHT_STATUSES] } };
}

/** Status-level predicate, for the sites that hold a bare string. */
export function isCountableFlightStatus(status: string): boolean {
  return (COUNTABLE_FLIGHT_STATUSES as readonly string[]).includes(status);
}

/** Row-level predicate, for `.filter` sites: `flights.filter(isCountableFlight)`. */
export function isCountableFlight(flight: CountableFlight): boolean {
  return isCountableFlightStatus(flight.status);
}
