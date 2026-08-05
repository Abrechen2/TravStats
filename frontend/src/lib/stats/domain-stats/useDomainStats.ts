// Hook: orchestrates per-domain stat fetches with failure isolation.
//
// Each domain runs in its own try/catch so a single 500 (e.g. cruise
// endpoint down) doesn't blank the entire overview — the failing
// domain's slot stays empty, the rest renders. Hotel + POI are handled
// by stub adapters today; promoting them to real domains only requires
// flipping `available=true` in shared/domains.ts and replacing the stub
// with a real adapter call here.
import { useEffect, useState } from "react";
import type { Flight } from "../../../types";
import { statsApi } from "../../api";
import { cruiseApi } from "../../api/cruise";
import { logger } from "../../logger";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import type { DomainKey } from "../../../shared/domains";
import { adaptFlight } from "./flightStatsAdapter";
import { adaptCruise } from "./cruiseStatsAdapter";
import { adaptHotel } from "./hotelStatsAdapter";
import { adaptPoi } from "./poiStatsAdapter";
import type { DomainStats, DomainStatsMap } from "./types";
import { toYearKeyed } from "./yearKeyed";

export interface UseDomainStatsResult {
  stats: DomainStatsMap;
  errors: Partial<Record<DomainKey, string>>;
  loading: boolean;
}

/**
 * Loads all enabled domains' stats in parallel. Flight data is supplied
 * by the caller (already loaded by AdvancedStatsPage) to avoid a second
 * round-trip; the country list is fetched here.
 */
export function useDomainStats(input: { flights: Flight[] }): UseDomainStatsResult {
  const { flights } = input;
  // Domain-gating: only the user's enabled domains are fetched — a
  // disabled domain must not surface in the cross-domain overview, so
  // its stats are never loaded in the first place.
  const { enabled } = useEnabledDomains();
  const [stats, setStats] = useState<DomainStatsMap>({});
  const [errors, setErrors] = useState<Partial<Record<DomainKey, string>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result: DomainStatsMap = {};
      const errs: Partial<Record<DomainKey, string>> = {};

      const tasks = enabled.map(async (domain) => {
        try {
          const value = await loadDomain(domain, flights);
          result[domain] = value;
        } catch (err) {
          logger.warn(`Failed to load ${domain} domain stats:`, err);
          errs[domain] = err instanceof Error ? err.message : "Unknown error";
        }
      });

      await Promise.all(tasks);
      if (cancelled) return;
      setStats(result);
      setErrors(errs);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [flights, enabled]);

  return { stats, errors, loading };
}

async function loadDomain(domain: DomainKey, flights: Flight[]): Promise<DomainStats> {
  switch (domain) {
    case "flight": {
      const countryResp = await statsApi.getCountryStats();
      return adaptFlight({
        flights,
        // ISO codes when the backend offers them — see the note in
        // cruiseStatsAdapter on why the counting field is not the display one.
        countries: countryResp.countriesIso ?? countryResp.countries.map((c) => c.country),
        countriesByYear: toYearKeyed(countryResp.byYear),
      });
    }
    case "cruise": {
      const [cruiseStats, cruises] = await Promise.all([
        statsApi.getCruiseStats(),
        cruiseApi.list({}),
      ]);
      return adaptCruise({ stats: cruiseStats, cruises });
    }
    case "hotel":
      return adaptHotel();
    case "poi":
      return adaptPoi();
  }
}
