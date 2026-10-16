import {
  mergeTerminalRide,
  terminalColumns,
  type TerminalRideInput,
  type TerminalRideState,
} from "../rides/terminalRideWrite";

/**
 * The write rules of a bus ride (spec 2026-10-07-bus-domain-design §3, §4):
 * the terminal-ride rules (`services/rides/terminalRideWrite.ts`), which bus
 * shares with ferry, under the bus refusal codes.
 */

/** The row as far as these rules read it. */
export type BusJourneyState = TerminalRideState;

export { terminalColumns };

const BUS_CODES = {
  invalidInput: "BUS_INVALID_INPUT",
  arrivalBeforeDeparture: "BUS_ARRIVAL_BEFORE_DEPARTURE",
} as const;

/**
 * Merge an update (or a create, with `existing = null`) into the final row
 * state — see `mergeTerminalRide`.
 */
export function mergeBusJourney(
  existing: BusJourneyState | null,
  /** A UpdateBusJourneyInput, or the importer's narrower terminal-ride input. */
  input: TerminalRideInput,
  now: Date = new Date()
): BusJourneyState {
  return mergeTerminalRide(existing, input, BUS_CODES, now);
}
