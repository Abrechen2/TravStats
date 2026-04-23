import { useEffect, useMemo, useState } from "react";
import { flightsApi } from "../lib/api/flights";
import { logger } from "../lib/logger";
import type { Flight } from "../types";

/**
 * Loads all flights once and exposes a lookup by id. Dashboard tabs use it
 * alongside the GeoJSON endpoint (which only carries a subset of fields)
 * to resolve route-click events — which hand back flight ids — into full
 * Flight objects that `flightSelectionStore.setSelection` expects.
 *
 * Pagination is ignored: the active user's full history is small enough
 * to ship in one round-trip. If that changes we switch to incremental
 * loading here without touching the callers.
 */
export function useFlightLookup(): {
  flights: Flight[];
  lookup: (id: string) => Flight | undefined;
  lookupMany: (ids: string[]) => Flight[];
  loading: boolean;
} {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    flightsApi
      .getAll({ limit: 5000, offset: 0 })
      .then((data) => {
        if (!cancelled) setFlights(data.flights);
      })
      .catch((err: unknown) => {
        logger.error("useFlightLookup: failed to load flights", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, Flight>();
    for (const f of flights) map.set(f.id, f);
    return map;
  }, [flights]);

  const lookup = (id: string): Flight | undefined => byId.get(id);
  const lookupMany = (ids: string[]): Flight[] =>
    ids.map((id) => byId.get(id)).filter((f): f is Flight => f !== undefined);

  return { flights, lookup, lookupMany, loading };
}
