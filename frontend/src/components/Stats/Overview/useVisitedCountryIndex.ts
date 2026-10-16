import { useEffect, useState } from "react";
import { statsApi } from "../../../lib/api/stats";
import { logger } from "../../../lib/logger";
import {
  visitedSourcesOfRows,
  type VisitedCountrySource,
} from "../../../shared/crossDomainCounting";

/**
 * The passport's visited-country index (forgejo#299), for the overview's
 * "Länder besucht" tile: which domain proves a visit to which country, in
 * which years. Null while loading or after a failure — the tile then shows a
 * dash instead of the countries a record merely touched.
 */
export function useVisitedCountryIndex(): VisitedCountrySource[] | null {
  const [index, setIndex] = useState<VisitedCountrySource[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const passport = await statsApi.getPassport();
        if (!cancelled) setIndex(visitedSourcesOfRows(passport.countries));
      } catch (err) {
        logger.error("useVisitedCountryIndex: passport fetch failed", err);
        if (!cancelled) setIndex(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return index;
}
