import { useEffect, useState } from "react";
import { useMapFocusStore } from "../../../store/mapFocusStore";
import type { FocusableMap } from "./useMapSelectionCards";

/** A map that can also fit a box — both MapLibre engines can. */
export interface FittableMap extends FocusableMap {
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options: {
      padding: { top: number; bottom: number; left: number; right: number };
      maxZoom: number;
      duration: number;
      essential: boolean;
    }
  ) => void;
}

/** How close a single place is shown: street level on the flat map, the region on the globe. */
export const FOCUS_REQUEST = {
  flat: { pointZoom: 10, maxZoom: 10, duration: 800 },
  globe: { pointZoom: 5, maxZoom: 5, duration: 1200 },
} as const;

const EDGE = 80;

/**
 * Obeys the activity list's camera requests (`store/mapFocusStore.ts`): a
 * point zooms to it, a box is fitted with the chrome's inset left clear.
 *
 * The move waits one task. A selection the same click made opens its own card
 * and moves the camera in an effect of its own (a hotel flies to its pin, a
 * flight fits its two airports), and two camera commands in one commit leave
 * the first one's. Deferring ours makes the list row the one that decides
 * where the camera ends up — and every domain end up the same way.
 */
export function useMapFocusRequests(
  mapRef: { current: { getMap: () => unknown } | null },
  engine: keyof typeof FOCUS_REQUEST
): void {
  const tuning = FOCUS_REQUEST[engine];
  const request = useMapFocusStore((s) => s.request);
  const seq = useMapFocusStore((s) => s.seq);
  const [mountSeq] = useState(() => useMapFocusStore.getState().seq);

  useEffect(() => {
    if (request === null || seq <= mountSeq) return;
    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap() as FittableMap | undefined;
      if (!map) return;
      if (request.bbox) {
        const [west, south, east, north] = request.bbox;
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding: {
              top: EDGE,
              bottom: EDGE,
              left: EDGE + (request.leftInset ?? 0),
              right: EDGE,
            },
            maxZoom: tuning.maxZoom,
            duration: tuning.duration,
            essential: true,
          }
        );
      } else if (request.point) {
        map.flyTo({
          center: [request.point.lon, request.point.lat],
          zoom: Math.max(map.getZoom(), tuning.pointZoom),
          duration: tuning.duration,
          essential: true,
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [request, seq, mountSeq, mapRef, tuning]);
}
