/**
 * The error codes of the data the Companion keeps on the server — packing
 * lists, home place, passport expiry (Companion audit 2026-10-23). Part of
 * `ApiErrorCode` (`errorHandler.ts`), kept here so that list stays readable.
 */
export type CompanionAppApiErrorCode =
  | "PACKING_LIST_INVALID" // a packing list that breaks its limits or repeats an item id (400)
  | "PACKING_LIST_STALE" // the list changed since the caller's `baseRev`; the body carries the stored one (409)
  | "PERSONAL_SETTINGS_INVALID"; // home place or passport expiry malformed (400)
