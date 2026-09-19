/**
 * The statistics page's flight sections, in ONE request (forgejo#49).
 *
 * Measured before this existed: the flight tab issued twelve `/stats/*`
 * requests for a single load, and the server answered them with fifteen passes
 * over the flight table — thirteen over the identical population. Nine of the
 * twelve share one load, so they are one request now, and the backend answers
 * it with one scan (`backend/src/routes/__tests__/statsPage.scanCount.test.ts`
 * asserts the number rather than the intention).
 *
 * Two of the nine were the SAME request twice: `CountryDistributionCard` and
 * `useDomainStats` each fetched `/stats/countries` on the flight tab.
 *
 * Failure is per-hook, not per-section: the sections share one load, so a 500
 * loses all nine rather than eight. That is a real trade against the old
 * per-request `.catch(() => null)`, and it is the right one here — nine
 * separate failures of the same query were nine chances to draw a page that
 * was partly wrong without saying so. `error` lets the page say it once.
 */

import { useEffect, useState } from "react";

import { statsApi, type StatsPageSection, type StatsPageSections } from "../api/stats";
import { logger } from "../logger";

/** Every section the flight tab draws. Its own sections gate the RENDERING. */
export const FLIGHT_TAB_SECTIONS = [
  "fun",
  "business",
  "unique",
  "airports",
  "seats",
  "countries",
  "airlines",
  "aircraft",
  "punctuality",
] as const satisfies readonly StatsPageSection[];

export type FlightTabSection = (typeof FLIGHT_TAB_SECTIONS)[number];

export interface UseStatsPageSectionsResult {
  /**
   * Each section, or `undefined` until the one request lands. Deliberately not
   * `null`: a section reads `undefined` as "not loaded yet" and `null` would
   * have to mean the same thing in a second way.
   */
  sections: Partial<Pick<StatsPageSections, FlightTabSection>>;
  loading: boolean;
  /** The message, when the single request failed. */
  error: string | null;
}

export function useStatsPageSections(): UseStatsPageSectionsResult {
  const [sections, setSections] = useState<Partial<Pick<StatsPageSections, FlightTabSection>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await statsApi.getStatsPage(FLIGHT_TAB_SECTIONS);
        if (!cancelled) setSections(data);
      } catch (err) {
        logger.error("Failed to load the composed statistics sections", err);
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { sections, loading, error };
}
