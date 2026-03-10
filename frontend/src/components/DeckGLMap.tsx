import { useState, useMemo, useCallback } from "react";
import Map, { useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { GeoJSONFeature } from "../types";
import type { VisMode } from "../types/visMode";
import { createRoutesLayers } from "./layers/routesLayer";
import { createHeatmapLayer } from "./layers/heatmapLayer";
import { createHexagonLayer } from "./layers/hexagonLayer";
import { createColumnsLayer } from "./layers/columnsLayer";
import { createTripsLayer, buildTripsData, getTimeRange } from "./layers/tripsLayer";
import { TimeSlider } from "./TimeSlider";
import { useThemeStore } from "../store/themeStore";

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

const LIGHT_MAP_STYLE = "https://demotiles.maplibre.org/style.json";
const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

interface DeckOverlayProps {
  layers: Layer[];
}

function DeckGLOverlay({ layers }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ layers }), {
    position: "top-left",
  });
  overlay.setProps({ layers });
  return null;
}

interface DeckGLMapProps {
  flights: GeoJSONFeature[];
  visMode: VisMode;
  minRouteCount?: number;
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
}

export function DeckGLMap({ flights, visMode, minRouteCount = 1 }: DeckGLMapProps): JSX.Element {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);

  const trips = useMemo(
    () => (visMode === "trips" ? buildTripsData(flights) : []),
    [flights, visMode]
  );

  const timeRange = useMemo(
    () => (trips.length > 0 ? getTimeRange(trips) : { min: 0, max: 1 }),
    [trips]
  );

  const effectiveTime = currentTime !== 0 ? currentTime : timeRange.min;

  const layers = useMemo((): Layer[] => {
    switch (visMode) {
      case "routes":
        return createRoutesLayers(flights, minRouteCount);
      case "heatmap":
        return [createHeatmapLayer(flights)];
      case "hexagon":
        return [createHexagonLayer(flights)];
      case "columns":
        return [createColumnsLayer(flights)];
      case "trips":
        return [createTripsLayer(trips, effectiveTime)];
      default:
        return [];
    }
  }, [visMode, flights, minRouteCount, trips, effectiveTime]);

  const handleTimeChange = useCallback((value: number | ((prev: number) => number)): void => {
    setCurrentTime((prev) => (typeof value === "function" ? value(prev) : value));
  }, []);

  return (
    <div className="relative w-full h-full">
      <Map
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
      >
        <DeckGLOverlay layers={layers} />
      </Map>

      {/* Time slider — bottom center, trips mode only */}
      {visMode === "trips" && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <TimeSlider
            min={timeRange.min}
            max={timeRange.max}
            current={effectiveTime}
            onChange={handleTimeChange}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
          />
        </div>
      )}
    </div>
  );
}
