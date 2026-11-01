import { useEffect, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import { logger } from "../lib/logger";

/** Long enough that a field typed letter by letter is one request, not ten. */
const DEBOUNCE_MS = 500;

export interface EntrySuggestionState<T> {
  suggestions: T;
  /**
   * True when the last request failed. The form still works without chips, but
   * says so — an empty row of chips over a failed request would read as "you
   * have nothing like this" (CLAUDE.md, the four defect classes).
   */
  failed: boolean;
}

/**
 * What a form can offer from the user's own earlier rows (forgejo#405),
 * refreshed when the fields that narrow it settle. `query` holds only the
 * non-blank typed values; the server returns the whole vocabulary for an empty
 * one. Chips only ever fill a field on a click.
 */
export function useEntrySuggestions<T>(
  load: (query: Record<string, string>) => Promise<T>,
  query: Record<string, string>,
  empty: T,
  enabled = true
): EntrySuggestionState<T> {
  const key = useDebouncedValue(
    JSON.stringify(Object.fromEntries(Object.entries(query).filter(([, v]) => v.trim() !== ""))),
    DEBOUNCE_MS
  );
  const [state, setState] = useState<EntrySuggestionState<T>>({
    suggestions: empty,
    failed: false,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    load(JSON.parse(key) as Record<string, string>)
      .then((suggestions) => {
        if (active) setState({ suggestions, failed: false });
      })
      .catch((error: unknown) => {
        logger.warn("Entry suggestions failed", { error });
        if (active) setState({ suggestions: empty, failed: true });
      });
    return () => {
      active = false;
    };
    // `load` and `empty` are module-level; the request follows the settled query.
  }, [enabled, key]);

  return state;
}
