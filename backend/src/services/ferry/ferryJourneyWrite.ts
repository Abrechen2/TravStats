import type { UpdateFerryJourneyInput } from "../../schemas/ferry";
/** Ferry crossings (dennis/TravStats forgejo#293). */
import {
  mergeTerminalRide,
  terminalColumns,
  type TerminalRideInput,
  type TerminalRideState,
} from "../rides/terminalRideWrite";
import { polylineLengthKm } from "../../shared/geo/haversine";
import { readSeaGeometry, sameFerryEnds } from "./ferryGeometry";

/**
 * The write rules of a ferry crossing: the terminal-ride rules
 * (`services/rides/terminalRideWrite.ts`), which ferry shares with bus, under
 * the ferry refusal codes — plus the one ferry-only rule: a stored sea route
 * keeps its length while the terminals stay where they were.
 */

/** The row as far as these rules read it. */
export type FerryJourneyState = TerminalRideState & {
  geometry?: unknown;
  geometrySource?: string;
};

export { terminalColumns };

const FERRY_CODES = {
  invalidInput: "FERRY_INVALID_INPUT",
  arrivalBeforeDeparture: "FERRY_ARRIVAL_BEFORE_DEPARTURE",
} as const;

export function mergeFerryJourney(
  existing: FerryJourneyState | null,
  /** A UpdateFerryJourneyInput, or the importer's narrower terminal-ride input. */
  input: UpdateFerryJourneyInput | TerminalRideInput,
  now: Date = new Date()
): TerminalRideState {
  const merged = mergeTerminalRide(existing, input, FERRY_CODES, now);
  // A re-derived chord would silently shorten a crossing that was routed over
  // water; a distance the user typed still wins.
  const seaLine =
    existing?.geometrySource === "sea_route" && sameFerryEnds(existing, merged)
      ? readSeaGeometry(existing.geometry)
      : null;
  if (!seaLine || merged.distanceSource === "user") return merged;
  const km = polylineLengthKm(seaLine.map(([lon, lat]) => ({ lat, lon })));
  return { ...merged, distanceKm: Math.round(km * 10) / 10, distanceSource: "sea_route" };
}
