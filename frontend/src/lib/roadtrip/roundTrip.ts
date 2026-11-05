// A round trip is a roadtrip whose last station is its first one again. The
// server has no flag for it: it is a property of the station list, so the
// switch below writes (and removes) that closing station and nothing else.

interface Located {
  lat: number | null;
  lon: number | null;
}

const sameSpot = (a: Located, b: Located): boolean =>
  a.lat !== null && a.lon !== null && a.lat === b.lat && a.lon === b.lon;

/** Two or more stations, the last one standing exactly where the first does. */
export function isRoundTrip(stations: readonly Located[]): boolean {
  return stations.length >= 2 && sameSpot(stations[0], stations[stations.length - 1]);
}

/**
 * The station list with its closing station: a copy of the first one's place
 * and name as a pass-through, without dates (the return day is not known). A
 * list that already closes is returned as is, so the switch cannot double up.
 */
export function withReturnToStart<
  T extends Located & { title: string; night: unknown; startDate?: string | null },
>(stations: readonly T[], close: (first: T) => T): T[] {
  if (stations.length === 0 || isRoundTrip(stations)) return [...stations];
  return [...stations, close(stations[0])];
}
