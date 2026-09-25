import { useCallback, useEffect, useState } from "react";
import { railApi } from "../lib/api/rail";
import { logger } from "../lib/logger";
import type { RailJourney } from "../types/rail";

/** The logbook's own page bound; the map reads pages until it has them all. */
const PAGE = 500;
/** A ceiling, not a page: past it the map says it is showing a part. */
const MAX_JOURNEYS = 5_000;

export interface UseDashboardRailResult {
  journeys: RailJourney[];
  loading: boolean;
  /** A failed load — never shown as "no journeys". */
  loadError: boolean;
  reload: () => void;
}

/**
 * Every rail journey the map draws (spec 2026-09-25-rail-domain, phase 2b),
 * optionally for one calendar year.
 *
 * `enabled` gates the FETCH, not just the render — the contract every other
 * dashboard data hook keeps: a domain behind the beta switch, or switched off
 * by the user, never reaches the network for it.
 */
export function useDashboardRail(enabled: boolean, year: number | null): UseDashboardRailResult {
  const [journeys, setJourneys] = useState<RailJourney[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState(false);
  const [token, setToken] = useState(0);
  const reload = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setJourneys([]);
      setLoading(false);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const all: RailJourney[] = [];
        for (let offset = 0; offset < MAX_JOURNEYS; offset += PAGE) {
          const page = await railApi.list({ limit: PAGE, offset, year: year ?? undefined });
          all.push(...page.journeys);
          if (all.length >= page.total || page.journeys.length === 0) break;
        }
        if (!cancelled) setJourneys(all);
      } catch (err: unknown) {
        logger.error("useDashboardRail: failed to load rail journeys", err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, year, token]);

  return { journeys, loading, loadError, reload };
}
