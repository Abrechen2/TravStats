import type { PhotoJourney } from "../../types/photoJourney";

/**
 * What to call a finding on screen — and, when it is accepted as a trip, what
 * to call the trip. ONE rule, one home: the card's heading, the toast and the
 * created trip's name must agree, and three call sites deriving it separately
 * is the same rule applied two times too many.
 *
 * The reverse lookup is allowed to have answered nothing — an ocean, a desert,
 * Nominatim down — and the row still stands, "because the DATES are the find".
 * So the fallback is the coordinates rather than a word like "unknown": two
 * numbers a user can paste into a map say strictly more than a placeholder, and
 * they never claim a city the lookup did not name.
 */
export function photoJourneyLabel(journey: PhotoJourney): string {
  const named = [journey.city, journey.countryName].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  if (named.length > 0) return named.join(", ");
  return `${journey.lat.toFixed(4)}, ${journey.lon.toFixed(4)}`;
}
