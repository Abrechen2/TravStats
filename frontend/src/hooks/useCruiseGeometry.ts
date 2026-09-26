import { useEffect, useRef, useState } from "react";
import { CRUISE_GEOMETRY } from "../config/constants";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { Cruise } from "../types";
import { useTranslation } from "./useTranslation";

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Real sea-route geometry for each cruise, indexed by cruise id.
 *
 * Fetched lazily after mount in batches of at most the server's cap (100);
 * the arcs layer renders a straight chord until an entry lands here, then
 * swaps to the computed route. A failed batch leaves its cruises as missing
 * entries — the chord fallback keeps the map working — and SAYS so: more than
 * 100 cruises used to be one 400, a cold batch outlasted the 10 s default
 * timeout, and either way every route became a straight line in silence.
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
  const { t } = useTranslation("cruise");
  const addToast = useToastStore((s) => s.addToast);
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
      let failed = 0;
      for (const ids of chunks(missingIds, CRUISE_GEOMETRY.BATCH_SIZE)) {
        try {
          const batch = await cruiseApi.getGeometryBatch(ids, {
            timeoutMs: CRUISE_GEOMETRY.TIMEOUT_MS,
          });
          if (cancelled) return;
          setCruiseGeometry((prev) => {
            const next = new Map(prev);
            for (const [id, fc] of batch.entries()) {
              if (!next.has(id)) next.set(id, fc);
            }
            return next;
          });
        } catch (err) {
          if (cancelled) return;
          logger.warn("Cruise sea-route batch failed; those cruises keep straight lines", err);
          failed += ids.length;
        }
      }
      if (failed > 0) addToast("warning", t("map.geometryFailed", { count: failed }));
    };
    void run();
    return (): void => {
      cancelled = true;
    };
    // `t`/`addToast` are deliberately left out: a language switch must not
    // refetch every route, and the toast store's action is stable.
  }, [cruises]);

  return cruiseGeometry;
}
