import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import MapGL, { useControl, type MapRef, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LightingEffect } from "@deck.gl/core";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { Cruise, GeoJSONFeature, Flight } from "../types";
import type { MapMode } from "./MapContainer3D";
import { buildRouteData, createRoutesLayers } from "./layers/routesLayer";
import { createHeatmapLayer } from "./layers/heatmapLayer";
import { createTripsLayer, buildTripsData, getTimeRange } from "./layers/tripsLayer";
import {
  createCruiseArcsLayer,
  createCruiseArrowsLayer,
  type CruiseGeometryMap,
} from "./layers/cruiseArcsLayer";
import { createCruisePortsLayer } from "./layers/cruisePortsLayer";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { TimeSlider } from "./TimeSlider";
import { useThemeStore } from "../store/themeStore";
import { MAP_LAYER_COLORS } from "../types/mapTheme";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../store/cruiseSelectionStore";
import { CruiseTooltip } from "./CruiseTooltip";
import { computeBbox } from "../utils/mapAnimationHelpers";
import { usePlaneAnimation } from "../hooks/usePlaneAnimation";
import { usePulseAnimation } from "../hooks/usePulseAnimation";
import { MapTooltip } from "./MapTooltip";
import { TripTooltip } from "./TripTooltip";
import { AirportTooltip } from "./AirportTooltip";
import {
  NativeRoutesLayer,
  NATIVE_ROUTE_LINE_ID,
  NATIVE_AIRPORT_CIRCLE_ID,
} from "./NativeRoutesLayer";

// Delay before showing the flight tooltip — lets the flyTo animation settle first
const TOOLTIP_DELAY_MS = 1800;

/** Check once whether WebGL2 is available (deck.gl requires it). */
function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return gl !== null;
  } catch {
    return false;
  }
}

const webgl2Available = hasWebGL2();

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

const LIGHT_MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

interface DeckOverlayProps {
  layers: Layer[];
  effects: LightingEffect[];
}

function DeckGLOverlay({ layers, effects }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ layers, effects, pickingRadius: 5 }),
    { position: "top-left" }
  );
  overlay.setProps({ layers, effects, pickingRadius: 5 });
  return null;
}

interface DeckGLMapProps {
  flights: GeoJSONFeature[];
  visMode: MapMode;
  minRouteCount?: number;
  onFlightClick?: (flightId: string) => void;
  onRouteClick?: (flightIds: string[]) => void;
  onEdit?: (flight: Flight) => void;
  flightList?: Flight[];
  onResetTrip?: () => void;
  cruises?: Cruise[];
  /** Extra deck.gl layers appended after all internally-built layers. */
  extraLayers?: Layer[];
  /** Override count-based heatmap palette for flight routes — see
   *  MapContainer3D.flightRouteColor for the motivation. */
  flightRouteColor?: [number, number, number];
}

export function DeckGLMap({
  flights,
  visMode,
  minRouteCount = 1,
  onFlightClick,
  onRouteClick,
  onEdit,
  flightList,
  onResetTrip,
  cruises = [],
  extraLayers,
  flightRouteColor,
}: DeckGLMapProps): JSX.Element {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const mapTheme = useThemeStore((state) => state.mapTheme);
  // Heatmap palette is unchanged by flightRouteColor — the override
  // is threaded explicitly into createRoutesLayers/buildRouteData so
  // scheduled-cyan + historical-grey branches get overridden too.
  // Other layers that read themeColors (airport dots, hex grid) keep
  // the theme palette regardless of the flight monochrome mode.
  const themeColors = useMemo(() => MAP_LAYER_COLORS[mapTheme], [mapTheme]);
  const mapRef = useRef<MapRef>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const deckClickedRef = useRef(false);

  // Real A* sea-route geometry for each cruise, indexed by cruise id.
  // Fetched lazily after mount; the arcs layer renders Bezier until an
  // entry lands here, then swaps to the computed route. Any fetch
  // failure is logged via the api client's interceptor and left as
  // a missing entry — the Bezier fallback keeps the UI working.
  const [cruiseGeometry, setCruiseGeometry] = useState<Map<string, CruiseRouteFeatureCollection>>(
    () => new Map()
  );

  // Ref mirror of `cruiseGeometry` so the fetch loop can read the
  // latest state without re-triggering the effect on every successful
  // fetch. We only want to re-run when the cruise list itself changes.
  const cruiseGeometryRef = useRef<Map<string, CruiseRouteFeatureCollection>>(cruiseGeometry);
  useEffect(() => {
    cruiseGeometryRef.current = cruiseGeometry;
  }, [cruiseGeometry]);

  useEffect(() => {
    if (cruises.length === 0) return;
    let cancelled = false;
    // Single batch round-trip for all cruise geometries. Server returns
    // a {[id]: FeatureCollection} map; we merge into local state. The
    // server cache makes repeat calls (mode switches, refilters) cheap.
    // Anything already in state is filtered out so we never re-fetch.
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
        // Swallow — interceptor handles logging. Bezier fallback remains.
      }
    };
    void run();
    return (): void => {
      cancelled = true;
    };
  }, [cruises]);

  // Per-field selectors. Bare `useFlightSelectionStore()` would re-render
  // the map on every field change in the store; with selectors we only
  // re-render when the specific field this component reads changes.
  const selectedIds = useFlightSelectionStore((s) => s.selectedIds);
  const selectedFlights = useFlightSelectionStore((s) => s.selectedFlights);
  const highlightMode = useFlightSelectionStore((s) => s.highlightMode);
  const clearSelection = useFlightSelectionStore((s) => s.clearSelection);
  const showDetails = useFlightSelectionStore((s) => s.showDetails);
  const selectedCruiseId = useCruiseSelectionStore((s) => s.selectedCruiseId);
  const selectedCruise = useCruiseSelectionStore((s) => s.selectedCruise);
  const setCruiseSelection = useCruiseSelectionStore((s) => s.setSelection);
  const clearCruiseSelection = useCruiseSelectionStore((s) => s.clearSelection);

  // Reset playing state when leaving trips mode (Bug 3)
  useEffect(() => {
    if (visMode !== "trips") {
      setPlaying(false);
    }
  }, [visMode]);

  const trips = useMemo(
    () => (visMode === "trips" ? buildTripsData(flights) : []),
    [flights, visMode]
  );

  const timeRange = useMemo(
    () => (trips.length > 0 ? getTimeRange(trips) : { min: 0, max: 1 }),
    [trips]
  );

  // Initialize currentTime to timeRange.min when trips data loads or changes
  useEffect(() => {
    setCurrentTime(timeRange.min);
  }, [timeRange.min]);

  // flyTo when selection changes
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const points: Array<[number, number]> = selectedFlights.flatMap((f) => {
      const pts: Array<[number, number]> = [];
      if (f.depLon != null && f.depLat != null) pts.push([f.depLon, f.depLat]);
      if (f.arrLon != null && f.arrLat != null) pts.push([f.arrLon, f.arrLat]);
      return pts;
    });

    const bbox = computeBbox(points);
    if (!bbox) return;

    const [west, south, east, north] = bbox;
    const centerLon = (west + east) / 2;
    const centerLat = (south + north) / 2;
    const lonSpan = east - west;
    const latSpan = north - south;
    const span = Math.max(lonSpan, latSpan);
    const zoom = span < 5 ? 6 : span < 20 ? 4 : span < 60 ? 3 : 2;

    map.flyTo({ center: [centerLon, centerLat], zoom, duration: 600, essential: true });
  }, [selectedIds, selectedFlights]);

  const planeLayers = usePlaneAnimation(selectedFlights);
  const pulseLayers = usePulseAnimation(selectedFlights);

  // ── Tooltip geo anchors ─────────────────────────────────────────────────────
  // All tooltips store geographic coordinates so they reproject correctly on move.

  // Flight / trip tooltip
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const tooltipGeoRef = useRef<{
    mode: "group" | "single";
    points: Array<[number, number]>; // [lon, lat]
  } | null>(null);

  // Airport tooltip
  const [airportIata, setAirportIata] = useState<string | null>(null);
  const [airportPos, setAirportPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const airportGeoRef = useRef<[number, number] | null>(null); // [lon, lat]

  // Reproject all active tooltips — called on every map move/zoom via onMove
  const recomputeAllPositions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const anchor = tooltipGeoRef.current;
    if (anchor) {
      if (anchor.mode === "group") {
        const screenPts = anchor.points.map((p) => map.project(p));
        const minX = Math.min(...screenPts.map((p) => p.x));
        const maxX = Math.max(...screenPts.map((p) => p.x));
        const minY = Math.min(...screenPts.map((p) => p.y));
        setTooltipPos({ x: (minX + maxX) / 2, y: minY });
      } else {
        const pt = map.project(anchor.points[0]);
        setTooltipPos({ x: pt.x, y: pt.y });
      }
    }

    const airportAnchor = airportGeoRef.current;
    if (airportAnchor) {
      const pt = map.project(airportAnchor);
      setAirportPos({ x: pt.x, y: pt.y });
    }
  }, []);

  const moveRafRef = useRef<number | null>(null);

  const handleMapMove = useCallback(() => {
    if (moveRafRef.current !== null) return; // already scheduled
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null;
      recomputeAllPositions();
    });
  }, [recomputeAllPositions]);

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setTooltipVisible(false);
    tooltipGeoRef.current = null;
    if (selectedFlights.length === 0) return;

    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map || selectedFlights.length === 0) return;

      if (highlightMode === "group") {
        const pts: Array<[number, number]> = [];
        for (const f of selectedFlights) {
          if (f.depLon != null && f.depLat != null) pts.push([f.depLon, f.depLat]);
          if (f.arrLon != null && f.arrLat != null) pts.push([f.arrLon, f.arrLat]);
        }
        if (pts.length === 0) return;
        tooltipGeoRef.current = { mode: "group", points: pts };
      } else {
        const f = selectedFlights[0];
        if (f.depLon == null || f.arrLon == null || f.depLat == null || f.arrLat == null) return;
        tooltipGeoRef.current = {
          mode: "single",
          points: [[(f.depLon + f.arrLon) / 2, (f.depLat + f.arrLat) / 2]],
        };
      }

      recomputeAllPositions();
      setTooltipVisible(true);
    }, TOOLTIP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [selectedFlights, highlightMode, recomputeAllPositions]);

  // Wrap onFlightClick so that a deck.gl layer click sets the guard ref BEFORE the
  // Map onClick fires and would otherwise clear the selection immediately (Bug 1).
  const handleFlightClick = useCallback(
    (flightIdOrIds: string | string[]): void => {
      deckClickedRef.current = true;
      setAirportIata(null);
      airportGeoRef.current = null;
      // Route clicks pass all flightIds for that route; single-flight clicks pass a string
      if (Array.isArray(flightIdOrIds)) {
        onRouteClick?.(flightIdOrIds);
      } else {
        onFlightClick?.(flightIdOrIds);
      }
    },
    [onFlightClick, onRouteClick]
  );

  const handleAirportClick = useCallback(
    (iata: string, lon: number, lat: number): void => {
      deckClickedRef.current = true;
      clearSelection();
      setTooltipVisible(false);
      tooltipGeoRef.current = null;
      airportGeoRef.current = [lon, lat];
      setAirportIata(iata);
      // Initial screen position
      const map = mapRef.current?.getMap();
      if (map) {
        const pt = map.project([lon, lat]);
        setAirportPos({ x: pt.x, y: pt.y });
      }
    },
    [clearSelection]
  );

  // Heavy data build extracted from the layer useMemo so selection changes
  // (which only need to re-style the existing arcs) don't re-aggregate
  // flights into routes. Deps are deliberately limited to fields that
  // actually affect arc/point geometry + base color.
  const routeData = useMemo(
    () => buildRouteData(flights, minRouteCount, themeColors, flightRouteColor),
    [flights, minRouteCount, themeColors, flightRouteColor]
  );

  const layers = useMemo((): Layer[] => {
    let base: Layer[];
    switch (visMode) {
      case "routes":
        base = createRoutesLayers(
          routeData,
          handleFlightClick,
          themeColors,
          0.3,
          selectedIds,
          handleAirportClick
        );
        break;
      case "heatmap":
        base = [createHeatmapLayer(flights)];
        break;
      case "trips":
        base = [createTripsLayer(trips, currentTime)];
        break;
      default:
        // "globe" is handled by MapContainer3D (GlobeView); DeckGLMap is not
        // rendered in that mode. All other values are exhaustively covered above.
        base = [];
    }

    // Cruise arcs + ports are supplemental overlays — always on when cruise
    // data is present. Gated upstream by the cruise domain being enabled.
    // The arcs layer splines the coarse waypoints from
    // /cruises/:id/geometry into smooth curves; until the fetch resolves
    // for a given cruise, each leg falls back to a 2-vertex direct chord.
    const geometryMap: CruiseGeometryMap = cruiseGeometry;
    const arcs = createCruiseArcsLayer(
      cruises,
      geometryMap,
      selectedCruiseId,
      (cruiseId: string) => {
        const cruise = cruises.find((c) => c.id === cruiseId);
        if (cruise) setCruiseSelection(cruise);
      }
    );
    const arrows = createCruiseArrowsLayer(cruises, geometryMap, selectedCruiseId);
    const ports = createCruisePortsLayer(cruises);
    const cruiseLayers = [arcs, arrows, ports].filter((l): l is Layer => l !== null);

    return [...base, ...cruiseLayers, ...(extraLayers ?? [])];
  }, [
    visMode,
    flights,
    routeData,
    trips,
    currentTime,
    handleFlightClick,
    handleAirportClick,
    themeColors,
    selectedIds,
    selectedCruiseId,
    setCruiseSelection,
    cruises,
    cruiseGeometry,
    extraLayers,
  ]);

  // No 3D modes remain — lighting effect is unused but kept as empty array for
  // the DeckGLOverlay API.
  const effects: LightingEffect[] = [];

  const handleTimeChange = useCallback((value: number | ((prev: number) => number)): void => {
    setCurrentTime((prev) => (typeof value === "function" ? value(prev) : value));
  }, []);

  // Native layer click handler (WebGL1 fallback)
  const handleNativeClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // If deck.gl handled this click, ignore
      if (deckClickedRef.current) {
        deckClickedRef.current = false;
        return;
      }

      const feature = e.features?.[0];
      if (feature) {
        if (feature.layer.id === NATIVE_ROUTE_LINE_ID && onRouteClick) {
          try {
            const ids = JSON.parse(feature.properties.flightIds as string) as string[];
            deckClickedRef.current = true; // prevent background clear
            onRouteClick(ids);
          } catch {
            // ignore
          }
          return;
        }
        if (feature.layer.id === NATIVE_AIRPORT_CIRCLE_ID) {
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          deckClickedRef.current = true;
          handleAirportClick(feature.properties.iata as string, coords[0], coords[1]);
          return;
        }
      }

      // Background click — clear selection
      clearSelection();
      clearCruiseSelection();
      setAirportIata(null);
      airportGeoRef.current = null;
      onResetTrip?.();
    },
    [onRouteClick, handleAirportClick, clearSelection, clearCruiseSelection, onResetTrip]
  );

  // Interactive layer IDs for native fallback (enables cursor: pointer on hover)
  const nativeInteractiveIds = !webgl2Available
    ? [NATIVE_ROUTE_LINE_ID, NATIVE_AIRPORT_CIRCLE_ID]
    : undefined;

  return (
    <div className="relative w-full h-full">
      <MapGL
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onLoad={() => setMapLoaded(true)}
        onMove={handleMapMove}
        onClick={handleNativeClick}
        interactiveLayerIds={nativeInteractiveIds}
        cursor={nativeInteractiveIds ? "pointer" : undefined}
      >
        {webgl2Available && mapLoaded && (
          <DeckGLOverlay layers={[...layers, ...pulseLayers, ...planeLayers]} effects={effects} />
        )}
        {!webgl2Available && visMode === "routes" && (
          <NativeRoutesLayer
            flights={flights}
            minRouteCount={minRouteCount}
            selectedIds={selectedIds}
          />
        )}
      </MapGL>

      {/* Subtle grid overlay — glassmorphism dark mode only */}
      {isDarkMode && mapTheme === "glassmorphism" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M 40 0 L 0 0 0 40' fill='none' stroke='%23818cf8' stroke-width='0.5'/%3E%3C%2Fsvg%3E")`,
            opacity: 0.06,
          }}
        />
      )}

      {/* Time slider — bottom center, trips mode only */}
      {visMode === "trips" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
          <TimeSlider
            min={timeRange.min}
            max={timeRange.max}
            current={currentTime}
            onChange={handleTimeChange}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
          />
        </div>
      )}

      {tooltipVisible && highlightMode === "group" && selectedFlights.length > 1 && (
        <TripTooltip
          flights={selectedFlights}
          screenX={tooltipPos.x}
          screenY={tooltipPos.y}
          mode="routes"
          onClose={() => {
            clearSelection();
            setTooltipVisible(false);
            onResetTrip?.();
          }}
          onShowDetails={() => {
            setTooltipVisible(false);
            showDetails(selectedFlights, "route-details");
          }}
        />
      )}

      {tooltipVisible && highlightMode !== "group" && selectedFlights.length > 0 && (
        <MapTooltip
          flight={selectedFlights[0]}
          screenX={tooltipPos.x}
          screenY={tooltipPos.y}
          onEdit={(flight) => {
            clearSelection();
            onEdit?.(flight);
          }}
          onClose={() => {
            clearSelection();
            setTooltipVisible(false);
          }}
        />
      )}

      {airportIata && (
        <AirportTooltip
          iata={airportIata}
          screenX={airportPos.x}
          screenY={airportPos.y}
          flights={flightList ?? []}
          onClose={() => {
            setAirportIata(null);
            airportGeoRef.current = null;
          }}
        />
      )}

      {selectedCruise !== null && (
        <CruiseTooltip cruise={selectedCruise} onClose={clearCruiseSelection} />
      )}

      {!webgl2Available && (
        <div
          className="absolute bottom-2 left-2 z-10 text-xs px-2 py-1 rounded"
          style={{
            background: "rgba(0,0,0,0.6)",
            color: "rgba(255,200,50,0.9)",
          }}
        >
          WebGL2 unavailable — flight routes disabled
        </div>
      )}
    </div>
  );
}
