import { useState, useEffect } from "react";
import { suggestionsApi } from "../lib/api/suggestions";

const AIRLINE_SEARCH_DEBOUNCE_MS = 300;

/**
 * Fetches aircraft suggestions once on mount, and airline suggestions
 * debounced against `airlineQuery`. `/suggestions/airlines` is DB-backed
 * and `q`-searchable (merges the full airline catalogue with the user's
 * own flown airlines) but still caps its response at 50 rows, so a static
 * unfiltered fetch only ever surfaces the first 50 alphabetically — passing
 * the live query keeps the results relevant as the catalogue grows past
 * that cap. Leaving `airlineQuery` empty reproduces the old unfiltered
 * (first-50) behavior, so existing callers that don't pass it are unaffected.
 * Returns stable arrays that can be used in datalist options.
 */
export function useSuggestions(airlineQuery = ""): {
  airlines: string[];
  aircraft: string[];
} {
  const [airlines, setAirlines] = useState<string[]>([]);
  const [aircraft, setAircraft] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const ac = await suggestionsApi.aircraft();
        if (!cancelled) setAircraft(ac);
      } catch {
        // Non-critical — forms still work with empty suggestions
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const a = await suggestionsApi.airlines(airlineQuery);
          if (!cancelled) setAirlines(a);
        } catch {
          // Non-critical — forms still work with empty suggestions
        }
      })();
    }, AIRLINE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [airlineQuery]);

  return { airlines, aircraft };
}
