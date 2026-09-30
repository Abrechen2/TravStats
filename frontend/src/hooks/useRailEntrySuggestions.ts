import { useEffect, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { railApi } from "../lib/api/rail";
import { logger } from "../lib/logger";
import type { RailEntrySuggestions } from "../types/rail";

export const NO_RAIL_SUGGESTIONS: RailEntrySuggestions = {
  trains: [],
  operators: [],
  travelClass: null,
  coaches: [],
  seats: [],
};

/** Long enough that a station typed letter by letter is one request, not ten. */
const DEBOUNCE_MS = 500;

export interface RailSuggestionStation {
  name: string;
  stationId: number | null;
}

export interface RailEntrySuggestionState {
  suggestions: RailEntrySuggestions;
  /**
   * True when the last request failed. The form still works without chips,
   * but it says so — an empty row of chips over a failed request would read
   * as "you have no rides like this" (CLAUDE.md, the four defect classes).
   */
  failed: boolean;
}

/**
 * What the rail form can offer from the user's own rides, refreshed when a
 * station or the operator settles. Chips only ever fill a field on a click.
 */
export function useRailEntrySuggestions(input: {
  departure: RailSuggestionStation;
  arrival: RailSuggestionStation;
  operator: string;
  enabled?: boolean;
}): RailEntrySuggestionState {
  const enabled = input.enabled ?? true;
  const depName = useDebouncedValue(input.departure.name.trim(), DEBOUNCE_MS);
  const arrName = useDebouncedValue(input.arrival.name.trim(), DEBOUNCE_MS);
  const depStationId = input.departure.stationId;
  const arrStationId = input.arrival.stationId;
  const operator = useDebouncedValue(input.operator.trim(), DEBOUNCE_MS);
  const [state, setState] = useState<RailEntrySuggestionState>({
    suggestions: NO_RAIL_SUGGESTIONS,
    failed: false,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    railApi
      .entrySuggestions({
        ...(depStationId !== null ? { depStationId } : {}),
        ...(arrStationId !== null ? { arrStationId } : {}),
        ...(depName ? { depName } : {}),
        ...(arrName ? { arrName } : {}),
        ...(operator ? { operator } : {}),
      })
      .then((suggestions) => {
        if (active) setState({ suggestions, failed: false });
      })
      .catch((error: unknown) => {
        logger.warn("Rail entry suggestions failed", { error });
        if (active) setState({ suggestions: NO_RAIL_SUGGESTIONS, failed: true });
      });
    return () => {
      active = false;
    };
  }, [enabled, depName, arrName, depStationId, arrStationId, operator]);

  return state;
}

/** "ICE 578" — how a chip names a train. */
export function trainLabel(train: { category: string | null; number: string }): string {
  return [train.category, train.number].filter(Boolean).join(" ");
}
