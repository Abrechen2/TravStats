import { railArrival, railDeparture, type RailLike } from "../entityTimes";
import type { RailJourney } from "../../types/rail";

/**
 * What lies between two consecutive legs of a booking (forgejo#234): the
 * wait, a departure before the previous arrival, a walk to another station —
 * or nothing that can be said. ONE home for that verdict; the connection
 * view, the detail page and the whole-ride page all read it from here.
 *
 * Abstention is a result. A wait is measured only between two instants known
 * to the minute (`TimeValue.utc`, so a change across zones or inside the
 * repeated autumn hour measures what really passes); a day-only or missing end
 * makes it `unknown` — never 0, and never "reachable". Nothing here claims a
 * change WORKS: `shortHint` is a hint that the gap is under ten minutes, worded
 * as one, and the user's own "tight" mark lives on the arriving leg
 * (`tightConnection`), not here.
 */

export type RailTransferLeg = RailLike &
  Pick<RailJourney, "depStationName" | "arrStationName" | "depStationId" | "arrStationId">;

export type RailTransfer =
  /** Either end is not known to the minute, or missing. */
  | { kind: "unknown"; stationChange: boolean }
  /** The next train leaves before the previous one arrives; `minutes` is negative. */
  | { kind: "conflict"; minutes: number; stationChange: boolean }
  | { kind: "transfer"; minutes: number; stationChange: boolean; shortHint: boolean }
  /**
   * Not a change of trains: the next leg leaves later than a change is read
   * as, or goes back to a station the ride already passed (the way home on
   * the same booking). Nothing about a wait is claimed.
   */
  | { kind: "separate" };

/** Under this many minutes, the view adds the "short transfer" hint. */
export const SHORT_TRANSFER_HINT_MINUTES = 10;

/**
 * The longest wait still read as a change — the same four hours the server
 * groups a ride by (`MAX_TRANSFER_MINUTES` in the backend's
 * `shared/railJourneyGrouping.ts`; change both together). Past it, a booking's
 * next leg is another ride, not a 3-day "transfer".
 */
export const SEPARATE_RIDE_AFTER_MINUTES = 240;

interface StationRef {
  id: number | null;
  name: string;
}

/** Lower case, accents folded, punctuation to single spaces — "Köln Hbf." = "koln hbf". */
export function normalizeStationName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The same station: by catalogue id when both ends have one, else by name.
 * Two catalogue rows are two stations even when their names look alike, and a
 * geocoder pick has no id to compare.
 */
export function sameStation(a: StationRef, b: StationRef): boolean {
  if (a.id !== null && b.id !== null) return a.id === b.id;
  const left = normalizeStationName(a.name);
  return left !== "" && left === normalizeStationName(b.name);
}

const arrivalStation = (leg: RailTransferLeg): StationRef => ({
  id: leg.arrStationId,
  name: leg.arrStationName,
});
const departureStation = (leg: RailTransferLeg): StationRef => ({
  id: leg.depStationId,
  name: leg.depStationName,
});

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

/** The verdict for one pair of consecutive legs, read alone. */
export function railTransfer(previous: RailTransferLeg, next: RailTransferLeg): RailTransfer {
  const stationChange = !sameStation(arrivalStation(previous), departureStation(next));
  const minutes = signedTransferMinutes(previous, next);
  if (minutes === null) return { kind: "unknown", stationChange };
  if (minutes < 0) return { kind: "conflict", minutes, stationChange };
  if (minutes > SEPARATE_RIDE_AFTER_MINUTES) return { kind: "separate" };
  return {
    kind: "transfer",
    minutes,
    stationChange,
    shortHint: minutes < SHORT_TRANSFER_HINT_MINUTES,
  };
}

/**
 * The verdict between every two consecutive legs, in the order given (the
 * legs' departure order): entry `i` is the gap after `legs[i]`. A leg that
 * returns to a station this ride already passed starts another ride — the way
 * back is not a change of trains, however soon it leaves.
 */
export function railTransfers(legs: readonly RailTransferLeg[]): RailTransfer[] {
  const verdicts: RailTransfer[] = [];
  let visited: StationRef[] = legs.length > 0 ? [departureStation(legs[0])] : [];
  for (let i = 0; i + 1 < legs.length; i += 1) {
    const previous = legs[i];
    const next = legs[i + 1];
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
