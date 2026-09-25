import { useEffect, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { tagsApi, type TagSuggestion } from "../lib/api/tags";
import { logger } from "../lib/logger";

const SUGGESTION_LIMIT = 8;

/**
 * The user's own tags matching what is typed, most used first. Asked only
 * while the input is focused — every tagged form mounts one, and a closed
 * list needs no answer. An empty query is a real question: focusing the
 * field offers the tags used most.
 *
 * A failed request offers nothing; tags stay free text either way.
 */
export function useTagSuggestions(query: string, enabled: boolean): TagSuggestion[] {
  const q = useDebouncedValue(query.trim(), 250);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    tagsApi
      .search({ q: q || undefined, limit: SUGGESTION_LIMIT })
      .then((next) => {
        if (active) setSuggestions(next);
      })
      .catch((error: unknown) => {
        logger.warn("Tag suggestions failed", { error });
        if (active) setSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [enabled, q]);

  return suggestions;
}
