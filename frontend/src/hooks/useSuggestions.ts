import { useState, useEffect } from "react";
import { suggestionsApi } from "../lib/api/suggestions";

/**
 * Fetches airline and aircraft suggestions once on mount.
 * Returns stable arrays that can be used in datalist options.
 */
export function useSuggestions(): {
  airlines: string[];
  aircraft: string[];
} {
  const [airlines, setAirlines] = useState<string[]>([]);
  const [aircraft, setAircraft] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const [a, ac] = await Promise.all([suggestionsApi.airlines(), suggestionsApi.aircraft()]);
        if (!cancelled) {
          setAirlines(a);
          setAircraft(ac);
        }
      } catch {
        // Non-critical — forms still work with empty suggestions
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { airlines, aircraft };
}
