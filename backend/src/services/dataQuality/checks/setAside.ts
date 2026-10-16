/**
 * Entries the user has already answered for: a cancellation, or a copy they
 * marked as a duplicate. Checking only `cancelled` meant the answer "this is a
 * duplicate" brought the same duplicate and overlap question straight back on
 * the next run, against the very original it duplicates.
 */
const SET_ASIDE = new Set(["cancelled", "duplicated"]);

export const isSetAside = (status: string | null | undefined): boolean =>
  status != null && SET_ASIDE.has(status);
