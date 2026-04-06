import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Map, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { GeoJSONFeature, Flight } from "../types";
import type { VisMode } from "../types/visMode";
import { createRoutesLayers } from "./layers/routesLayer";
import { createHeatmapLayer } from "./layers/heatmapLayer";
import { createHexagonLayer } from "./layers/hexagonLayer";
import { createColumnsLayer } from "./layers/columnsLayer";
import { createTripsLayer, buildTripsData, getTimeRange } from "./layers/tripsLayer";
import { createContourLayer } from "./layers/contourLayer";
import { createTripRoutesLayer } from "./layers/tripRoutesLayer";
import { TimeSlider } from "./TimeSlider";
import { useThemeStore } from "../store/themeStore";
import { MAP_LAYER_COLORS } from "../types/mapTheme";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import { computeBbox } from "../utils/mapAnimationHelpers";
import { usePlaneAnimation } from "../hooks/usePlaneAnimation";
import { usePulseAnimation } from "../hooks/usePulseAnimation";
import { MapTooltip } from "./MapTooltip";
import { TripTooltip } from "./TripTooltip";
import { AirportTooltip } from "./AirportTooltip";

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

const LIGHT_MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Lighting effect for 3D modes — creates shadows/highlights on hexagons and columns
const ambientLight = new AmbientLight({ color: [255, 255, 255], intensity: 0.6 });
const directionalLight = new DirectionalLight({
  color: [255, 255, 255],
  intensity: 1.8,
  direction: [-2, -3, -1],
});
const lightingEffect = new LightingEffect({ ambientLight, directionalLight });

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
  visMode: VisMode;
  minRouteCount?: number;
  onFlightClick?: (flightId: string) => void;
  onEdit?: (flight: Flight) => void;
  tripList?: Array<{ id: string; color: string }>;
  flightList?: Flight[];
  activeTripId?: string | null;
  onResetTrip?: () => void;
}

export function DeckGLMap({
  flights,
  visMode,
  minRouteCount = 1,
  onFlightClick,
  onEdit,
  tripList,
  flightList,
  activeTripId,
  onResetTrip,
}: DeckGLMapProps): JSX.Element {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const mapTheme = useThemeStore((state) => state.mapTheme);
  const themeColors = MAP_LAYER_COLORS[mapTheme];
  const mapRef = useRef<MapRef>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const deckClickedRef = useRef(false);

  // Store subscription
  const { selectedIds, selectedFlights, highlightMode, clearSelection } = useFlightSelectionStore();

  // Auto-pitch: 3D layers need pitch > 0 to be visible
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const is3D = visMode === "hexagon" || visMode === "columns";
    map.easeTo({ pitch: is3D ? 45 : 0, duration: 600 });
  }, [visMode]);

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
    }, 1800);

    return () => clearTimeout(timer);
  }, [selectedFlights, highlightMode, recomputeAllPositions]);

  // Wrap onFlightClick so that a deck.gl layer click sets the guard ref BEFORE the
  // Map onClick fires and would otherwise clear the selection immediately (Bug 1).
  const handleFlightClick = useCallback(
    (flightId: string): void => {
      deckClickedRef.current = true;
      setAirportIata(null);
      airportGeoRef.current = null;
      onFlightClick?.(flightId);
    },
    [onFlightClick]
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

  const layers = useMemo((): Layer[] => {
    switch (visMode) {
      case "routes":
        return createRoutesLayers(
          flights,
          minRouteCount,
          handleFlightClick,
          themeColors,
          0.3,
          selectedIds,
          handleAirportClick
        );
      case "heatmap":
        return [createHeatmapLayer(flights)];
      case "hexagon":
        return [createHexagonLayer(flights, themeColors)];
      case "columns":
        return [createColumnsLayer(flights, themeColors)];
      case "trips":
        return [createTripsLayer(trips, currentTime)];
      case "contour":
        return [createContourLayer(flights)];
      case "trip-routes":
        return createTripRoutesLayer(
          flightList ?? [],
          tripList ?? [],
          activeTripId,
          handleFlightClick,
          selectedIds,
          handleAirportClick
        );
      default:
        return [];
    }
  }, [
    visMode,
    flights,
    minRouteCount,
    trips,
    tripList,
    flightList,
    activeTripId,
    currentTime,
    handleFlightClick,
    handleAirportClick,
    themeColors,
    selectedIds,
  ]);

  // Only enable lighting for 3D modes where it makes a visual difference
  const effects = useMemo(
    () => (visMode === "hexagon" || visMode === "columns" ? [lightingEffect] : []),
    [visMode]
  );

  const handleTimeChange = useCallback((value: number | ((prev: number) => number)): void => {
    setCurrentTime((prev) => (typeof value === "function" ? value(prev) : value));
  }, []);

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onMove={handleMapMove}
        onClick={() => {
          // If deck.gl handled this click (e.g. arc click), ignore the Map event (Bug 1)
          if (deckClickedRef.current) {
            deckClickedRef.current = false;
            return;
          }
          clearSelection();
          setAirportIata(null);
          airportGeoRef.current = null;
          onResetTrip?.();
        }}
      >
        <DeckGLOverlay layers={[...layers, ...pulseLayers, ...planeLayers]} effects={effects} />
      </Map>

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
          onClose={() => {
            clearSelection();
            setTooltipVisible(false);
            onResetTrip?.();
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
    </div>
  );
}
