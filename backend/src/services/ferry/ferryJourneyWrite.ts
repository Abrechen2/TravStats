/** Ferry crossings (dennis/TravStats forgejo#293). */
import type { UpdateFerryJourneyInput } from "../../schemas/ferry";
import {
  mergeTerminalRide,
  terminalColumns,
  type TerminalRideState,
} from "../rides/terminalRideWrite";

/**
 * The write rules of a ferry crossing: the terminal-ride rules
 * (`services/rides/terminalRideWrite.ts`), which ferry shares with bus, under
 * the ferry refusal codes.
 */

/** The row as far as these rules read it. */
export type FerryJourneyState = TerminalRideState;

export { terminalColumns };

const FERRY_CODES = {
  invalidInput: "FERRY_INVALID_INPUT",
  arrivalBeforeDeparture: "FERRY_ARRIVAL_BEFORE_DEPARTURE",
} as const;

export function mergeFerryJourney(
  existing: FerryJourneyState | null,
  input: UpdateFerryJourneyInput,
  now: Date = new Date()
): FerryJourneyState {
  return mergeTerminalRide(existing, input, FERRY_CODES, now);
}
