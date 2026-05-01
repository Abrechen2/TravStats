import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { StyleSpecification } from "maplibre-gl";
import type { GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
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

const FLIGHT_ARC_COLOR_FROM: [number, number, number, number] = [255, 110, 180, 220];
const FLIGHT_ARC_COLOR_TO: [number, number, number, number] = [255, 220, 130, 220];
const CRUISE_PATH_COLOR: [number, number, number, number] = [80, 180, 255, 230];
const AIRPORT_DOT_COLOR: [number, number, number, number] = [251, 191, 36, 230];
const PORT_DOT_COLOR: [number, number, number, number] = [56, 189, 248, 230];

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 25,
  zoom: 1.6,
  pitch: 0,
  bearing: 0,
};

// Six tokenless basemap styles, mirrored after geojson.io's style picker.
// All free, all working without API keys — Positron / Dark-Matter /
// Voyager are CARTO's published vector styles, OpenFreeMap Liberty is
// the OSM-based Mapbox-Streets-look-alike, ESRI World Imagery is the
// raster satellite tile service ESRI keeps free for non-commercial use,
// and OSM Standard is the OpenStreetMap reference raster (low-volume
// only — fine for self-hosted use, but not what we'd ship at scale).
type StyleId = "standard" | "light" | "dark" | "voyager" | "satellite" | "osm";

interface SkyConfig {
  "sky-color": string;
  "horizon-color": string;
  "fog-color": string;
  "fog-ground-blend": number;
  "horizon-fog-blend": number;
  "sky-horizon-blend": number;
  "atmosphere-blend": number;
}

interface StyleOption {
  id: StyleId;
  label: string;
  // Either a remote style URL or a fully-inlined MapLibre style spec
  url: string | StyleSpecification;
  sky: SkyConfig;
}

const SKY_LIGHT: SkyConfig = {
  "sky-color": "#1e293b",
  "horizon-color": "#a8c0d6",
  "fog-color": "#e2e8f0",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0.6,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 1.0,
};

const SKY_DARK: SkyConfig = {
  "sky-color": "#0a0e1a",
  "horizon-color": "#3b3f5e",
  "fog-color": "#1f2937",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0.6,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 1.0,
};

const SKY_VOYAGER: SkyConfig = {
  "sky-color": "#1c2540",
  "horizon-color": "#7aa3c8",
  "fog-color": "#cfe0ee",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0.6,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 1.0,
};

const SKY_SATELLITE: SkyConfig = {
  "sky-color": "#000814",
  "horizon-color": "#3a4a6e",
  "fog-color": "#0b1a2a",
  "fog-ground-blend": 0.4,
  "horizon-fog-blend": 0.55,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 1.0,
};

const buildRasterStyle = (
  tiles: string[],
  attribution: string,
  maxzoom = 19
): StyleSpecification => ({
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles,
      tileSize: 256,
      maxzoom,
      attribution,
    },
  },
  layers: [
    {
      id: "base",
      type: "raster",
      source: "base",
    },
  ],
  // Empty sprite/glyphs to satisfy MapLibre 5; raster styles don't
  // actually need them but the spec validator complains otherwise.
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
});

const STYLE_OPTIONS: StyleOption[] = [
  {
    id: "standard",
    label: "Standard",
    url: "https://tiles.openfreemap.org/styles/liberty",
    sky: SKY_LIGHT,
  },
  {
    id: "light",
    label: "Light",
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    sky: SKY_LIGHT,
  },
  {
    id: "dark",
    label: "Dark",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    sky: SKY_DARK,
  },
  {
    id: "voyager",
    label: "Voyager",
    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    sky: SKY_VOYAGER,
  },
  {
    id: "satellite",
    label: "Satellite",
    url: buildRasterStyle(
      [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      "Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
    ),
    sky: SKY_SATELLITE,
  },
  {
    id: "osm",
    label: "OSM",
    url: buildRasterStyle(
      [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
    ),
    sky: SKY_LIGHT,
  },
];

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
  const mapRef = useRef<MapRef>(null);
  const [styleId, setStyleId] = useState<StyleId>(() => {
    if (typeof window === "undefined") return "standard";
    const stored = window.sessionStorage.getItem("globeStyleId");
    return STYLE_OPTIONS.some((s) => s.id === stored) ? (stored as StyleId) : "standard";
  });

  const currentStyle = useMemo(
    () => STYLE_OPTIONS.find((s) => s.id === styleId) ?? STYLE_OPTIONS[0],
    [styleId]
  );

  // Latest currentStyle exposed via ref so the style.load handler
  // (registered once on first map load) sees the active style on every
  // style switch — without this the handler would close over the
  // initial style and apply stale sky settings forever.
  const currentStyleRef = useRef(currentStyle);
  useEffect(() => {
    currentStyleRef.current = currentStyle;
  }, [currentStyle]);

  const onStyleChange = useCallback((next: StyleId) => {
    setStyleId(next);
    try {
      window.sessionStorage.setItem("globeStyleId", next);
    } catch {
      // sessionStorage may be unavailable in private mode — opt-in only
    }
  }, []);

  // Apply globe projection + sky when the map first loads AND on every
  // subsequent style swap (since MapLibre resets both when replacing
  // the style). Driven by react-map-gl's onLoad callback because that's
  // the only event that fires after mapRef is guaranteed populated.
  const onMapLoad = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const apply = (): void => {
      try {
        map.setProjection({ type: "globe" });
      } catch (err) {
        logger.warn("GlobeViewMapLibre: setProjection(globe) failed", err);
      }
      try {
        map.setSky(currentStyleRef.current.sky);
      } catch (err) {
        logger.warn("GlobeViewMapLibre: setSky failed", err);
      }
    };
    apply();
    map.on("style.load", apply);
  }, []);

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

  // Dark backdrop pairs with bright styles too — geojson.io always uses
  // a dark space background regardless of the basemap, which makes the
  // atmosphere glow the most legible thing on screen.
  return (
    <div
      className="relative h-full w-full"
      style={{
        background: "radial-gradient(ellipse at center, #0a0e1a 0%, #04050a 100%)",
      }}
    >
      <MapGL
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={currentStyle.url}
        attributionControl={false}
        onLoad={onMapLoad}
        style={{ width: "100%", height: "100%" }}
      >
        <DeckGLOverlay layers={layers} />
      </MapGL>

      {/* Style picker — bottom-left, geojson.io-style horizontal pills. */}
      <div
        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-md p-1"
        style={{
          background: "rgba(13, 17, 23, 0.78)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.18)",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {STYLE_OPTIONS.map((opt) => {
          const active = opt.id === styleId;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onStyleChange(opt.id)}
              className="rounded px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: active ? "rgba(120, 200, 255, 0.18)" : "transparent",
                color: active ? "#bae6fd" : "rgba(241,245,249,0.78)",
                border: active ? "1px solid rgba(120, 200, 255, 0.55)" : "1px solid transparent",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

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
