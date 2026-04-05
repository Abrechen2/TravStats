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
import { TimeSlider } from "./TimeSlider";
import { useThemeStore } from "../store/themeStore";
import { MAP_LAYER_COLORS } from "../types/mapTheme";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import { computeBbox, arcPosition, easeInOut } from "../utils/mapAnimationHelpers";
import { MapTooltip } from "./MapTooltip";

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
  onFlightClick?: (flightId: string) => void;
  onEdit?: (flight: Flight) => void;
}

export function DeckGLMap({
  flights,
  visMode,
  minRouteCount = 1,
  onFlightClick,
  onEdit,
}: DeckGLMapProps): JSX.Element {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const mapTheme = useThemeStore((state) => state.mapTheme);
  const themeColors = MAP_LAYER_COLORS[mapTheme];
  const mapRef = useRef<MapRef>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);

  // Store subscription
  const { selectedIds, selectedFlights, clearSelection } = useFlightSelectionStore();

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

  // Plane animation
  const [planePositions, setPlanePositions] = useState<Array<[number, number]>>([]);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setPlanePositions([]);

    if (selectedFlights.length === 0) return;

    const legs: Array<{ source: [number, number]; target: [number, number] }> = selectedFlights
      .filter((f) => f.depLon != null && f.depLat != null && f.arrLon != null && f.arrLat != null)
      .map((f) => ({
        source: [f.depLon, f.depLat] as [number, number],
        target: [f.arrLon, f.arrLat] as [number, number],
      }));

    if (legs.length === 0) return;

    const LEG_DURATION = 1500;
    const DELAY_AFTER_FLYTO = 500;
    const totalDuration = legs.length * LEG_DURATION;
    let startTime: number | null = null;

    const animate = (ts: number): void => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime - DELAY_AFTER_FLYTO;
      if (elapsed < 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const positions: Array<[number, number]> = legs.map((leg, i) => {
        const legStart = i * LEG_DURATION;
        const legElapsed = elapsed - legStart;
        if (legElapsed < 0) return leg.source;
        if (legElapsed >= LEG_DURATION) return leg.target;
        const t = easeInOut(legElapsed / LEG_DURATION);
        return arcPosition(leg.source, leg.target, t);
      });

      setPlanePositions(positions);

      if (elapsed < totalDuration) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [selectedFlights]);

  const planeLayers = useMemo((): Layer[] => {
    if (planePositions.length === 0) return [];
    return [
      new TextLayer({
        id: "plane-marker",
        data: planePositions.map((position, i) => ({ position, index: i })),
        getText: () => "✈",
        getPosition: (d: { position: [number, number] }) => d.position,
        getSize: 20,
        getColor: [255, 255, 255, 230] as [number, number, number, number],
        getAngle: 0,
        fontFamily: "Arial, sans-serif",
        billboard: true,
      }),
    ];
  }, [planePositions]);

  // Airport pulse
  const [pulsePhase, setPulsePhase] = useState(0);
  const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pulseIntervalRef.current) {
      clearInterval(pulseIntervalRef.current);
      pulseIntervalRef.current = null;
    }
    setPulsePhase(0);
    if (selectedFlights.length === 0) return;

    pulseIntervalRef.current = setInterval(() => {
      setPulsePhase((p) => (p + 1) % 3);
    }, 800);

    return () => {
      if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    };
  }, [selectedFlights]);

  const pulseLayers = useMemo((): Layer[] => {
    if (selectedFlights.length === 0) return [];

    const pts = selectedFlights.flatMap((f) => {
      const res: Array<[number, number]> = [];
      if (f.depLon != null && f.depLat != null) res.push([f.depLon, f.depLat]);
      if (f.arrLon != null && f.arrLat != null) res.push([f.arrLon, f.arrLat]);
      return res;
    });

    const seen = new Set<string>();
    const unique = pts.filter(([lon, lat]) => {
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const BASE_RADIUS = 80000;
    const rings: Array<{ multiplier: number; opacities: [number, number, number] }> = [
      { multiplier: 1, opacities: [200, 80, 20] },
      { multiplier: 2, opacities: [80, 200, 80] },
      { multiplier: 3.5, opacities: [20, 80, 200] },
    ];

    return rings.map(
      ({ multiplier, opacities }) =>
        new ScatterplotLayer({
          id: `pulse-ring-${multiplier}`,
          data: unique.map((position) => ({ position })),
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: BASE_RADIUS * multiplier,
          getFillColor: [0, 0, 0, 0] as [number, number, number, number],
          getLineColor: [129, 140, 248, opacities[pulsePhase]] as [number, number, number, number],
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          pickable: false,
        })
    );
  }, [selectedFlights, pulsePhase]);

  // Tooltip state
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    setTooltipVisible(false);
    if (selectedFlights.length === 0) return;

    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map || selectedFlights.length === 0) return;

      const f = selectedFlights[0];
      if (f.depLon == null || f.arrLon == null || f.depLat == null || f.arrLat == null) return;

      const midLon = (f.depLon + f.arrLon) / 2;
      const midLat = (f.depLat + f.arrLat) / 2;
      const screenPt = map.project([midLon, midLat]);
      setTooltipPos({ x: screenPt.x, y: screenPt.y });
      setTooltipVisible(true);
    }, 1800);

    return () => clearTimeout(timer);
  }, [selectedFlights]);

  const layers = useMemo((): Layer[] => {
    switch (visMode) {
      case "routes": {
        const baseLayers = createRoutesLayers(
          flights,
          minRouteCount,
          onFlightClick,
          themeColors,
          0.3
        );

        if (selectedIds.length === 0) return baseLayers;

        const selectedFeatures = flights.filter((f) => selectedIds.includes(f.properties.id));
        const nonSelectedFeatures = flights.filter((f) => !selectedIds.includes(f.properties.id));

        const dimmedLayers = createRoutesLayers(
          nonSelectedFeatures,
          minRouteCount,
          onFlightClick,
          themeColors,
          0.3,
          0.08,
          "-dimmed"
        );

        const highlightLayers = createRoutesLayers(
          selectedFeatures,
          1,
          onFlightClick,
          themeColors,
          0.3,
          1,
          "-highlight"
        );

        const glowLayers = createRoutesLayers(
          selectedFeatures,
          1,
          undefined,
          themeColors,
          0.3,
          0.35,
          "-glow"
        );

        return [...dimmedLayers, ...glowLayers, ...highlightLayers];
      }
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
  }, [
    visMode,
    flights,
    minRouteCount,
    trips,
    currentTime,
    onFlightClick,
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
        onClick={() => {
          clearSelection();
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

      {tooltipVisible && selectedFlights.length > 0 && (
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
    </div>
  );
}
