import { useEffect, useState } from "react";
import { busApi } from "../lib/api/bus";
import { logger } from "../lib/logger";
import type { BusRoutingAvailability } from "../types/bus";

/**
 * Whether the instance can route a bus ride along the road, or null while that
 * is unknown. A failed lookup stays null — the caller then says nothing about
 * routing rather than claiming the instance has none.
 */
export function useBusRouting(): BusRoutingAvailability | null {
  const [availability, setAvailability] = useState<BusRoutingAvailability | null>(null);
  useEffect(() => {
    let cancelled = false;
    busApi
      .routing()
      .then((a) => {
        if (!cancelled) setAvailability(a);
      })
      .catch((err: unknown) => logger.warn("useBusRouting: availability unknown", err));
    return () => {
      cancelled = true;
    };
  }, []);
  return availability;
}
