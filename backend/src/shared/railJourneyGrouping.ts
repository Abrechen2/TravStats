/**
 * Single source of truth for "which train rides read as ONE journey"
 * (forgejo#187) — a PRESENTATION grouping for the rail logbook. It counts
 * nothing: statistics, map layers and achievements keep reading legs, one row
 * per train, exactly as before.
 *
 * What the data holds. A change of trains is not stored leg-to-leg: the
 * `connectsFrom` a create request names is consumed by `bindConnection`, which
 * puts both legs into one `Booking`. So the only explicit link is a shared
 * `bookingId`, and it carries no order and no "these two meet" — a return
 * ticket imports its outbound and its return into the same booking too.
 *
 * The rule, therefore, in two steps:
 *
 * 1. Only legs of the SAME booking can belong together. Legs that merely
 *    share a booking reference string are never grouped — a reference typed
 *    twice proves nothing, and a silent guess here would glue strangers.
 * 2. Inside a booking the legs are read in departure order, and a leg
 *    continues the one before it only when all of these hold:
 *    - it leaves from the station the previous leg arrived at
 *      (`sameStation`);
 *    - both the previous arrival and its own departure are known to the
 *      minute, and it leaves no earlier than the previous leg arrived and at
 *      most `MAX_TRANSFER_MINUTES` later;
 *    - it does not arrive at a station the journey has already been to —
 *      that is the way back, not a change of trains.
 *    Anything else starts a new journey. A gap that cannot be measured is
 *    not "short": abstention is a result, so such a leg stands alone.
 *
 * No frontend mirror: the server groups (the list is server-paged, and a
 * journey must not be cut by a page boundary), the client only draws.
 */

import { haversineKm } from "./geo/haversine";

/**
 * The longest wait between two trains that still reads as a change. Four
 * hours covers a missed connection and a night-time wait; a same-day return
 * after a meeting is usually further apart, and where it is not, the
 * "already been there" rule splits it.
 */
export const MAX_TRANSFER_MINUTES = 240;

/**
 * Two station records closer than this are the same place to change at:
 * a geocoder pick beside a catalogue row, or "Hbf" beside "Hbf (tief)".
 */
export const SAME_STATION_KM = 1;

export interface GroupableRailLeg {
  id: string;
  bookingId: string | null;
  depStationId: number | null;
  arrStationId: number | null;
  depStationName: string;
  arrStationName: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  departureTime: Date;
  arrivalTime: Date | null;
  /** minute | day | unknown; null = written before the column existed (minute). */
  depPrecision: string | null;
  arrPrecision: string | null;
}

interface StationRef {
  id: number | null;
  name: string;
  lat: number;
  lon: number;
}

const depOf = (leg: GroupableRailLeg): StationRef => ({
  id: leg.depStationId,
  name: leg.depStationName,
  lat: leg.depLat,
  lon: leg.depLon,
});

const arrOf = (leg: GroupableRailLeg): StationRef => ({
  id: leg.arrStationId,
  name: leg.arrStationName,
  lat: leg.arrLat,
  lon: leg.arrLon,
});

const foldName = (name: string): string => name.trim().toLocaleLowerCase();

/** The same catalogue row, the same recorded name, or within `SAME_STATION_KM`. */
export function sameStation(a: StationRef, b: StationRef): boolean {
  if (a.id !== null && b.id !== null && a.id === b.id) return true;
  if (foldName(a.name) !== "" && foldName(a.name) === foldName(b.name)) return true;
  return haversineKm(a, b) <= SAME_STATION_KM;
}

const toTheMinute = (precision: string | null): boolean =>
  precision === null || precision === "minute";

/**
 * Minutes between the previous leg's arrival and this leg's departure; null
 * when either is not known to the minute.
 */
export function transferMinutes(
  previous: Pick<GroupableRailLeg, "arrivalTime" | "arrPrecision">,
  next: Pick<GroupableRailLeg, "departureTime" | "depPrecision">
): number | null {
  if (!previous.arrivalTime) return null;
  if (!toTheMinute(previous.arrPrecision) || !toTheMinute(next.depPrecision)) return null;
  const minutes = (next.departureTime.getTime() - previous.arrivalTime.getTime()) / 60_000;
  return Number.isFinite(minutes) ? minutes : null;
}

function continues(journey: readonly GroupableRailLeg[], next: GroupableRailLeg): boolean {
  const previous = journey[journey.length - 1];
  if (!sameStation(arrOf(previous), depOf(next))) return false;
  const wait = transferMinutes(previous, next);
  if (wait === null || wait < 0 || wait > MAX_TRANSFER_MINUTES) return false;
  const destination = arrOf(next);
  const visited = [depOf(journey[0]), ...journey.map(arrOf)];
  return !visited.some((station) => sameStation(station, destination));
}

const inTravelOrder = (a: GroupableRailLeg, b: GroupableRailLeg): number =>
  a.departureTime.getTime() - b.departureTime.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The legs as journeys: every leg is in exactly one, each journey's legs are
 * in travel order, and the journeys are ordered by their first departure
 * (then by their first leg's id, so the order is total).
 */
export function groupRailLegs<T extends GroupableRailLeg>(legs: readonly T[]): T[][] {
  const byBooking = new Map<string, T[]>();
  const journeys: T[][] = [];
  for (const leg of legs) {
    if (leg.bookingId === null) {
      journeys.push([leg]);
      continue;
    }
    const bucket = byBooking.get(leg.bookingId);
    if (bucket) bucket.push(leg);
    else byBooking.set(leg.bookingId, [leg]);
  }
  for (const bucket of byBooking.values()) {
    let current: T[] | null = null;
    for (const leg of [...bucket].sort(inTravelOrder)) {
      if (current && continues(current, leg)) {
        current.push(leg);
      } else {
        current = [leg];
        journeys.push(current);
      }
    }
  }
  return journeys.sort((a, b) => inTravelOrder(a[0], b[0]));
}
