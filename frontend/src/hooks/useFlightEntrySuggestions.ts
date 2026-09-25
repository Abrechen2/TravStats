import { useEffect, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { flightsApi, type FlightEntrySuggestions } from "../lib/api/flights";
import { logger } from "../lib/logger";

export const NO_ENTRY_SUGGESTIONS: FlightEntrySuggestions = {
  seats: [],
  flightNumbers: [],
  frequentFlyerNumber: null,
  departureTerminals: [],
};

/**
 * 500 ms, longer than the 300 ms list search: the airline is typed into a
 * combobox letter by letter, and a request per prefix ("L", "Lu", "Luf" ...)
 * would spend the stats rate-limit bucket this endpoint shares on airlines
 * nobody meant.
 */
const DEBOUNCE_MS = 500;

/**
 * What the flight forms can offer from the user's own logbook, refreshed when
 * the airline or a route end settles. Shared by the create and edit forms so
 * both offer the same things for the same flight.
 *
 * A failed request is not the user's problem: the form works without
 * suggestions, so it keeps offering nothing rather than showing an error.
 */
export function useFlightEntrySuggestions(input: {
  airline?: string;
  dep?: string;
  arr?: string;
  /** False while the form is mounted but closed — nothing to offer to. */
  enabled?: boolean;
}): FlightEntrySuggestions {
  const enabled = input.enabled ?? true;
  const airline = useDebouncedValue(input.airline?.trim() ?? "", DEBOUNCE_MS);
  const dep = useDebouncedValue(input.dep?.trim() ?? "", DEBOUNCE_MS);
  const arr = useDebouncedValue(input.arr?.trim() ?? "", DEBOUNCE_MS);
  const [suggestions, setSuggestions] = useState<FlightEntrySuggestions>(NO_ENTRY_SUGGESTIONS);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    flightsApi
      .getEntrySuggestions({
        airline: airline || undefined,
        dep: dep || undefined,
        arr: arr || undefined,
      })
      .then((next) => {
        if (active) setSuggestions(next);
      })
      .catch((error: unknown) => {
        logger.warn("Flight entry suggestions failed", { error });
        if (active) setSuggestions(NO_ENTRY_SUGGESTIONS);
      });
    return () => {
      active = false;
    };
  }, [enabled, airline, dep, arr]);

  return suggestions;
}
