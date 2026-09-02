import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tourIndexApi, type TourGeometryEntry, type TourSummary } from "../lib/api/tourIndex";
import { logger } from "../lib/logger";

export interface UseDashboardToursResult {
  tours: TourSummary[];
  /** Initial list fetch, or the geometry batch that follows it, in flight.
   *  Mutually exclusive with `toursLoadError`. */
  toursLoading: boolean;
  /** The list or geometry fetch failed — distinct from `tours.length === 0`.
   *  A legend that goes quiet after a failed request reads exactly like
   *  "you have no tours", the shipped defect this feature's own briefs
   *  already name; callers must render this differently from a genuine
   *  empty answer. */
  toursLoadError: boolean;
  /** One entry per tour whose geometry has resolved, ready for
   *  `buildTourPaths` (`components/layers/tourPathsLayer.ts`) verbatim. */
  geometries: TourGeometryEntry[];
  /** Re-runs the fetch from scratch — wired to a retry affordance. */
  reload: () => void;
}

/**
 * Dashboard-wide tour sections for the map: every section the caller owns
 * (`GET /tours`) plus geometry for all of them in one batch call
 * (`POST /tours/geometry/batch`, chunked past 100 ids inside
 * `tourIndexApi.geometryBatch`) — never one geometry request per section,
 * the N+1 that endpoint exists to prevent.
 *
 * `enabled` gates the fetch itself, not just the render — the same
 * domain-gating contract every other AllTab data effect follows for
 * flights/cruises/lodgings/places: a caller that cannot show the result must
 * never hit the network for it. Both callers pass `true` today; the argument
 * existed for the `tourRoutes` beta gate, which the owner released on
 * 2026-09-01, and is kept because the contract is the hook's, not that gate's.
 */
export function useDashboardTours(enabled: boolean): UseDashboardToursResult {
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [toursLoading, setToursLoading] = useState(true);
  const [toursLoadError, setToursLoadError] = useState(false);
  const [geometryById, setGeometryById] = useState<ReadonlyMap<string, TourGeometryEntry>>(
    new Map()
  );
  const [reloadToken, setReloadToken] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setTours([]);
      setGeometryById(new Map());
      setToursLoading(false);
      setToursLoadError(false);
      return;
    }

    let cancelled = false;
    setToursLoading(true);
    setToursLoadError(false);

    void (async (): Promise<void> => {
      try {
        const list = await tourIndexApi.list();
        if (cancelled || !mountedRef.current) return;
        setTours(list);

        if (list.length === 0) {
          setGeometryById(new Map());
          return;
        }

        const geometry = await tourIndexApi.geometryBatch(list.map((tour) => tour.id));
        if (cancelled || !mountedRef.current) return;

        const byId = new Map<string, TourGeometryEntry>();
        for (const tour of list) {
          const g = geometry.get(tour.id);
          if (g) byId.set(tour.id, { routeId: tour.id, name: tour.name, geometry: g });
        }
        setGeometryById(byId);
      } catch (err: unknown) {
        if (cancelled || !mountedRef.current) return;
        logger.warn("useDashboardTours: failed to load tours", err);
        setTours([]);
        setGeometryById(new Map());
        setToursLoadError(true);
      } finally {
        if (!cancelled && mountedRef.current) setToursLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  // Memoized on `geometryById` alone — without this, `Array.from(...)`
  // allocated a new array identity on every render regardless of whether
  // the map itself changed, which silently defeated the `tourPathData`
  // `useMemo` in AllTab.tsx that depends on this array: it recomputed on
  // every render too, since its dependency was never actually stable.
  const geometries = useMemo(() => Array.from(geometryById.values()), [geometryById]);

  return { tours, toursLoading, toursLoadError, geometries, reload };
}
