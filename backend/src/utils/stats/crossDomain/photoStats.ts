/**
 * Photo statistics from what the trip photos already store (forgejo#399):
 * `takenAt` and the EXIF coordinates (`lat`/`lon`) written on import. Camera
 * fields are not stored, so nothing about cameras is claimed.
 *
 * Per trip, per day, per country and per place. A photo with no `takenAt`
 * is counted in `photos` but in no day; a photo with no coordinates is in no
 * country. Neither is invented. The per-day key is the calendar day in the
 * user's profile zone (the caller resolves it), not the host's.
 *
 * Abstention: no photos -> `null`. A breakdown with no entries (no photo had
 * a timestamp, say) is an empty list, and the counts of what was left out
 * (`withoutDate`, `withoutCountry`) travel beside it.
 */
export const PHOTO_TOP_LIMIT = 5;

export interface PhotoFact {
  tripId: string;
  tripName: string;
  /** `YYYY-MM-DD` in the profile zone, or null without `takenAt`. */
  day: string | null;
  country: string | null;
  /** The place this photo is attached to through a place visit, if any. */
  placeId: string | null;
  placeName: string | null;
}

export interface PhotoTop {
  key: string;
  label: string;
  count: number;
}

export interface PhotoStats {
  photos: number;
  withoutDate: number;
  withoutCountry: number;
  busiestDay: { day: string; count: number } | null;
  topTrips: PhotoTop[];
  topCountries: PhotoTop[];
  topPlaces: PhotoTop[];
}

function top(counts: Map<string, PhotoTop>): PhotoTop[] {
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, PHOTO_TOP_LIMIT);
}

function bump(map: Map<string, PhotoTop>, key: string, label: string): void {
  const entry = map.get(key);
  if (entry) entry.count += 1;
  else map.set(key, { key, label, count: 1 });
}

export function computePhotoStats(photos: readonly PhotoFact[]): PhotoStats | null {
  if (photos.length === 0) return null;
  const trips = new Map<string, PhotoTop>();
  const countries = new Map<string, PhotoTop>();
  const places = new Map<string, PhotoTop>();
  const days = new Map<string, number>();
  let withoutDate = 0;
  let withoutCountry = 0;
  for (const p of photos) {
    bump(trips, p.tripId, p.tripName);
    if (p.day) days.set(p.day, (days.get(p.day) ?? 0) + 1);
    else withoutDate += 1;
    if (p.country) bump(countries, p.country, p.country);
    else withoutCountry += 1;
    if (p.placeId && p.placeName) bump(places, p.placeId, p.placeName);
  }
  let busiest: { day: string; count: number } | null = null;
  for (const [day, count] of days) {
    if (!busiest || count > busiest.count || (count === busiest.count && day < busiest.day)) {
      busiest = { day, count };
    }
  }
  return {
    photos: photos.length,
    withoutDate,
    withoutCountry,
    busiestDay: busiest,
    topTrips: top(trips),
    topCountries: top(countries),
    topPlaces: top(places),
  };
}
