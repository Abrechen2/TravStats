/**
 * `YYYY-MM-DD` of a typed time, the part a "date only" end keeps. Named
 * `dayPart` because `lib/tripForDate.ts` already has a `dayOf` that means
 * something else.
 */
export const dayPart = (local: string): string => local.slice(0, 10);

/** A day carries no clock; a `datetime-local` input needs one, so it gets midnight to show. */
export const withClock = (local: string): string =>
  local.length === 10 ? `${local}T00:00` : local;
