/**
 * The error codes of the data the Companion keeps on the server — packing
 * lists, home place, passport expiry (Companion audit 2026-10-23). Part of
 * `ApiErrorCode` (`errorHandler.ts`), kept here so that list stays readable.
 */
export type CompanionAppApiErrorCode =
  | "PACKING_LIST_INVALID" // a packing list that breaks its limits or repeats an item id (400)
  | "PACKING_LIST_STALE" // the list changed since the caller's `baseRev`; the body carries the stored one (409)
  | "PERSONAL_SETTINGS_INVALID" // home place or passport expiry malformed (400)
  | "HOME_PERIOD_OVERLAP" // a move that does not start after the running home period (409)
  | "HOME_PERIODS_INVALID" // home periods that break their rules (400)
  | "HOME_AIRPORT_UNKNOWN" // a home airport the catalogue does not know (400)
  | "HOME_NEARBY_INVALID" // malformed nearby-airports query (400)
  | "HOME_PLACE_IS_PERIOD"; // clearing the home place while a current home period holds a residence (409)
