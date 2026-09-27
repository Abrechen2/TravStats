import { useEffect, useState } from "react";

import { roadtripsApi } from "../lib/api/roadtrips";
import { logger } from "../lib/logger";
import type { RoadtripStationPoint } from "../components/layers/roadtripStationsLayer";

/**
 * Every placed station of the caller's roadtrips, for the dashboard map
 * (tester 2026-09-26). One list call — the list already carries each
 * roadtrip's stations — and only while `enabled`: the day-tour tab has none
 * to draw. A failed load is reported as such, never as "no stations".
 */
export function useRoadtripStations(enabled: boolean): {
  stations: RoadtripStationPoint[];
  failed: boolean;
} {
  const [stations, setStations] = useState<RoadtripStationPoint[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setStations([]);
      setFailed(false);
      return;
    }
    let cancelled = false;
    roadtripsApi
      .list()
      .then((roadtrips) => {
        if (cancelled) return;
        setStations(
          roadtrips.flatMap((r) => (r.stations ?? []).map((s) => ({ ...s, roadtripName: r.name })))
        );
        setFailed(false);
      })
      .catch((err: unknown) => {
        logger.warn("useRoadtripStations: failed to load roadtrip stations", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { stations, failed };
}
