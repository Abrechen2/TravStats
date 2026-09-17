/**
 * The Foto-Spürhund's rule: which bursts of photos are worth asking about, and
 * what each one is taken for (forgejo#94).
 *
 * ONE HOME. The Companion reads the same library with the same rule
 * (`app/src/lib/photo-findings.ts`, `photo-scan.ts`, `use-photo-scout.ts` in
 * dennis/TravStatsCompanion). The two copies had drifted — 6 photos here, 4
 * there; "250 km from the most-departed airport" here, "an own airport within
 * 300 km that is not home" there — and the owner settled it on 2026-09-17 in
 * the Companion's favour. Change a constant or a reading here and there
 * together.
 *
 * Everything in this file is pure: plain clusters, flights, places and stays
 * in, candidate findings out. NOTHING it produces is recorded on its own — a
 * finding is a question, and only a person's answer turns it into travel.
 */

import { haversineKm } from "./geo/haversine";

/** A pause longer than this starts a new burst. */
export const PHOTO_SCAN_GAP_HOURS = 48;
/** Fewer photos than this is a moment, not a journey. Owner, 2026-09-17: 4. */
export const PHOTO_SCAN_MIN_PHOTOS = 4;
/** Slack around recorded travel, for the taxi and the evening before. */
export const PHOTO_SCAN_PAD_DAYS = 3;
/**
 * A trip finding needs an own, already-flown airport within this range of one
 * of the burst's coordinates — otherwise no honest place can be named.
 */
export const PHOTO_SCAN_MAX_AIRPORT_KM = 300;
/** How close a photo must be for "you were AT this place". Shown, not hidden. */
export const PHOTO_SCAN_PLACE_NEAR_KM = 2;
/** A stay finding needs at least one night; a day trip is not lodging. */
export const PHOTO_SCAN_STAY_MIN_NIGHTS = 1;
/** Coordinates this close to home do not count towards a journey's spread. */
export const PHOTO_SCAN_HOME_NEAR_KM = 100;

const DAY_MS = 86_400_000;

export interface Coordinate {
  lat: number;
  lon: number;
}

/** A burst of photos that nothing recorded explains, with where it was. */
export interface LocatedCluster {
  startMs: number;
  endMs: number;
  /** Whole nights the burst spans; 0 for a single day. */
  nights: number;
  photoIds: readonly string[];
  /** The coordinate the finding is shown at — see `whereItWas`. */
  lat: number;
  lon: number;
  /** Every coordinate the burst touched. A journey is not a point. */
  samples: readonly Coordinate[];
}

/** One flight row as the rule sees it — coordinates may be absent. */
export interface FlightEndpoints {
  depIata?: string | null;
  depLat?: number | null;
  depLon?: number | null;
  arrIata?: string | null;
  arrLat?: number | null;
  arrLon?: number | null;
}

export interface PlaceWithVisits {
  id: string;
  name: string;
  lat: number;
  lon: number;
  visits: readonly { visitedAt: Date | string | null }[];
}

export interface DatedStay {
  checkIn: Date | string | null;
  checkOut: Date | string | null;
}

export interface PlaceHunch {
  cluster: LocatedCluster;
  placeId: string;
  placeName: string;
  distanceKm: number;
}

export interface TripHunch {
  cluster: LocatedCluster;
  /** The nearest own airport any coordinate of the burst reached. */
  iata: string;
  distanceKm: number;
  /** How far apart the burst's coordinates lie, home left out. */
  spreadKm: number;
}

export interface StayHunch {
  cluster: LocatedCluster;
  /** The own place that gives the nights a name. */
  placeId: string;
  placeName: string;
}

/** Whole nights between two timestamps, never negative. */
export function nightsBetween(startMs: number, endMs: number): number {
  return Math.max(0, Math.floor((endMs - startMs) / DAY_MS));
}

function isoDay(value: Date | string | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Every calendar day (UTC) the burst covers, inclusive. */
function daysOf(cluster: LocatedCluster): readonly string[] {
  const last = isoDay(cluster.endMs);
  const days: string[] = [];
  for (let ms = cluster.startMs; ; ms += DAY_MS) {
    const day = isoDay(ms);
    if (!days.includes(day)) days.push(day);
    if (day >= last) break;
  }
  return days;
}

/**
 * The home airport: the most visited one, departures AND arrivals counted.
 * The server never stores which airport is home, so the account's own rows
 * stand in for it.
 */
export function mostVisitedIata(flights: readonly FlightEndpoints[]): string | null {
  const counts = new Map<string, number>();
  for (const flight of flights) {
    for (const iata of [flight.depIata, flight.arrIata]) {
      if (iata) counts.set(iata, (counts.get(iata) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [iata, count] of counts) {
    if (count > bestCount) {
      best = iata;
      bestCount = count;
    }
  }
  return best;
}

/** Where the home airport is, out of the same rows. */
export function homeCoordinate(flights: readonly FlightEndpoints[], iata: string | null): Coordinate | null {
  if (iata === null) return null;
  for (const flight of flights) {
    if (flight.depIata === iata && flight.depLat != null && flight.depLon != null) {
      return { lat: flight.depLat, lon: flight.depLon };
    }
    if (flight.arrIata === iata && flight.arrLat != null && flight.arrLon != null) {
      return { lat: flight.arrLat, lon: flight.arrLon };
    }
  }
  return null;
}

/** The nearest airport the account has flown, within `maxKm`, or null. */
export function nearestKnownAirport(
  at: Coordinate,
  flights: readonly FlightEndpoints[],
  maxKm: number,
): { iata: string; distanceKm: number } | null {
  let best: { iata: string; distanceKm: number } | null = null;
  for (const flight of flights) {
    const endpoints = [
      { iata: flight.depIata, lat: flight.depLat, lon: flight.depLon },
      { iata: flight.arrIata, lat: flight.arrLat, lon: flight.arrLon },
    ];
    for (const endpoint of endpoints) {
      if (!endpoint.iata || endpoint.lat == null || endpoint.lon == null) continue;
      const distanceKm = haversineKm(at, { lat: endpoint.lat, lon: endpoint.lon });
      if (distanceKm <= maxKm && (best === null || distanceKm < best.distanceKm)) {
        best = { iata: endpoint.iata, distanceKm };
      }
    }
  }
  return best;
}

/**
 * The coordinate a burst is shown at: the one FARTHEST from home.
 *
 * A burst starts at the departure gate and ends at the destination. Taking the
 * first coordinate — or a median pulled towards the gate — located a
 * thirteen-day Egypt Rundreise at its owner's home airport, where the trip
 * rule then correctly threw it away as everyday photos. Without a home to
 * measure against, the LAST sample wins: a burst ends where it went far more
 * often than it ends where it started.
 */
export function whereItWas(samples: readonly Coordinate[], home: Coordinate | null): Coordinate | null {
  if (samples.length === 0) return null;
  if (home === null) return samples[samples.length - 1];
  let best = samples[0];
  let bestKm = -1;
  for (const sample of samples) {
    const km = haversineKm(home, sample);
    if (km > bestKm) {
      best = sample;
      bestKm = km;
    }
  }
  return best;
}

function coordsOf(cluster: LocatedCluster): readonly Coordinate[] {
  return cluster.samples.length > 0 ? cluster.samples : [{ lat: cluster.lat, lon: cluster.lon }];
}

function nearestDistanceKm(cluster: LocatedCluster, to: Coordinate): number {
  return Math.min(...coordsOf(cluster).map((at) => haversineKm(at, to)));
}

/**
 * Photos near a place the account already owns, on days no visit is recorded —
 * the strongest evidence a photo gives: GPS at a coordinate you already named.
 * It matches only places the account HAS; a place it cannot name is a place it
 * must not offer.
 */
export function placeHunches(
  clusters: readonly LocatedCluster[],
  places: readonly PlaceWithVisits[],
): PlaceHunch[] {
  const hunches: PlaceHunch[] = [];
  for (const cluster of clusters) {
    const days = daysOf(cluster);
    let best: PlaceHunch | null = null;
    for (const place of places) {
      const distanceKm = nearestDistanceKm(cluster, place);
      if (distanceKm > PHOTO_SCAN_PLACE_NEAR_KM) continue;
      const known = place.visits.some((visit) => visit.visitedAt != null && days.includes(isoDay(visit.visitedAt)));
      if (known) continue;
      if (best === null || distanceKm < best.distanceKm) {
        best = { cluster, placeId: place.id, placeName: place.name, distanceKm };
      }
    }
    if (best !== null) hunches.push(best);
  }
  return hunches;
}

function spreadAwayFromHome(coords: readonly Coordinate[], home: Coordinate | null): number {
  // The departure gate is in almost every trip's first photo; counting it
  // measures the flight, not the journey.
  const away = home === null ? coords : coords.filter((at) => haversineKm(home, at) > PHOTO_SCAN_HOME_NEAR_KM);
  if (away.length < 2) return 0;
  let widest = 0;
  for (const at of away) {
    for (const other of away) widest = Math.max(widest, haversineKm(at, other));
  }
  return widest;
}

/**
 * A burst with no travel on record, located by the account's OWN airports: some
 * coordinate of it lies within reach of an airport the account has flown, and
 * that airport is not home. Photos at home are everyday photos.
 */
export function tripHunches(
  clusters: readonly LocatedCluster[],
  flights: readonly FlightEndpoints[],
  homeIata: string | null,
): TripHunch[] {
  const home = homeCoordinate(flights, homeIata);
  const hunches: TripHunch[] = [];
  for (const cluster of clusters) {
    let nearest: { iata: string; distanceKm: number } | null = null;
    for (const at of coordsOf(cluster)) {
      const candidate = nearestKnownAirport(at, flights, PHOTO_SCAN_MAX_AIRPORT_KM);
      if (candidate === null || candidate.iata === homeIata) continue;
      if (nearest === null || candidate.distanceKm < nearest.distanceKm) nearest = candidate;
    }
    if (nearest === null) continue;
    hunches.push({ cluster, ...nearest, spreadKm: spreadAwayFromHome(coordsOf(cluster), home) });
  }
  return hunches;
}

/**
 * Nights away with no dated stay — and honest about being the thinnest: it can
 * see that you slept away, not in which house. So it names the nights by an own
 * place nearby, and a burst it cannot name that way is no offer at all.
 */
export function stayHunches(
  clusters: readonly LocatedCluster[],
  stays: readonly DatedStay[],
  places: readonly PlaceWithVisits[],
): StayHunch[] {
  const hunches: StayHunch[] = [];
  for (const cluster of clusters) {
    if (cluster.nights < PHOTO_SCAN_STAY_MIN_NIGHTS) continue;
    const days = daysOf(cluster);
    // Only a DATED stay can explain nights; one without check-in says nothing about when.
    const explained = stays.some((stay) => {
      if (stay.checkIn == null) return false;
      const from = isoDay(stay.checkIn);
      const to = stay.checkOut != null ? isoDay(stay.checkOut) : from;
      return days.some((day) => day >= from && day <= to);
    });
    if (explained) continue;
    let nearest: { place: PlaceWithVisits; km: number } | null = null;
    for (const place of places) {
      const km = nearestDistanceKm(cluster, place);
      if (nearest === null || km < nearest.km) nearest = { place, km };
    }
    if (nearest === null || nearest.km > PHOTO_SCAN_PLACE_NEAR_KM) continue;
    hunches.push({ cluster, placeId: nearest.place.id, placeName: nearest.place.name });
  }
  return hunches;
}

/**
 * One burst, one question. The readings are ranked by how much they can prove —
 * place, then trip, then stay — and a cluster leaves with the first that fits.
 * Offering the same days as a trip AND a stay would ask twice and let a person
 * record them twice from one piece of evidence.
 */
export function rankReadings(
  clusters: readonly LocatedCluster[],
  flights: readonly FlightEndpoints[],
  places: readonly PlaceWithVisits[],
  stays: readonly DatedStay[],
): { place: PlaceHunch[]; trip: TripHunch[]; stay: StayHunch[] } {
  const taken = new Set<LocatedCluster>();
  const rest = (): LocatedCluster[] => clusters.filter((cluster) => !taken.has(cluster));
  const claim = <T extends { cluster: LocatedCluster }>(hunches: T[]): T[] => {
    for (const hunch of hunches) taken.add(hunch.cluster);
    return hunches;
  };
  const place = claim(placeHunches(rest(), places));
  const trip = claim(tripHunches(rest(), flights, mostVisitedIata(flights)));
  const stay = claim(stayHunches(rest(), stays, places));
  return { place, trip, stay };
}
