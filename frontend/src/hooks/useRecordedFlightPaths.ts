import { useEffect, useMemo, useState } from "react";

import { useBetaFeatures } from "./useBetaFeatures";
import { useTranslation } from "./useTranslation";
import { flightsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import { withRecordedPaths } from "../components/layers/recordedFlightPaths";
import type { GeoJSONFeature } from "../types";
import type { FlightTrackLine } from "../types/flightTrack";

/**
 * The map's flights with each recorded flight's line attached (forgejo#312),
 * so both map engines draw it instead of the great circle. Behind the
 * `flightTrackUpload` beta key: closed, nothing is fetched and the flights
 * come back as they went in — the same array, so no memo downstream re-runs.
 *
 * A failed fetch keeps the great circles AND says so in a toast: a map that
 * quietly lost every recording would read as "none of these was recorded".
 */
export function useRecordedFlightPaths(flights: GeoJSONFeature[]): GeoJSONFeature[] {
  const { t } = useTranslation("flights");
  const { isFeatureVisible } = useBetaFeatures();
  const addToast = useToastStore((s) => s.addToast);
  const enabled = isFeatureVisible("flightTrackUpload") && flights.length > 0;
  const [lines, setLines] = useState<FlightTrackLine[]>([]);

  useEffect(() => {
    if (!enabled) {
      setLines((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await flightsApi.getTrackLines();
        if (!cancelled) setLines(loaded);
      } catch (err: unknown) {
        logger.warn({ err }, "useRecordedFlightPaths: recorded lines could not be loaded");
        if (!cancelled) addToast("warning", t("flights:track.linesLoadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The fetch belongs to the gate alone; `t` and `addToast` do not re-ask.
  }, [enabled]);

  return useMemo(
    () => (enabled && lines.length > 0 ? withRecordedPaths(flights, lines) : flights),
    [enabled, flights, lines]
  );
}
