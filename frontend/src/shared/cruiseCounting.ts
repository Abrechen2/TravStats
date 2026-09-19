/**
 * Frontend MIRROR of `backend/src/shared/cruiseCounting.ts`, following the same
 * convention as `shared/domains.ts`, `shared/statusDerivation.ts` and
 * `shared/flightCounting.ts`.
 *
 * Nothing checks that the two sides agree — each has its own test asserting the
 * same truth table, which is a convention, not a guard. Change both together.
 *
 * First consumer, 2026-09-19: `components/Stats/CruiseStatsSection.tsx`, which
 * folds the cruise LIST for the money block and has to answer for the same
 * population `GET /stats/cruise` does. It was written against the backend rule
 * before anything on this side asked the question, and an unused mirror is a
 * mirror nobody notices has drifted — so a second consumer is welcome, and a
 * copy of `["flown", "historical"]` anywhere in this tree is not.
 */

/** The statuses that mean "this cruise actually sailed". */
export const COUNTABLE_CRUISE_STATUSES = ["flown", "historical"] as const;

export type CountableCruiseStatus = (typeof COUNTABLE_CRUISE_STATUSES)[number];

/** The one field this rule reads — structural, so a Prisma row, a select
 *  projection and a hand-built fixture all satisfy it without casting. */
export interface CountableCruise {
  status: string;
}

/** Status-level predicate, for sites holding a bare string. */
export function isCountableCruiseStatus(status: string): boolean {
  return (COUNTABLE_CRUISE_STATUSES as readonly string[]).includes(status);
}

/** Row-level predicate, for `.filter` sites. */
export function isCountableCruise(cruise: CountableCruise): boolean {
  return isCountableCruiseStatus(cruise.status);
}
