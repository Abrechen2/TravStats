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

import { useCallback, useEffect, useState } from "react";

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

/**
 * The sections, in the three states a shared load has.
 *
 * `undefined` — the one request is still in flight.
 * `null`      — it finished and brought nothing, because it FAILED. A section
 *               renders its empty state; the page says why, once.
 * a value     — the section.
 *
 * The middle state is the whole point and was missing at first: nine sections
 * share one request, so a single 500 left all nine absent — which a card could
 * not tell apart from "still loading", and nine cards said "loading" forever.
 * The hook decides this, not the page, because the hook is what knows the
 * request failed.
 */
export type StatsPageSectionValues = Partial<{
  [K in FlightTabSection]: StatsPageSections[K] | null;
}>;

export interface UseStatsPageSectionsResult {
  sections: StatsPageSectionValues;
  loading: boolean;
  /** The message, when the single request failed. */
  error: string | null;
  /**
   * Try the one request again.
   *
   * Exposed because ONE failure now costs nine sections: without a retry the
   * only way back is a full page reload, which throws away the flight list,
   * the summary and the timeseries that all succeeded.
   */
  reload: () => void;
}

export function useStatsPageSections(): UseStatsPageSectionsResult {
  const [sections, setSections] = useState<StatsPageSectionValues>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `reload`, which is what re-runs the effect. A counter rather than
  // a function called directly, so the effect keeps its own cancellation and a
  // retry fired twice cannot land two answers out of order.
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await statsApi.getStatsPage(FLIGHT_TAB_SECTIONS);
        if (!cancelled) setSections(data);
      } catch (err) {
        logger.error("Failed to load the composed statistics sections", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          // Every requested section becomes `null`, not absent. Absent reads as
          // "still loading" to a section, which is how a failed load showed
          // nine cards spinning with no explanation anywhere.
          setSections(
            Object.fromEntries(FLIGHT_TAB_SECTIONS.map((s) => [s, null])) as StatsPageSectionValues
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { sections, loading, error, reload };
}
