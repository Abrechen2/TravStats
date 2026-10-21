import { useCallback, useEffect, useState } from "react";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { logger } from "../../lib/logger";

const NONE: ReadonlyMap<string, CruiseRouteFeatureCollection> = new Map();

/**
 * The sea-route geometry of a trip's cruises, one batch request. A failed
 * request is `failed` with a `retry`, so the map says it instead of drawing
 * the cruise as if it had no route (beta.22 UAT: it only logged).
 */
export function useTripCruiseGeometry(cruiseIds: readonly string[]): {
  geometry: ReadonlyMap<string, CruiseRouteFeatureCollection>;
  failed: boolean;
  retry: () => void;
} {
  const [geometry, setGeometry] = useState(NONE);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    if (cruiseIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const batch = await cruiseApi.getGeometryBatch([...cruiseIds]);
        if (!cancelled) setGeometry(batch);
      } catch (err) {
        logger.warn("TripMap: cruise geometry fetch failed", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [cruiseIds, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { geometry, failed, retry };
}
