/**
 * The keys the cruise logbook can be ordered by.
 *
 * MIRRORED from `backend/src/shared/cruiseListOrder.ts`, which also carries
 * the comparator — this side carries the NAMES only, because since the list
 * pages on the server nothing in the browser sorts cruises. The header sends
 * a key and the server orders by it; a key offered here and rejected there is
 * a 400 on a click, so the two lists move together.
 */
export const CRUISE_SORT_FIELDS = ["date", "ship", "line", "ports", "status", "price"] as const;
export type CruiseSortField = (typeof CRUISE_SORT_FIELDS)[number];
