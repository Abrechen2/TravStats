import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi, type TripCostSuperlative, type TripsListPage } from "../lib/api";
import { logger } from "../lib/logger";
import type { Trip } from "../types";
import TripsTab, { NO_TRIP_FILTERS, type TripsFilters } from "../components/Trips/TripsTab";
import { TripInsightsBar } from "../components/Trips/TripInsightsBar";
import AppShell from "../components/ui/AppShell";

/** Trips per request; "mehr laden" fetches the next page of this size. */
export const TRIPS_PAGE_SIZE = 100;

/**
 * Top-level Trips page (Phase-1 redesign). Was previously embedded as a
 * sub-tab in `FlightsTablePage`; now it owns its own URL (`/trips`) so a
 * trip is a first-class destination, not a flight-side label.
 *
 * The list, its header actions and filters live in `TripsTab`. The search and
 * the pills are applied by the SERVER and the list is paged: filtering the
 * first 500 rows here meant a trip beyond them could never be found.
 */
export default function TripsPage(): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const [filters, setFilters] = useState<TripsFilters>(NO_TRIP_FILTERS);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [facets, setFacets] = useState<TripsListPage["facets"]>();
  const [listError, setListError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // The insights strip is the logbook's standouts, not the filtered list's.
  const [insightTrips, setInsightTrips] = useState<Trip[]>([]);
  const [mostExpensiveTrip, setMostExpensiveTrip] = useState<TripCostSuperlative | null>(null);
  // A response for a superseded filter must not overwrite the current one.
  const requestId = useRef(0);

  // `getAllWithInsights`, not `getAll` — this is the ONE screen that shows
  // the cross-trip cost superlative, and it must come from the backend's
  // uncapped ranking (evidence spec "The most expensive trip"), never
  // recomputed from this page's own (capped) `trips` array.
  useEffect(() => {
    void (async () => {
      try {
        const data = await tripsApi.getAllWithInsights();
        setInsightTrips(data.trips);
        setMostExpensiveTrip(data.mostExpensiveTrip);
      } catch (err) {
        logger.warn("Failed to load trip insights", err);
      }
    })();
  }, [reloadKey]);

  useEffect(() => {
    const id = ++requestId.current;
    void (async () => {
      try {
        const page = await tripsApi.listPage({
          q: filters.q,
          status: filters.status === "all" ? undefined : filters.status,
          category: filters.category === "all" ? undefined : filters.category,
          limit: TRIPS_PAGE_SIZE,
          offset: 0,
        });
        if (id !== requestId.current) return;
        setTrips(page.trips);
        setTotal(page.total);
        setFacets(page.facets);
        setListError(false);
        setMoreError(false);
      } catch (err) {
        if (id !== requestId.current) return;
        logger.warn("Failed to load trips", err);
        setListError(true);
      }
    })();
  }, [filters, reloadKey]);

  const loadMore = async (): Promise<void> => {
    const id = ++requestId.current;
    setLoadingMore(true);
    try {
      const page = await tripsApi.listPage({
        q: filters.q,
        status: filters.status === "all" ? undefined : filters.status,
        category: filters.category === "all" ? undefined : filters.category,
        limit: TRIPS_PAGE_SIZE,
        offset: trips.length,
      });
      if (id !== requestId.current) return;
      setTrips((prev) => [...prev, ...page.trips.filter((n) => !prev.some((p) => p.id === n.id))]);
      setTotal(page.total);
      setMoreError(false);
    } catch (err) {
      if (id !== requestId.current) return;
      logger.warn("Failed to load more trips", err);
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const onFiltersChange = useCallback(
    (patch: Partial<TripsFilters>) => setFilters((prev) => ({ ...prev, ...patch })),
    []
  );

  const hasMore = total !== null && trips.length < total;

  return (
    <AppShell width="list">
      <TripsTab
        trips={trips}
        filters={filters}
        onFiltersChange={onFiltersChange}
        facets={facets}
        listError={listError}
        loadMore={
          hasMore
            ? { loading: loadingMore, error: moreError, onLoad: () => void loadMore() }
            : undefined
        }
        onTripsChange={() => setReloadKey((k) => k + 1)}
        header={{ title: t("trips:tab"), meta: t("trips:count", { count: total ?? trips.length }) }}
        insights={
          <>
            {hasMore && total !== null && (
              <p role="status" className="t-caption mb-3" data-testid="trips-truncated">
                {t("trips:listTruncated", { shown: trips.length, total })}
              </p>
            )}
            <TripInsightsBar trips={insightTrips} mostExpensiveTrip={mostExpensiveTrip} />
          </>
        }
      />
    </AppShell>
  );
}
