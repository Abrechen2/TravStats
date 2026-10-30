import { useEffect, useState } from "react";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { logger } from "../lib/logger";

/**
 * One cruise's route geometry for the route map, with the failure kept.
 *
 * A failed read used to be a log line only, and the map then drew straight
 * chords between the ports as if they were the ship's route. `failed` lets the
 * map say the real route could not be loaded (forgejo#385).
 */
export function useCruiseRouteGeometry(cruiseId: string): {
  geometry: CruiseRouteFeatureCollection | null;
  setGeometry: (fc: CruiseRouteFeatureCollection | null) => void;
  failed: boolean;
} {
  const [geometry, setGeometry] = useState<CruiseRouteFeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void (async () => {
      try {
        const fc = await cruiseApi.getGeometry(cruiseId);
        if (!cancelled) setGeometry(fc);
      } catch (err) {
        logger.warn("CruiseRouteMap: failed to load geometry", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [cruiseId]);

  return { geometry, setGeometry, failed };
}
