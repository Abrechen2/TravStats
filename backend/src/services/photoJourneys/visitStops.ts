import { localDay } from "../../shared/time/instant";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import { distanceKm, type PhotoCluster } from "./cluster";

/**
 * Which stops inside a recorded trip are worth asking about (forgejo#211).
 *
 * Measured on prod, 2026-10-07: the Korea trip's Immich held 9 to 82 geotagged
 * photos at Gyeongbokgung, Bukchon, Changgyeonggung and the War Memorial, and
 * no visit at any of them — and nothing could say so, because the journey
 * scan only reads the days NO travel explains, and the visit suggestions take
 * photo anchors from imported trip photos alone. The trip was recorded, the
 * photos were in the library, and the two never met.
 *
 * So this reads the stops INSIDE a trip's days and drops the ones the logbook
 * already explains. Pure: clusters and rows in, stops out. Nothing here
 * writes, and nothing it produces is a visit until a person says so.
 */

/** Stop clustering — see `clusterPhotosByStop`. */
export const VISIT_STOP_OPTIONS = {
  maxGapMinutes: 45,
  radiusM: 300,
  minPhotos: 3,
  minDwellMinutes: 5,
} as const;

/**
 * How close an own place, a slept-in lodging or a flown airport must be to
 * explain a stop. Metres, not the journey scan's kilometres: a stop is a GPS
 * fix, and the hotel next door to a palace is not the palace.
 */
export const VISIT_STOP_EXPLAINED_M = 200;

export interface VisitStopTrip {
  id: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
}

export interface VisitStopPlace {
  id: string;
  name: string;
  localName: string | null;
  lat: number;
  lon: number;
  visits: readonly { visitedAt: Date | string | null }[];
}

/** A lodging the user has a stay at. Coordinates may be absent on `Lodging`. */
export interface VisitStopLodging {
  lat: number | null;
  lon: number | null;
}

export interface VisitStopFlight {
  departureTime: Date | null;
  arrivalTime: Date | null;
  status: string;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
}

export interface VisitStop {
  cluster: PhotoCluster;
  /** The trip the stop falls in — the finding's anchor. */
  tripId: string;
  /** The stop's zone, for its calendar days; null where the position has none. */
  zone: string | null;
  /**
   * An own place within reach that has NO visit on the stop's day. The stop
   * is still a question — but accepting it records the visit at THIS place
   * instead of minting a second one beside it.
   */
  place: { id: string; name: string; localName: string | null } | null;
}

const CANCELLED = "cancelled";
const DAY_MS = 86_400_000;

function isoDay(value: Date | string | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Every calendar day the stop covers, on the stop's own clock. */
function daysOf(cluster: PhotoCluster, zone: string | null): readonly string[] {
  const day = (ms: number): string => (zone ? localDay(new Date(ms), zone) : isoDay(ms));
  const last = day(cluster.endMs);
  const days: string[] = [];
  for (let ms = cluster.startMs; ; ms += DAY_MS) {
    const current = day(ms);
    if (!days.includes(current)) days.push(current);
    if (current >= last) break;
  }
  return days;
}

/**
 * The trip whose days hold the stop — the shortest one when several do, so a
 * fortnight filed as one trip and a city break filed inside it name the city
 * break. A trip's days are stored as UTC midnights of its own calendar, and
 * the stop's days are read on its own clock, so the comparison is day to day
 * and a Seoul morning is not pushed into the previous evening.
 */
function tripOf(days: readonly string[], trips: readonly VisitStopTrip[]): VisitStopTrip | null {
  const first = days[0];
  const last = days[days.length - 1];
  let best: { trip: VisitStopTrip; spanMs: number } | null = null;
  for (const trip of trips) {
    if (trip.startDate === null || trip.endDate === null) continue;
    const from = isoDay(trip.startDate);
    const to = isoDay(trip.endDate);
    if (first < from || last > to) continue;
    const spanMs = trip.endDate.getTime() - trip.startDate.getTime();
    if (best === null || spanMs < best.spanMs) best = { trip, spanMs };
  }
  return best?.trip ?? null;
}

const within = (
  at: { lat: number; lon: number },
  other: { lat: number | null | undefined; lon: number | null | undefined }
): boolean =>
  other.lat != null &&
  other.lon != null &&
  distanceKm(at, { lat: other.lat, lon: other.lon }) * 1000 <= VISIT_STOP_EXPLAINED_M;

/** A visit's day, as the rest of the scan reads it (`shared/photoScan.ts`). */
const visitedOn = (place: VisitStopPlace, days: readonly string[]): boolean =>
  place.visits.some((visit) => visit.visitedAt != null && days.includes(isoDay(visit.visitedAt)));

function flightExplains(
  at: { lat: number; lon: number },
  days: readonly string[],
  zone: string | null,
  flights: readonly VisitStopFlight[]
): boolean {
  const onDay = (time: Date | null): boolean =>
    time !== null && days.includes(zone ? localDay(time, zone) : isoDay(time));
  return flights.some(
    (flight) =>
      flight.status !== CANCELLED &&
      ((within(at, { lat: flight.depLat, lon: flight.depLon }) && onDay(flight.departureTime)) ||
        (within(at, { lat: flight.arrLat, lon: flight.arrLon }) && onDay(flight.arrivalTime)))
  );
}

/**
 * The stops of recorded trips the logbook does not explain, biggest first.
 *
 * Dropped: a stop at an own place that already has a visit that day, at a
 * lodging the user has slept at (a hotel lobby is not a sight), or at an
 * airport the user flew from or to that day (the terminal is not a visit).
 * Everything else is a question. `zoneAt` is injectable for the tests; the
 * scan uses the coordinate resolver.
 */
export function findVisitStops(
  clusters: readonly PhotoCluster[],
  rows: {
    trips: readonly VisitStopTrip[];
    places: readonly VisitStopPlace[];
    lodgings: readonly VisitStopLodging[];
    flights: readonly VisitStopFlight[];
  },
  zoneAt: (lat: number, lon: number) => string | null = zoneOfCoordinates
): VisitStop[] {
  const stops: VisitStop[] = [];
  for (const cluster of clusters) {
    const at = cluster.position;
    if (at === null) continue;
    const zone = zoneAt(at.lat, at.lon);
    const days = daysOf(cluster, zone);
    const trip = tripOf(days, rows.trips);
    if (trip === null) continue;

    if (rows.lodgings.some((lodging) => within(at, lodging))) continue;
    if (flightExplains(at, days, zone, rows.flights)) continue;

    let nearest: { place: VisitStopPlace; km: number } | null = null;
    let explained = false;
    for (const place of rows.places) {
      if (!within(at, place)) continue;
      if (visitedOn(place, days)) {
        explained = true;
        break;
      }
      const km = distanceKm(at, place);
      if (nearest === null || km < nearest.km) nearest = { place, km };
    }
    if (explained) continue;

    stops.push({
      cluster,
      tripId: trip.id,
      zone,
      place: nearest
        ? { id: nearest.place.id, name: nearest.place.name, localName: nearest.place.localName }
        : null,
    });
  }
  return stops.sort((a, b) => b.cluster.photoCount - a.cluster.photoCount);
}
