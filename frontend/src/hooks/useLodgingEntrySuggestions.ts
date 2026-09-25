import { useEffect, useState } from "react";

import {
  EMPTY_LODGING_SUGGESTIONS,
  getLodgingEntrySuggestions,
  type LodgingEntrySuggestions,
} from "../lib/api/lodgingSuggestions";
import { logger } from "../lib/logger";

/**
 * The user's own lodging vocabulary for the lodging and stay forms, asked
 * once per opened form. `lodgingId` (the stay editor's house) adds that
 * house's rooms, categories and board. A failed request offers nothing: every
 * field it feeds stays free text.
 */
export function useLodgingEntrySuggestions(lodgingId?: string): LodgingEntrySuggestions {
  const [suggestions, setSuggestions] =
    useState<LodgingEntrySuggestions>(EMPTY_LODGING_SUGGESTIONS);

  useEffect(() => {
    let active = true;
    getLodgingEntrySuggestions(lodgingId)
      .then((next) => {
        if (active) setSuggestions(next);
      })
      .catch((error: unknown) => {
        logger.warn("Lodging entry suggestions failed", { error });
      });
    return () => {
      active = false;
    };
  }, [lodgingId]);

  return suggestions;
}
