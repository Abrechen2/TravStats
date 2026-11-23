import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi, type TripCostSuperlative, type TripsListPage } from "../lib/api";
import { logger } from "../lib/logger";
import type { Trip } from "../types";
import TripsTab, { NO_TRIP_FILTERS, type TripsFilters } from "../components/Trips/TripsTab";
import { TripInsightsBar } from "../components/Trips/TripInsightsBar";
import AppShell from "../components/ui/AppShell";
import {
  positiveIntParam,
  stringParam,
  useQueryState,
  type QueryCodec,
} from "../hooks/useQueryState";
import { useScrollRestoreReady } from "../lib/navigation/scrollMemory";

/** Trips per request; "mehr laden" fetches the next page of this size. */
export const TRIPS_PAGE_SIZE = 100;
/** The server's per-request cap (`TRIPS_LIST_CAP`); a restore larger than it reads in chunks. */
const TRIPS_MAX_REQUEST = 500;

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
  // In the URL (2026-11-23): Back from a trip and a reload keep the search
  // and the pills. The values are the server's vocabulary; an unknown one
  // only narrows to nothing, which the empty state then says.
  const [q, setQ] = useQueryState("q", NO_TRIP_FILTERS.q, stringParam);
  const [status, setStatus] = useQueryState<TripsFilters["status"]>(
    "status",
    NO_TRIP_FILTERS.status,
    stringParam as QueryCodec<TripsFilters["status"]>
  );
  const [category, setCategory] = useQueryState<TripsFilters["category"]>(
    "category",
    NO_TRIP_FILTERS.category,
    stringParam as QueryCodec<TripsFilters["category"]>
  );
  const filters = useMemo<TripsFilters>(() => ({ q, status, category }), [q, status, category]);
  // How many trips "mehr laden" had brought in, so Back from a trip reloads
  // that many and the scroll can land on the card the reader left.
  const [shown, setShown] = useQueryState("shown", TRIPS_PAGE_SIZE, positiveIntParam);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const lastFilters = useRef(filters);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [facets, setFacets] = useState<TripsListPage["facets"]>();
  const [listError, setListError] = useState(false);
  const [replacing, setReplacing] = useState(false);
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
    setReplacing(true);
    void (async () => {
      try {
        // New filters start from one page again; the same filters (a mount
        // after Back, a reload) read back everything that was shown.
        const filtersChanged = lastFilters.current !== filters;
        lastFilters.current = filters;
        if (filtersChanged) setShown(TRIPS_PAGE_SIZE);
        const want = filtersChanged ? TRIPS_PAGE_SIZE : Math.max(shownRef.current, TRIPS_PAGE_SIZE);
        const query = {
          q: filters.q,
          status: filters.status === "all" ? undefined : filters.status,
          category: filters.category === "all" ? undefined : filters.category,
        };
        const firstLimit = Math.min(want, TRIPS_MAX_REQUEST);
        let page = await tripsApi.listPage({ ...query, limit: firstLimit, offset: 0 });
        let collected = page.trips;
        // Only a FULL answer means there is more to read for this restore.
        let lastFull = page.trips.length >= firstLimit;
        while (lastFull && collected.length < want && collected.length < page.total) {
          if (id !== requestId.current) return;
          const limit = Math.min(want - collected.length, TRIPS_MAX_REQUEST);
          const next = await tripsApi.listPage({ ...query, limit, offset: collected.length });
          lastFull = next.trips.length >= limit;
          collected = [
            ...collected,
            ...next.trips.filter((n) => !collected.some((c) => c.id === n.id)),
          ];
          page = { ...next, facets: page.facets };
        }
        if (id !== requestId.current) return;
        setTrips(collected);
        setTotal(page.total);
        setFacets(page.facets);
        setListError(false);
        setMoreError(false);
      } catch (err) {
        if (id !== requestId.current) return;
        logger.warn("Failed to load trips", err);
        setListError(true);
      } finally {
        if (id === requestId.current) setReplacing(false);
      }
    })();
  }, [filters, reloadKey, setShown]);

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
      const merged = [...trips, ...page.trips.filter((n) => !trips.some((p) => p.id === n.id))];
      setTrips(merged);
      setShown(merged.length);
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
    (patch: Partial<TripsFilters>) => {
      if (patch.q !== undefined) setQ(patch.q);
      if (patch.status !== undefined) setStatus(patch.status);
      if (patch.category !== undefined) setCategory(patch.category);
    },
    [setQ, setStatus, setCategory]
  );
  useScrollRestoreReady(total !== null || listError);

  const hasMore = total !== null && trips.length < total;

  return (
    <AppShell>
      <TripsTab
        trips={trips}
        filters={filters}
        onFiltersChange={onFiltersChange}
        facets={facets}
        listError={listError}
        loadMore={
          hasMore
            ? { loading: loadingMore || replacing, error: moreError, onLoad: () => void loadMore() }
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
