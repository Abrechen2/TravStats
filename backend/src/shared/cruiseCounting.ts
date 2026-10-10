/**
 * Single source of truth for "does this cruise count?".
 *
 * The sibling of `shared/flightCounting.ts`, `shared/lodgingCounting.ts` and
 * `shared/placeCounting.ts`. It exists because the answer was spelled out as a
 * literal `["flown", "historical"]` at eight call sites across both trees, and
 * two lists that agree by coincidence are two lists that will one day disagree
 * — `statusDerivation.ts` already shows how easily the two domains drift, since
 * `FLIGHT_PASSTHROUGH` carries `duplicated` and `CRUISE_PASSTHROUGH` does not.
 *
 * Two statuses mean the voyage happened:
 *
 *   - `completed`  — it sailed, with dates the app trusts.
 *   - `historical` — it sailed, recorded after the fact, dates often coarse.
 *
 * `flown` is the retired spelling of `completed` (#357) — the flight word,
 * reused while the column was shared. Migration
 * `20261010010000_cruise_status_completed` rewrote the stored rows and every
 * write path normalises it away (`normalizeCruiseStatus`), but it stays on
 * this list so a row a stale writer slipped in before the hourly sweep
 * converges it still counts as the voyage it is.
 *
 * The others do not: `scheduled` has not happened yet and `cancelled` never
 * will. Unlike flights there is no `duplicated` here — `CRUISE_PASSTHROUGH`
 * does not carry it, so the open question that file documents has no twin.
 *
 * MIRRORED in `frontend/src/shared/cruiseCounting.ts`. Change both together.
 */

/** The statuses that mean "this cruise actually sailed". */
export const COUNTABLE_CRUISE_STATUSES = ["completed", "historical", "flown"] as const;

export type CountableCruiseStatus = (typeof COUNTABLE_CRUISE_STATUSES)[number];

/** The one field this rule reads — structural, so a Prisma row, a select
 *  projection and a hand-built fixture all satisfy it without casting. */
export interface CountableCruise {
  status: string;
}

/**
 * The Prisma `where` fragment, spread into a larger filter:
 * `{ userId, ...countableCruiseWhere() }`.
 *
 * A function returning a fresh object rather than a shared constant, for the
 * same reason `countableFlightWhere` is one: a module-level object handed to
 * every call site is one array under many aliases, and the first caller that
 * mutates it changes the rest in silence.
 */
export function countableCruiseWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_CRUISE_STATUSES] } };
}

/** Status-level predicate, for sites holding a bare string. */
export function isCountableCruiseStatus(status: string): boolean {
  return (COUNTABLE_CRUISE_STATUSES as readonly string[]).includes(status);
}

/** Row-level predicate, for `.filter` sites. */
export function isCountableCruise(cruise: CountableCruise): boolean {
  return isCountableCruiseStatus(cruise.status);
}
