import { useCallback, useEffect, useRef, useState } from "react";
import { searchPlaces, type PlaceSearchResult } from "../../lib/api/geo";
import { logger } from "../../lib/logger";

// Debounce ≥300 ms per the plan's global constraints (mirrors
// EventLocationPicker's 400 ms Nominatim debounce, applied here to Photon).
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_CHARS = 2;

export interface UseLocationSearchResult {
  results: PlaceSearchResult[];
  isSearching: boolean;
  /** true when the last search attempt failed — the caller shows a
   * translated inline message; the raw error only ever reaches the logger. */
  searchError: boolean;
  reset: () => void;
}

/**
 * Debounced Photon search-as-you-type behind `lib/api/geo.ts` (same-origin
 * proxy — never a direct browser fetch to Photon/Nominatim, per the plan's
 * CSP constraint). A failed search degrades to `searchError: true` and an
 * empty result list; it never throws into the caller, so the rest of the
 * form always stays usable (spec §5/§6).
 *
 * Uses a monotonic request-id ref (not `AbortController`) to discard
 * late-arriving responses from a superseded keystroke — the same
 * "cancelled" pattern already used by `ChainPicker`.
 */
export function useLocationSearch(query: string, lang?: string): UseLocationSearchResult {
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const requestIdRef = useRef(0);

  const reset = useCallback((): void => {
    requestIdRef.current += 1; // invalidate any in-flight request
    setResults([]);
    setSearching(false);
    setSearchError(false);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      requestIdRef.current += 1;
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSearching(true);
    setSearchError(false);

    const timer = window.setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const hits = await searchPlaces(trimmed, lang);
          if (requestIdRef.current !== requestId) return; // superseded
          setResults(hits);
          setSearching(false);
        } catch (err) {
          if (requestIdRef.current !== requestId) return;
          logger.error("LocationInput: place search failed", err);
          setResults([]);
          setSearchError(true);
          setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, lang]);

  return { results, isSearching, searchError, reset };
}
