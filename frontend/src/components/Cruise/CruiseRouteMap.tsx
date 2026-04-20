import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { Cruise } from "../../types";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { createCruiseArcsLayer } from "../layers/cruiseArcsLayer";
import { createCruisePortsLayer } from "../layers/cruisePortsLayer";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { useThemeStore } from "../../store/themeStore";
import { logger } from "../../lib/logger";

const LIGHT_MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const INITIAL_VIEW: MapViewState = {
  longitude: 10,
  latitude: 52,
  zoom: 3,
  pitch: 0,
  bearing: 0,
};

interface DeckOverlayProps {
  layers: Layer[];
}

function DeckGLOverlay({ layers }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers, pickingRadius: 5 }), {
    position: "top-left",
  });
  overlay.setProps({ layers, pickingRadius: 5 });
  return null;
}

interface Props {
  cruise: Cruise;
}

/**
 * Mini-map for the cruise detail page — shows this one cruise's sea
 * route with port markers. Fetches the A*-computed geometry from
 * `/cruises/:id/geometry`; legs that fail to route fall back to the
 * Bezier placeholder via the shared cruiseArcsLayer. Auto-fits bounds
 * on first geometry + port load, then lets the user pan/zoom freely.
 */
export function CruiseRouteMap({ cruise }: Props): JSX.Element {
  const mapRef = useRef<MapRef | null>(null);
  const isDark = useThemeStore((s) => s.isDarkMode);
  const [geometry, setGeometry] = useState<CruiseRouteFeatureCollection | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const didFit = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fc = await cruiseApi.getGeometry(cruise.id);
        if (!cancelled) setGeometry(fc);
      } catch (err) {
        logger.warn("CruiseRouteMap: failed to load geometry", err);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [cruise.id]);

  const geometryMap = useMemo(
    () => (geometry ? new Map([[cruise.id, geometry]]) : new Map()),
    [geometry, cruise.id]
  );

  const layers: Layer[] = useMemo(() => {
    // zoom=10 ⇒ toleranceKmForZoom returns 0, i.e. NO Douglas-Peucker
    // simplification. We want the full A* polyline here because the
    // detail-page map is small but local (UK + Scandinavia fits the
    // viewport), and simplification at 20 km tolerance was collapsing
    // the Kiel-Canal traversal (multiple 0.1° cells along a narrow
    // water corridor) into a single long hop across Schleswig-Holstein
    // land. At world-zoom stats pages the simplification still helps —
    // this is a per-mini-map override, not a global setting.
    const arcsLayer = createCruiseArcsLayer([cruise], geometryMap, 10);
    const portsLayer = createCruisePortsLayer([cruise]);
    return [arcsLayer, portsLayer].filter((l): l is Layer => l !== null);
  }, [cruise, geometryMap]);

  const bboxPoints: Array<[number, number]> = useMemo(() => {
    const pts: Array<[number, number]> = [];
    for (const stop of cruise.stops) {
      if (stop.port) pts.push([stop.port.lon, stop.port.lat]);
    }
    if (geometry) {
      for (const feat of geometry.features) {
        for (const c of feat.geometry.coordinates) pts.push(c);
      }
    }
    return pts;
  }, [cruise.stops, geometry]);

  useEffect(() => {
    if (!mapLoaded || didFit.current) return;
    const bbox = computeBbox(bboxPoints);
    if (!bbox) return;
    const [west, south, east, north] = bbox;
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 40, duration: 0 }
    );
    didFit.current = true;
  }, [mapLoaded, bboxPoints]);

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-md border border-[var(--color-border)]">
      <MapGL
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && <DeckGLOverlay layers={layers} />}
      </MapGL>
    </div>
  );
}
