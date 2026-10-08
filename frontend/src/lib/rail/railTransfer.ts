import { railArrival, railDeparture, type RailLike } from "../entityTimes";
import type { TimeValue } from "../../shared/time";
import type { RailJourney } from "../../types/rail";

/**
 * What lies between two consecutive legs of a booking (forgejo#234): the
 * wait, a departure before the previous arrival, a walk to another station —
 * or nothing that can be said. ONE home for that verdict; the connection
 * view, the detail page and the whole-ride page all read it from here.
 *
 * Abstention is a result, twice over:
 * - A wait is measured only between two instants known to the minute
 *   (`TimeValue.utc`, so a change across zones or inside the repeated autumn
 *   hour measures what really passes); a day-only or missing end makes it
 *   `unknown` — never 0, and never "reachable".
 * - The legs arrive in departure order, and a day-only departure is stored at
 *   local midnight, so it sorts before every timed leg of its day whether or
 *   not it ran first. Where that order is not KNOWN — a day-only leg shares a
 *   day with a gap — every claim that rests on it (the wait, a change of
 *   station, "another ride") is withheld: `unknown`, reason `order`
 *   (review 2026-10-08, important 1).
 *
 * Nothing here claims a change WORKS: `shortHint` is a hint that the gap is
 * under ten minutes, worded as one, and the user's own "tight" mark lives on
 * the arriving leg (`tightConnection`), not here.
 */

export type RailTransferLeg = RailLike &
  Pick<
    RailJourney,
    | "depStationName"
    | "arrStationName"
    | "depStationId"
    | "arrStationId"
    | "depLat"
    | "depLon"
    | "arrLat"
    | "arrLon"
  >;

/**
 * "Must I go to another station?" — the TRANSFER view's question, which is
 * not the grouping's (see `transferStation`).
 * - `same`: the same station, or two names for it a few steps apart;
 * - `change`: another station, `meters` away in a straight line — never a
 *   walking time, which nothing here knows;
 * - `unconfirmed`: another name, and a position is missing, so whether it is
 *   another place cannot be told either way.
 */
export type StationVerdict =
  { kind: "same" } | { kind: "change"; meters: number } | { kind: "unconfirmed" };

export type RailTransfer =
  /** Either end is not known to the minute, or missing. */
  | { kind: "unknown"; reason: "time"; station: StationVerdict }
  /** The two legs' order itself is not known, so no station is claimed either. */
  | { kind: "unknown"; reason: "order" }
  /** The next train leaves before the previous one arrives; `minutes` is negative. */
  | { kind: "conflict"; minutes: number; station: StationVerdict }
  | { kind: "transfer"; minutes: number; station: StationVerdict; shortHint: boolean }
  /**
   * Not a change of trains: the next leg leaves later than a change is read
   * as, or goes back to a station the ride already passed (the way home on
   * the same booking). Nothing about a wait is claimed.
   */
  | { kind: "separate" };

/** Under this many minutes, the view adds the "short transfer" hint. */
export const SHORT_TRANSFER_HINT_MINUTES = 10;

/**
 * The longest wait still read as a change — the server's
 * `MAX_TRANSFER_MINUTES` (backend `shared/railJourneyGrouping.ts`). Both
 * suites run `shared/rail/transferVectors.json`, which pins 240 and 241.
 */
export const SEPARATE_RIDE_AFTER_MINUTES = 240;

/** Two station records closer than this are one place to change at — the server's `SAME_STATION_KM`. */
export const SAME_STATION_KM = 1;

interface StationRef {
  id: number | null;
  name: string;
  /** Null where no position is known — only the transfer view reads that case. */
  lat: number | null;
  lon: number | null;
}

/**
 * Closer than this, two station records with different names are read as two
 * names for ONE station in the transfer view (a geocoder pick beside its
 * catalogue row, "Hbf" beside "Hauptbahnhof").
 *
 * Why not the grouping's 1 km: the two rules answer different questions.
 * Grouping asks "do these trains form one ride?", where Paris Est and Paris
 * Nord, 500 m apart, rightly belong together. The transfer line asks "must I
 * go to another station?", where the same pair is a walk across the street —
 * and "kein Bahnhofswechsel" would be a false statement a traveller acts on
 * (ruling 2026-10-08). 150 m covers a station's own records, not its
 * neighbours. Pinned with the grouping rule in `shared/rail/transferVectors.json`.
 */
export const SAME_STATION_DISPLAY_METERS = 150;

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Great-circle distance, the backend's `haversineKm`. */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const foldName = (name: string): string => name.trim().toLocaleLowerCase();

/**
 * The server's `sameStation`, mirrored exactly: the same catalogue row, the
 * same recorded name, or within `SAME_STATION_KM`. It answers the GROUPING
 * question — here, whether the next leg goes back to a station the ride
 * already passed (another ride, not a change). Whether the user must walk to
 * another station is `transferStation`'s question. Pinned by
 * `shared/rail/transferVectors.json`.
 */
export function sameStation(a: StationRef, b: StationRef): boolean {
  if (a.id !== null && b.id !== null && a.id === b.id) return true;
  if (foldName(a.name) !== "" && foldName(a.name) === foldName(b.name)) return true;
  const pa = positionOf(a);
  const pb = positionOf(b);
  return pa !== null && pb !== null && distanceKm(pa, pb) <= SAME_STATION_KM;
}

const positionOf = (s: StationRef): { lat: number; lon: number } | null =>
  s.lat === null || s.lon === null ? null : { lat: s.lat, lon: s.lon };

/**
 * The transfer view's answer to "must I go to another station?" — narrower
 * than `sameStation`, on purpose (see `SAME_STATION_DISPLAY_METERS`). The
 * same catalogue row or the same name is the same station; otherwise the
 * straight-line distance decides, and without a position nothing is claimed.
 */
export function transferStation(arrival: StationRef, departure: StationRef): StationVerdict {
  if (arrival.id !== null && departure.id !== null && arrival.id === departure.id) {
    return { kind: "same" };
  }
  if (foldName(arrival.name) !== "" && foldName(arrival.name) === foldName(departure.name)) {
    return { kind: "same" };
  }
  const from = positionOf(arrival);
  const to = positionOf(departure);
  if (from === null || to === null) return { kind: "unconfirmed" };
  const meters = Math.round(distanceKm(from, to) * 1000);
  return meters < SAME_STATION_DISPLAY_METERS ? { kind: "same" } : { kind: "change", meters };
}

const arrivalStation = (leg: RailTransferLeg): StationRef => ({
  id: leg.arrStationId,
  name: leg.arrStationName,
  lat: leg.arrLat,
  lon: leg.arrLon,
});
const departureStation = (leg: RailTransferLeg): StationRef => ({
  id: leg.depStationId,
  name: leg.depStationName,
  lat: leg.depLat,
  lon: leg.depLon,
});

/** The local calendar day of a time known at least to the day, else null. */
function dayOf(value: TimeValue | null): string | null {
  if (!value || (value.precision !== "minute" && value.precision !== "day")) return null;
  return value.local.slice(0, 10);
}

/** Whole calendar days from `a` to `b` (`YYYY-MM-DD`), read as dates — no zone involved. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Minutes from the previous arrival to the next departure, signed; null when not both known to the minute. */
export function signedTransferMinutes(
  previous: RailTransferLeg,
  next: RailTransferLeg
): number | null {
  const arrival = railArrival(previous);
  const departure = railDeparture(next);
  if (!arrival || !departure) return null;
  if (arrival.precision !== "minute" || departure.precision !== "minute") return null;
  const minutes = Math.round((Date.parse(departure.utc) - Date.parse(arrival.utc)) / 60_000);
  return Number.isFinite(minutes) ? minutes : null;
}

/**
 * The verdict for one pair of consecutive legs whose ORDER is known. A wait
 * that cannot be measured is still "another ride" when the two days are known
 * and lie more than a day apart — no change of trains waits that long.
 */
export function railTransfer(previous: RailTransferLeg, next: RailTransferLeg): RailTransfer {
  const station = transferStation(arrivalStation(previous), departureStation(next));
  const minutes = signedTransferMinutes(previous, next);
  if (minutes === null) {
    const from = dayOf(railArrival(previous)) ?? dayOf(railDeparture(previous));
    const to = dayOf(railDeparture(next));
    if (from !== null && to !== null && daysBetween(from, to) > 1) return { kind: "separate" };
    return { kind: "unknown", reason: "time", station };
  }
  if (minutes < 0) return { kind: "conflict", minutes, station };
  if (minutes > SEPARATE_RIDE_AFTER_MINUTES) return { kind: "separate" };
  return {
    kind: "transfer",
    minutes,
    station,
    shortHint: minutes < SHORT_TRANSFER_HINT_MINUTES,
  };
}

const departsToTheMinute = (leg: RailTransferLeg): boolean =>
  railDeparture(leg)?.precision === "minute";

/**
 * Is the order of `legs[i]` and `legs[i + 1]` known? Both departures to the
 * minute, or on different days — and no leg whose departure is NOT to the
 * minute falls on a day the gap spans, because that leg could have run in
 * between: its stored midnight says nothing about when in the day it left.
 */
function gapOrderKnown(legs: readonly RailTransferLeg[], i: number): boolean {
  const previous = legs[i];
  const next = legs[i + 1];
  const from = dayOf(railDeparture(previous));
  const to = dayOf(railDeparture(next));
  if (from === null || to === null) return false;
  const pairKnown = (departsToTheMinute(previous) && departsToTheMinute(next)) || from !== to;
  if (!pairKnown) return false;
  return legs.every((leg, j) => {
    if (j === i || j === i + 1 || departsToTheMinute(leg)) return true;
    const day = dayOf(railDeparture(leg));
    return day !== null && (day < from || day > to);
  });
}

/**
 * The verdict between every two consecutive legs, in the order given (the
 * legs' departure order): entry `i` is the gap after `legs[i]`. A leg that
 * returns to a station this ride already passed starts another ride — the way
 * back is not a change of trains, however soon it leaves. A gap whose order
 * is not known ends the ride as well: nothing before it is "visited" for what
 * comes after.
 */
export function railTransfers(legs: readonly RailTransferLeg[]): RailTransfer[] {
  const verdicts: RailTransfer[] = [];
  let visited: StationRef[] = legs.length > 0 ? [departureStation(legs[0])] : [];
  for (let i = 0; i + 1 < legs.length; i += 1) {
    const previous = legs[i];
    const next = legs[i + 1];
    if (!gapOrderKnown(legs, i)) {
      verdicts.push({ kind: "unknown", reason: "order" });
      visited = [departureStation(next)];
      continue;
    }
    visited = [...visited, arrivalStation(previous)];
    const verdict = railTransfer(previous, next);
    const wayBack = visited.some((station) => sameStation(station, arrivalStation(next)));
    if (verdict.kind === "separate" || (wayBack && verdict.kind !== "conflict")) {
      verdicts.push({ kind: "separate" });
      visited = [departureStation(next)];
    } else {
      verdicts.push(verdict);
    }
  }
  return verdicts;
}
