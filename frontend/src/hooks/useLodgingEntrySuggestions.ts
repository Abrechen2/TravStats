import { useEffect, useState } from "react";

import {
  EMPTY_LODGING_SUGGESTIONS,
  getLodgingEntrySuggestions,
  type LodgingEntrySuggestions,
} from "../lib/api/lodgingSuggestions";
import { logger } from "../lib/logger";

/**
 * The user's own lodging vocabulary for the lodging and stay forms, asked
 * once per opened form. A failed request offers nothing: every field it
 * feeds stays free text.
 */
export function useLodgingEntrySuggestions(): LodgingEntrySuggestions {
  const [suggestions, setSuggestions] =
    useState<LodgingEntrySuggestions>(EMPTY_LODGING_SUGGESTIONS);

  useEffect(() => {
    let active = true;
    getLodgingEntrySuggestions()
      .then((next) => {
        if (active) setSuggestions(next);
      })
      .catch((error: unknown) => {
        logger.warn("Lodging entry suggestions failed", { error });
      });
    return () => {
      active = false;
    };
  }, []);

  return suggestions;
}
