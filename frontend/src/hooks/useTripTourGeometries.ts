import { useEffect, useMemo, useState } from "react";
import { toursApi } from "../lib/api/tours";
import { tourIndexApi, type TourGeometryEntry } from "../lib/api/tourIndex";
import { hexToRgb } from "../lib/domainColor";
import { logger } from "../lib/logger";
import type { TourGeometry, TourRoute } from "../types/tour";
import { useDomainColors } from "./useDomainColors";

export interface TripTourGeometries {
  geometries: TourGeometryEntry[];
  /** The tours could not be loaded — the map must say so, not look tourless. */
  failed: boolean;
}

const NONE: TourGeometryEntry[] = [];

/** One tour's recordings as a line layer: for a day tour the track IS the route. */
async function recordingGeometry(tripId: string, route: TourRoute): Promise<TourGeometry | null> {
  const tracks = await toursApi.tracks.list(tripId, route.id);
  if (tracks.length === 0) return null;
  const full = await Promise.all(tracks.map((tr) => toursApi.tracks.get(tripId, route.id, tr.id)));
  return {
    type: "FeatureCollection",
    features: full.map((tr) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [...tr.geometry] },
      properties: {
        legId: `track:${tr.id}`,
        source: "track",
        mode: route.mode,
        confidence: "high",
        distanceKm: tracks.find((x) => x.id === tr.id)?.distanceKm ?? 0,
      },
    })),
  };
}

/**
 * The lines of a trip's tours, for the trip map (spec 2026-08-29 §9.2: "TripMap
 * gains one PathLayer per section"). The route editor and the roadtrip page
 * already drew them; the trip's own "Karte" tab showed only the stations
 * (acceptance run, 2026-09-26).
 *
 * The planned/routed legs come from ONE batch call, the recordings per tour —
 * the same two sources the route editor draws. `enabled` gates the fetch
 * itself: behind the tours beta gate nothing is asked for.
 */
export function useTripTourGeometries(tripId: string, enabled: boolean): TripTourGeometries {
  const { colorOf } = useDomainColors();
  const roadtripHex = colorOf("roadtrip");
  const [loaded, setLoaded] = useState<{ routes: TourRoute[]; lines: TourGeometryEntry[] }>({
    routes: [],
    lines: [],
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLoaded({ routes: [], lines: [] });
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void (async (): Promise<void> => {
      try {
        const routes = await toursApi.list(tripId);
        if (routes.length === 0) {
          if (!cancelled) setLoaded({ routes, lines: [] });
          return;
        }
        const [planned, recorded] = await Promise.all([
          tourIndexApi.geometryBatch(routes.map((r) => r.id)),
          Promise.all(routes.map((r) => recordingGeometry(tripId, r))),
        ]);
        if (cancelled) return;
        const lines: TourGeometryEntry[] = [];
        routes.forEach((route, i) => {
          const legs = planned.get(route.id);
          if (legs) lines.push({ routeId: route.id, name: route.name, geometry: legs });
          const track = recorded[i];
          if (track)
            lines.push({ routeId: `${route.id}:tracks`, name: route.name, geometry: track });
        });
        setLoaded({ routes, lines });
      } catch (err: unknown) {
        if (cancelled) return;
        logger.warn("useTripTourGeometries: failed to load the trip's tours", err);
        setLoaded({ routes: [], lines: [] });
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);

  // Coloured here, not in the fetch, so a new roadtrip hue recolours without a
  // refetch. A day tour keeps the one tour hue and the thinner line; a
  // roadtrip takes its domain colour and the heavier one (`buildTourPaths`).
  const geometries = useMemo(() => {
    if (loaded.lines.length === 0) return NONE;
    const roadtripIds = new Set(
      loaded.routes.filter((r) => r.kind === "roadtrip").map((r) => r.id)
    );
    const roadtripRgb = hexToRgb(roadtripHex);
    return loaded.lines.map((line) =>
      roadtripIds.has(line.routeId.replace(/:tracks$/, ""))
        ? { ...line, rgb: roadtripRgb, isRoadtrip: true }
        : line
    );
  }, [loaded, roadtripHex]);

  return { geometries, failed };
}
