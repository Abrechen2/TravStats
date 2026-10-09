import { useEffect, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { busApi } from "../lib/api/bus";
import { logger } from "../lib/logger";
import { NO_BUS_SUGGESTIONS, type BusEntrySuggestions } from "../types/bus";

/**
 * Long enough that a terminal typed letter by letter is one request, not ten —
 * the endpoint's limiter assumes it is asked when a terminal or the operator
 * settles, not per keystroke.
 */
const DEBOUNCE_MS = 500;

export interface BusEntrySuggestionState {
  suggestions: BusEntrySuggestions;
  /**
   * True when the last request failed. The form still works without chips,
   * but it says so — an empty row of chips over a failed request would read
   * as "you have no rides like this" (CLAUDE.md, the four defect classes).
   */
  failed: boolean;
}

/**
 * What the bus form can offer from the user's own rides, refreshed when a
 * terminal name or the operator settles. A typed name is searched in BOTH
 * terminal columns by the server, so `terminals` is one merged list — the ride
 * home is offered the outbound arrival. Chips only ever fill a field on a click.
 */
export function useBusEntrySuggestions(input: {
  departureName: string;
  arrivalName: string;
  operator: string;
  enabled?: boolean;
}): BusEntrySuggestionState {
  const enabled = input.enabled ?? true;
  const depName = useDebouncedValue(input.departureName.trim(), DEBOUNCE_MS);
  const arrName = useDebouncedValue(input.arrivalName.trim(), DEBOUNCE_MS);
  const operator = useDebouncedValue(input.operator.trim(), DEBOUNCE_MS);
  const [state, setState] = useState<BusEntrySuggestionState>({
    suggestions: NO_BUS_SUGGESTIONS,
    failed: false,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    busApi
      .entrySuggestions({
        ...(depName ? { depName } : {}),
        ...(arrName ? { arrName } : {}),
        ...(operator ? { operator } : {}),
      })
      .then((suggestions) => {
        if (active) setState({ suggestions, failed: false });
      })
      .catch((error: unknown) => {
        logger.warn("Bus entry suggestions failed", { error });
        if (active) setState({ suggestions: NO_BUS_SUGGESTIONS, failed: true });
      });
    return () => {
      active = false;
    };
  }, [enabled, depName, arrName, operator]);

  return state;
}
