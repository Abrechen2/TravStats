import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import { useThemeStore } from "../store/themeStore";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { logger } from "../lib/logger";

/**
 * Spike: replace the Three.js-based GlobeView with MapLibre's native
 * globe projection (MapLibre GL 5.x). Same renderer as the 2D map mode
 * — only the projection and a sky layer change. Activated by adding
 * `?globeEngine=maplibre` to any /dashboard URL.
 *
 * Intentionally minimal: one color per layer, no day/night terminator,
 * no time slider, no fly-to. Goal of the spike is "is this look good
 * enough to drop react-globe.gl + Three.js entirely?"
 */

interface GlobeViewMapLibreProps {
  flights: GeoJSONFeature[];
  cruises?: Cruise[];
  onFlightClick?: (flightId: string) => void;
  minRouteCount?: number;
}

const LIGHT_MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const FLIGHT_ARC_COLOR_FROM: [number, number, number, number] = [255, 110, 180, 220]; // pink-400
const FLIGHT_ARC_COLOR_TO: [number, number, number, number] = [255, 220, 130, 220]; // amber-300
const CRUISE_PATH_COLOR: [number, number, number, number] = [80, 180, 255, 230]; // sky-blue
const AIRPORT_DOT_COLOR: [number, number, number, number] = [251, 191, 36, 230]; // amber-400
const PORT_DOT_COLOR: [number, number, number, number] = [56, 189, 248, 230]; // sky-400

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 25,
  zoom: 1.6,
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
  overlay.setProps({ layers });
  return null;
}

interface ArcDatum {
  from: [number, number];
  to: [number, number];
  count: number;
  flightIds: string[];
}

interface PointDatum {
  position: [number, number];
  size: number;
  label: string;
}

interface CruisePathDatum {
  path: [number, number][];
  cruiseId: string;
}

const createRouteKey = (a: string, b: string): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

export default function GlobeViewMapLibre({
  flights = [],
  cruises = [],
  onFlightClick,
  minRouteCount = 1,
}: GlobeViewMapLibreProps): JSX.Element {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const mapRef = useRef<MapRef>(null);

  // Apply globe projection + sky once the underlying MapLibre instance
  // is ready. react-map-gl exposes `getMap()` which returns the raw
  // MapLibre GL Map — we use that for setProjection/setSky since the
  // typed react-map-gl props don't expose every MapLibre 5 API yet.
  const onMapLoad = (): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      map.setProjection({ type: "globe" });
    } catch (err) {
      logger.warn("GlobeViewMapLibre: setProjection(globe) failed", err);
    }
    try {
      map.setSky({
        "sky-color": isDarkMode ? "#0a0e1a" : "#1e293b",
        "horizon-color": isDarkMode ? "#3b3f5e" : "#a8c0d6",
        "fog-color": isDarkMode ? "#1f2937" : "#e2e8f0",
        "fog-ground-blend": 0.5,
        "horizon-fog-blend": 0.6,
        "sky-horizon-blend": 0.7,
        "atmosphere-blend": 1.0,
      });
    } catch (err) {
      logger.warn("GlobeViewMapLibre: setSky failed", err);
    }
  };

  // Re-apply sky on theme change
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      map.setSky({
        "sky-color": isDarkMode ? "#0a0e1a" : "#1e293b",
        "horizon-color": isDarkMode ? "#3b3f5e" : "#a8c0d6",
        "fog-color": isDarkMode ? "#1f2937" : "#e2e8f0",
        "fog-ground-blend": 0.5,
        "horizon-fog-blend": 0.6,
        "sky-horizon-blend": 0.7,
        "atmosphere-blend": 1.0,
      });
    } catch {
      // map not ready yet
    }
  }, [isDarkMode]);

  const arcsData = useMemo<ArcDatum[]>(() => {
    interface RouteAcc {
      count: number;
      from: [number, number];
      to: [number, number];
      ids: string[];
    }
    const routes = new Map<string, RouteAcc>();
    for (const flight of flights) {
      const coords = flight.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const start = coords[0];
      const end = coords[coords.length - 1];
      if (
        ![start[0], start[1], end[0], end[1]].every(Number.isFinite) ||
        (start[0] === 0 && start[1] === 0) ||
        (end[0] === 0 && end[1] === 0)
      ) {
        continue;
      }
      const dep = flight.properties?.departureAirport?.iata ?? "UNK";
      const arr = flight.properties?.arrivalAirport?.iata ?? "UNK";
      const key = createRouteKey(dep, arr);
      const existing = routes.get(key);
      if (existing) {
        existing.count++;
        existing.ids.push(flight.properties.id);
      } else {
        routes.set(key, {
          count: 1,
          from: [start[0], start[1]],
          to: [end[0], end[1]],
          ids: [flight.properties.id],
        });
      }
    }
    return Array.from(routes.values())
      .filter((r) => r.count >= minRouteCount)
      .map((r) => ({ from: r.from, to: r.to, count: r.count, flightIds: r.ids }));
  }, [flights, minRouteCount]);

  const airportPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<string, PointDatum>();
    for (const flight of flights) {
      const coords = flight.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const dep = flight.properties?.departureAirport;
      const arr = flight.properties?.arrivalAirport;
      const start = coords[0];
      const end = coords[coords.length - 1];
      if (dep?.iata && Number.isFinite(start[0]) && Number.isFinite(start[1])) {
        const key = dep.iata;
        const cur = seen.get(key);
        if (cur) cur.size++;
        else seen.set(key, { position: [start[0], start[1]], size: 1, label: dep.iata });
      }
      if (arr?.iata && Number.isFinite(end[0]) && Number.isFinite(end[1])) {
        const key = arr.iata;
        const cur = seen.get(key);
        if (cur) cur.size++;
        else seen.set(key, { position: [end[0], end[1]], size: 1, label: arr.iata });
      }
    }
    return Array.from(seen.values());
  }, [flights]);

  // Pull cruise leg geometry from the schematic-router endpoint; one
  // FeatureCollection per cruise. Same source as the 2D DeckGLMap and
  // the existing GlobeView, so paths look identical to the rest of the
  // app.
  const [cruiseGeometry, setCruiseGeometry] = useState<Map<string, CruiseRouteFeatureCollection>>(
    () => new Map()
  );
  const cruiseGeometryRef = useRef(cruiseGeometry);
  useEffect(() => {
    cruiseGeometryRef.current = cruiseGeometry;
  }, [cruiseGeometry]);

  useEffect(() => {
    if (cruises.length === 0) return;
    let cancelled = false;
    const missingIds = cruises.map((c) => c.id).filter((id) => !cruiseGeometryRef.current.has(id));
    if (missingIds.length === 0) return;
    void (async (): Promise<void> => {
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
      } catch (err: unknown) {
        logger.error("GlobeViewMapLibre: cruise geometry batch fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cruises]);

  const cruisePaths = useMemo<CruisePathDatum[]>(() => {
    const out: CruisePathDatum[] = [];
    for (const cruise of cruises) {
      const fc = cruiseGeometry.get(cruise.id);
      if (!fc) continue;
      for (const feature of fc.features) {
        const path = feature.geometry.coordinates as [number, number][];
        if (path.length < 2) continue;
        out.push({ path, cruiseId: cruise.id });
      }
    }
    return out;
  }, [cruises, cruiseGeometry]);

  const portPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<number, PointDatum>();
    for (const c of cruises) {
      for (const stop of c.stops) {
        if (stop.isAtSea || !stop.port) continue;
        const port = stop.port;
        const cur = seen.get(port.id);
        if (cur) cur.size++;
        else
          seen.set(port.id, {
            position: [port.lon, port.lat],
            size: 1,
            label: port.unlocode ?? port.name,
          });
      }
    }
    return Array.from(seen.values());
  }, [cruises]);

  const layers = useMemo<Layer[]>(
    () => [
      new ArcLayer<ArcDatum>({
        id: "globe-flight-arcs",
        data: arcsData,
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getSourceColor: FLIGHT_ARC_COLOR_FROM,
        getTargetColor: FLIGHT_ARC_COLOR_TO,
        getWidth: (d) => Math.max(1, Math.min(4, 1 + Math.log2(d.count + 1))),
        greatCircle: true,
        pickable: Boolean(onFlightClick),
        onClick: ({ object }: { object?: ArcDatum }): void => {
          if (object && onFlightClick && object.flightIds.length > 0) {
            onFlightClick(object.flightIds[object.flightIds.length - 1]);
          }
        },
      }),
      new PathLayer<CruisePathDatum>({
        id: "globe-cruise-paths",
        data: cruisePaths,
        getPath: (d) => d.path,
        getColor: CRUISE_PATH_COLOR,
        getWidth: 2,
        widthUnits: "pixels",
        widthMinPixels: 1.5,
        widthMaxPixels: 3,
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer<PointDatum>({
        id: "globe-airport-dots",
        data: airportPoints,
        getPosition: (d) => d.position,
        getFillColor: AIRPORT_DOT_COLOR,
        getRadius: (d) => 20000 + Math.sqrt(d.size) * 8000,
        radiusUnits: "meters",
        radiusMinPixels: 2,
        radiusMaxPixels: 8,
        stroked: true,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 0.5,
      }),
      new ScatterplotLayer<PointDatum>({
        id: "globe-port-dots",
        data: portPoints,
        getPosition: (d) => d.position,
        getFillColor: PORT_DOT_COLOR,
        getRadius: (d) => 20000 + Math.sqrt(d.size) * 8000,
        radiusUnits: "meters",
        radiusMinPixels: 2,
        radiusMaxPixels: 8,
        stroked: true,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 0.5,
      }),
    ],
    [arcsData, cruisePaths, airportPoints, portPoints, onFlightClick]
  );

  return (
    <div
      className="relative h-full w-full"
      style={{
        background: isDarkMode
          ? "radial-gradient(ellipse at center, #0a0e1a 0%, #04050a 100%)"
          : "radial-gradient(ellipse at center, #1e293b 0%, #050810 100%)",
      }}
    >
      <MapGL
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        onLoad={onMapLoad}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <DeckGLOverlay layers={layers} />
      </MapGL>

      {/* Spike-Banner so user knows which engine is currently rendering */}
      <div
        className="absolute top-3 right-3 z-10 rounded-md px-3 py-1.5 text-xs font-medium"
        style={{
          background: "rgba(13, 17, 23, 0.78)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(120, 200, 255, 0.5)",
          color: "rgba(241,245,249,0.95)",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        🧪 MapLibre Globe (Spike) · {arcsData.length} routes · {cruisePaths.length} cruise legs
      </div>
    </div>
  );
}
