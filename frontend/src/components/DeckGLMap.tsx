import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Map, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LightingEffect, AmbientLight, DirectionalLight } from "@deck.gl/core";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { GeoJSONFeature } from "../types";
import type { VisMode } from "../types/visMode";
import { createRoutesLayers } from "./layers/routesLayer";
import { createHeatmapLayer } from "./layers/heatmapLayer";
import { createHexagonLayer } from "./layers/hexagonLayer";
import { createColumnsLayer } from "./layers/columnsLayer";
import { createTripsLayer, buildTripsData, getTimeRange } from "./layers/tripsLayer";
import { createContourLayer } from "./layers/contourLayer";
import { TimeSlider } from "./TimeSlider";
import { useThemeStore } from "../store/themeStore";
import { MAP_LAYER_COLORS } from "../types/mapTheme";

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
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers, effects }), {
    position: "top-left",
  });
  overlay.setProps({ layers, effects });
  return null;
}

interface DeckGLMapProps {
  flights: GeoJSONFeature[];
  visMode: VisMode;
  minRouteCount?: number;
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
}

export function DeckGLMap({
  flights,
  visMode,
  minRouteCount = 1,
  onFlightClick,
}: DeckGLMapProps): JSX.Element {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const mapTheme = useThemeStore((state) => state.mapTheme);
  const themeColors = MAP_LAYER_COLORS[mapTheme];
  const mapRef = useRef<MapRef>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);

  // Auto-pitch: 3D layers need pitch > 0 to be visible
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const is3D = visMode === "hexagon" || visMode === "columns";
    map.easeTo({ pitch: is3D ? 45 : 0, duration: 600 });
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

  const layers = useMemo((): Layer[] => {
    switch (visMode) {
      case "routes":
        return createRoutesLayers(flights, minRouteCount, onFlightClick, themeColors);
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
      default:
        return [];
    }
  }, [visMode, flights, minRouteCount, trips, currentTime, onFlightClick, themeColors]);

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
        mapStyle={isDarkMode && mapTheme !== "glassmorphism" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
      >
        <DeckGLOverlay layers={layers} effects={effects} />
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
    </div>
  );
}
