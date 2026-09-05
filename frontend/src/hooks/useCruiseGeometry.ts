import { useEffect, useRef, useState } from "react";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import type { Cruise } from "../types";

/**
 * Real sea-route geometry for each cruise, indexed by cruise id.
 *
 * Fetched lazily after mount in one batch round-trip; the arcs layer renders
 * a straight chord until an entry lands here, then swaps to the computed
 * route. Any fetch failure is logged via the api client's interceptor and
 * left as a missing entry — the chord fallback keeps the UI working.
 *
 * Only re-runs when the cruise list itself changes: a ref mirrors the state
 * so a successful fetch does not re-trigger the effect, and anything already
 * held is filtered out so nothing is ever fetched twice.
 */
export function useCruiseGeometry(
  cruises: readonly Cruise[]
): Map<string, CruiseRouteFeatureCollection> {
  const [cruiseGeometry, setCruiseGeometry] = useState<Map<string, CruiseRouteFeatureCollection>>(
    () => new Map()
  );
  const cruiseGeometryRef = useRef<Map<string, CruiseRouteFeatureCollection>>(cruiseGeometry);
  useEffect(() => {
    cruiseGeometryRef.current = cruiseGeometry;
  }, [cruiseGeometry]);

  useEffect(() => {
    if (cruises.length === 0) return;
    let cancelled = false;
    // Server returns a {[id]: FeatureCollection} map; merge into local state.
    // The server cache makes repeat calls (mode switches, refilters) cheap.
    const run = async (): Promise<void> => {
      const missingIds = cruises
        .map((c) => c.id)
        .filter((id) => !cruiseGeometryRef.current.has(id));
      if (missingIds.length === 0) return;
      try {
        const batch = await cruiseApi.getGeometryBatch(missingIds);
        if (cancelled) return;
        setCruiseGeometry((prev) => {
          const next = new Map(prev);
          for (const [id, fc] of batch.entries()) {
            if (!next.has(id)) next.set(id, fc);
          }
          return next;
        });
      } catch {
        // Swallow — interceptor handles logging. Chord fallback remains.
      }
    };
    void run();
    return (): void => {
      cancelled = true;
    };
  }, [cruises]);

  return cruiseGeometry;
}
