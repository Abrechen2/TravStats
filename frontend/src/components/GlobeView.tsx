import { useEffect, useRef, useMemo, useState } from "react";
import Globe from "react-globe.gl";
import type { GeoJSONFeature } from "../types";
import { useThemeStore } from "../store/themeStore";
import { escapeHtml } from "../lib/escapeHtml";

// #region agent log
const debugLog = (
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  hypothesisId?: string
) => {
  // Only log in development mode
  if (import.meta.env.MODE !== "development") {
    return;
  }

  // Development-only console logging
  console.log(`[DEBUG ${hypothesisId || "?"}] ${location}: ${message}`, data);

  // Store in localStorage for development debugging (max 100 entries)
  try {
    const logEntry = {
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: "debug-session",
      runId: "run1",
      hypothesisId,
    };
    const stored = localStorage.getItem("debug-logs") || "[]";
    const logs = JSON.parse(stored);
    logs.push(logEntry);
    if (logs.length > 100) logs.shift();
    localStorage.setItem("debug-logs", JSON.stringify(logs));
  } catch (e) {
    // Ignore localStorage errors
  }
};

// Log before Globe import
debugLog(
  "GlobeView.tsx:import",
  "GlobeView module loading",
  {
    hasGlobe: typeof Globe !== "undefined",
    threeAvailable:
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).THREE !== undefined,
  },
  "D"
);
// #endregion

interface GlobeViewProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  minRouteCount?: number;
}

// Helper function to create bidirectional route key (FRA-JFK === JFK-FRA)
const createRouteKey = (airportA: string, airportB: string): string => {
  // Sort alphabetically to ensure bidirectional routes are treated as the same
  return airportA < airportB ? `${airportA}-${airportB}` : `${airportB}-${airportA}`;
};

// Calculate dynamic heatmap thresholds based on data distribution
const calculateHeatmapThresholds = (
  counts: number[]
): { q25: number; q50: number; q75: number; max: number } => {
  if (counts.length === 0) return { q25: 1, q50: 2, q75: 3, max: 5 };

  const sorted = [...counts].sort((a, b) => a - b);
  const len = sorted.length;
  const max = sorted[len - 1];
  const min = sorted[0];

  // If all values are the same, create artificial thresholds
  if (max === min) {
    return {
      q25: Math.floor(min * 0.75),
      q50: Math.floor(min * 0.85),
      q75: Math.floor(min * 0.95),
      max: max,
    };
  }

  // Use actual quantiles, but ensure they're distinct
  const q25Index = Math.floor(len * 0.25);
  const q50Index = Math.floor(len * 0.5);
  const q75Index = Math.floor(len * 0.75);

  let q25 = sorted[q25Index] || min;
  let q50 = sorted[q50Index] || min + Math.floor((max - min) * 0.33);
  let q75 = sorted[q75Index] || min + Math.floor((max - min) * 0.66);

  // Ensure thresholds are strictly increasing
  if (q50 <= q25) q50 = q25 + Math.max(1, Math.floor((max - q25) * 0.4));
  if (q75 <= q50) q75 = q50 + Math.max(1, Math.floor((max - q50) * 0.5));

  return { q25, q50, q75, max };
};

// Heatmap color based on dynamic quantiles
const getHeatmapColor = (
  count: number,
  thresholds: { q25: number; q50: number; q75: number }
): string => {
  // Use > instead of >= to ensure better distribution when values are equal
  if (count > thresholds.q75) return "#ef4444"; // red - top 25%
  if (count > thresholds.q50) return "#f59e0b"; // orange - 50-75%
  if (count > thresholds.q25) return "#eab308"; // yellow - 25-50%
  return "#10b981"; // green - bottom 25%
};

// Helper function to calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Calculate base arc altitude based on distance
const getBaseArcAltitude = (distance: number): number => {
  // New optimized values:
  // Short flights (< 1000km): 0.02 - 0.04 (reduziert von 0.05-0.075)
  // Medium flights (1000-5000km): 0.04 - 0.12
  // Long flights (5000-10000km): 0.12 - 0.25
  // Very long flights (> 10000km): 0.25 - 0.40 (erhöht damit sie sichtbar bleiben)

  if (distance < 1000) {
    // Kurze Flüge: niedrig halten
    return 0.02 + (distance / 1000) * 0.02;
  } else if (distance < 5000) {
    // Mittlere Flüge
    return 0.04 + ((distance - 1000) / 4000) * 0.08;
  } else if (distance < 10000) {
    // Lange Flüge
    return 0.12 + ((distance - 5000) / 5000) * 0.13;
  } else {
    // Sehr lange Flüge: deutlich höher damit sie sichtbar bleiben
    return Math.min(0.25 + ((distance - 10000) / 10000) * 0.15, 0.45);
  }
};

// Static arc altitude based only on distance (no zoom adjustment)
const getStaticArcAltitude = (
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): number => {
  const distance = calculateDistance(startLat, startLng, endLat, endLng);
  return getBaseArcAltitude(distance);
};

// Note: selectedFlightId is available for future implementation (e.g., highlighting selected flight on globe)
// Type for react-globe.gl component ref
type GlobeInstance = {
  pointOfView: (
    point?: { lat: number; lng: number; altitude: number },
    transitionDuration?: number
  ) => { lat: number; lng: number; altitude: number } | void;
  controls: () => { autoRotate: boolean; autoRotateSpeed: number };
};

// Types for Globe arc and point data
interface ArcData {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  altitude: number;
  count: number;
  departure: { iata?: string; name?: string };
  arrival: { iata?: string; name?: string };
  flights: GeoJSONFeature[];
}

interface PointData {
  lat: number;
  lng: number;
  size: number;
  name: string;
  code: string;
  iata?: string;
}

export default function GlobeView({
  flights = [],
  selectedFlightId: _selectedFlightId,
  onFlightClick,
  minRouteCount = 1,
}: GlobeViewProps): JSX.Element {
  // #region agent log
  debugLog(
    "GlobeView.tsx:render-start",
    "GlobeView component rendering",
    {
      flightsCount: flights.length,
      minRouteCount,
      hasGlobe: typeof Globe !== "undefined",
      threeAvailable:
        typeof window !== "undefined" &&
        (window as unknown as Record<string, unknown>).THREE !== undefined,
    },
    "D"
  );
  // #endregion

  const globeRef = useRef<GlobeInstance | null>(null);
  const themeStore = useThemeStore();
  const isDarkMode = themeStore?.isDarkMode ?? false;
  const [autoRotate, setAutoRotate] = useState(false);
  const [cameraAltitude, setCameraAltitude] = useState(2.2);

  // #region agent log
  useEffect(() => {
    debugLog(
      "GlobeView.tsx:mounted",
      "GlobeView component mounted",
      {
        hasGlobeRef: !!globeRef.current,
      },
      "D"
    );
  }, []);
  // #endregion

  // Center globe initially
  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.pointOfView({ lat: 0, lng: 0, altitude: 2.2 }, 0);
    }
  }, []);

  // Control auto-rotation
  useEffect(() => {
    if (globeRef.current && globeRef.current.controls()) {
      globeRef.current.controls().autoRotate = autoRotate;
      globeRef.current.controls().autoRotateSpeed = 0.3;
    }
  }, [autoRotate]);

  // Track camera altitude for dynamic arc scaling (using ref to avoid re-creating interval)
  const cameraAltitudeRef = useRef(cameraAltitude);
  cameraAltitudeRef.current = cameraAltitude;

  useEffect(() => {
    if (globeRef.current) {
      const interval = setInterval(() => {
        if (globeRef.current) {
          const pov = globeRef.current.pointOfView();
          if (pov && pov.altitude !== cameraAltitudeRef.current) {
            setCameraAltitude(pov.altitude);
          }
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, []);

  // Calculate dynamic stroke width based on camera zoom
  const dynamicStroke = useMemo(() => {
    const baseStroke = 0.3; // Reduced from 0.5 for thinner lines
    // Näher gezoomt (kleinere altitude) = dünnere Linien
    // Weiter weg (größere altitude) = dickere Linien
    const zoomFactor = cameraAltitude / 2.5;
    return Math.min(Math.max(baseStroke * zoomFactor, 0.08), 0.7); // Reduced range for thinner lines
  }, [cameraAltitude]);

  // Static point radius - no dynamic scaling based on zoom
  // Note: Filtering is now handled by parent component (DashboardPage) via main filters

  // Convert flights to arcs format with route aggregation and dynamic heatmap colors
  const { arcsData, heatmapThresholds } = useMemo(() => {
    // Define types for route aggregation
    interface RouteData {
      count: number;
      startLat: number;
      startLng: number;
      endLat: number;
      endLng: number;
      flights: typeof flights;
      departure: { iata?: string; name?: string; icao?: string };
      arrival: { iata?: string; name?: string; icao?: string };
    }

    // First, aggregate flights by route
    const routeMap = new Map<string, RouteData>();

    (flights || []).forEach((flight) => {
      if (!flight?.properties || !flight?.geometry) return;

      const coords = flight.geometry.coordinates;
      if (coords.length < 2) return;

      const start = coords[0];
      const end = coords[coords.length - 1];

      const validCoords =
        Number.isFinite(start[0]) &&
        Number.isFinite(start[1]) &&
        Number.isFinite(end[0]) &&
        Number.isFinite(end[1]) &&
        !(start[0] === 0 && start[1] === 0) &&
        !(end[0] === 0 && end[1] === 0);

      if (!validCoords) return;

      const depIATA =
        flight.properties.departureAirport?.iata ||
        flight.properties.departureAirport?.icao ||
        "UNKNOWN";
      const arrIATA =
        flight.properties.arrivalAirport?.iata ||
        flight.properties.arrivalAirport?.icao ||
        "UNKNOWN";
      // Create bidirectional route key (FRA-JFK === JFK-FRA)
      const routeKey = createRouteKey(depIATA, arrIATA);

      if (!routeMap.has(routeKey)) {
        routeMap.set(routeKey, {
          count: 1,
          startLat: start[1],
          startLng: start[0],
          endLat: end[1],
          endLng: end[0],
          flights: [flight],
          departure: flight.properties.departureAirport,
          arrival: flight.properties.arrivalAirport,
        });
      } else {
        const route = routeMap.get(routeKey)!;
        route.count++;
        route.flights.push(flight);
      }
    });

    // Calculate thresholds
    const counts = Array.from(routeMap.values()).map((r) => r.count);
    const thresholds = calculateHeatmapThresholds(counts);

    // Create arcs with dynamic colors and apply route frequency filter
    const arcs = Array.from(routeMap.entries())
      .filter(([_, route]) => route.count >= minRouteCount) // Apply min route count filter
      .map(([routeKey, route]) => ({
        routeKey,
        count: route.count,
        startLat: route.startLat,
        startLng: route.startLng,
        endLat: route.endLat,
        endLng: route.endLng,
        flights: route.flights,
        departure: route.departure,
        arrival: route.arrival,
        color: getHeatmapColor(route.count, thresholds),
        altitude: getStaticArcAltitude(route.startLat, route.startLng, route.endLat, route.endLng),
      }));

    return { arcsData: arcs, heatmapThresholds: thresholds };
  }, [flights, minRouteCount]);

  // Extract airport points with proper deduplication (using filtered flights)
  const pointsData = useMemo(() => {
    const airportMap = new Map();

    (flights || []).forEach((flight) => {
      if (!flight?.properties || !flight?.geometry) return;

      const coords = flight.geometry.coordinates;
      if (coords.length < 2) return;

      // Departure airport - prefer codes, fallback to coordinate bucket
      const depLat = coords[0][1];
      const depLng = coords[0][0];
      const depIata = flight.properties.departureAirport?.iata;
      const depIcao = flight.properties.departureAirport?.icao;
      const depCode = depIata || depIcao || "Unknown";
      const depValid = [depLat, depLng].every(Number.isFinite) && !(depLat === 0 && depLng === 0);

      if (depValid) {
        const depKey =
          depCode !== "Unknown" ? depCode : `${depLat.toFixed(2)}_${depLng.toFixed(2)}`;

        if (!airportMap.has(depKey)) {
          airportMap.set(depKey, {
            lat: depLat,
            lng: depLng,
            name: flight.properties.departureAirport?.name || depCode,
            code: depCode,
            size: 0,
          });
        } else {
          const existing = airportMap.get(depKey);
          if ((depIata || depIcao) && existing.code === "Unknown") {
            existing.code = depCode;
            existing.name = flight.properties.departureAirport?.name || depCode;
          }
        }
        airportMap.get(depKey).size++;
      }

      // Arrival airport - prefer codes, fallback to coordinate bucket
      const arrLat = coords[coords.length - 1][1];
      const arrLng = coords[coords.length - 1][0];
      const arrIata = flight.properties.arrivalAirport?.iata;
      const arrIcao = flight.properties.arrivalAirport?.icao;
      const arrCode = arrIata || arrIcao || "Unknown";
      const arrValid = [arrLat, arrLng].every(Number.isFinite) && !(arrLat === 0 && arrLng === 0);

      if (arrValid) {
        const arrKey =
          arrCode !== "Unknown" ? arrCode : `${arrLat.toFixed(2)}_${arrLng.toFixed(2)}`;

        if (!airportMap.has(arrKey)) {
          airportMap.set(arrKey, {
            lat: arrLat,
            lng: arrLng,
            name: flight.properties.arrivalAirport?.name || arrCode,
            code: arrCode,
            size: 0,
          });
        } else {
          const existing = airportMap.get(arrKey);
          if ((arrIata || arrIcao) && existing.code === "Unknown") {
            existing.code = arrCode;
            existing.name = flight.properties.arrivalAirport?.name || arrCode;
          }
        }
        airportMap.get(arrKey).size++;
      }
    });

    return Array.from(airportMap.values());
  }, [flights]);

  return (
    <div
      className="h-full w-full relative flex items-center justify-center"
      style={{ touchAction: "pan-x pan-y pinch-zoom" }}
    >
      {/* Control Panel */}
      <div
        className="absolute bottom-4 left-4 z-[9999] bg-[var(--bg-surface)] rounded-lg shadow-lg p-4 border border-[var(--color-border)]"
        style={{ touchAction: "auto", pointerEvents: "auto" }}
      >
        {/* Auto-Rotation Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => setAutoRotate(e.target.checked)}
            className="w-4 h-4 text-blue-600 bg-[var(--bg-elevated)] border-[var(--color-border)] rounded focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-[var(--text-primary)]">🌍 Auto-Rotation</span>
        </label>
      </div>

      {/* Heatmap Legend */}
      {arcsData.length > 0 && (
        <div
          className="absolute bottom-4 right-4 z-[9999] bg-[var(--bg-surface)] rounded-lg shadow-lg p-3 border border-[var(--color-border)]"
          style={{ touchAction: "auto", pointerEvents: "auto" }}
        >
          <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">
            Routenfrequenz
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#10b981" }}></div>
              <span className="text-xs text-[var(--text-muted)]">1-{heatmapThresholds.q25}x</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#eab308" }}></div>
              <span className="text-xs text-[var(--text-muted)]">
                {heatmapThresholds.q25 + 1}-{heatmapThresholds.q50}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#f59e0b" }}></div>
              <span className="text-xs text-[var(--text-muted)]">
                {heatmapThresholds.q50 + 1}-{heatmapThresholds.q75}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: "#ef4444" }}></div>
              <span className="text-xs text-[var(--text-muted)]">
                {heatmapThresholds.q75 + 1}+ ({heatmapThresholds.max}x max)
              </span>
            </div>
          </div>
        </div>
      )}

      <Globe
        ref={globeRef}
        style={{ width: "100%", height: "100%" }}
        globeImageUrl="https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg"
        bumpImageUrl="https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png"
        backgroundImageUrl={null}
        // Arcs (Flight paths) - Dynamic lines that adjust with zoom
        arcsData={arcsData}
        arcColor={(arc: ArcData) => arc.color}
        arcStroke={dynamicStroke}
        arcStrokeOpacity={0.6}
        arcAltitude={(arc: ArcData) => arc.altitude}
        arcCurveResolution={64}
        arcDashLength={1}
        arcDashGap={0}
        arcDashInitialGap={() => 0}
        arcLabel={(arc: ArcData) => `
          <div style="
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: system-ui;
            font-size: 12px;
          ">
            <div style="font-weight: bold; margin-bottom: 4px;">
              ${escapeHtml(arc.departure?.iata || "UNK")} ↔ ${escapeHtml(arc.arrival?.iata || "UNK")}
            </div>
            <div style="font-size: 11px; opacity: 0.9; margin-bottom: 6px;">
              ${escapeHtml(arc.departure?.name || "Unknown")} ↔ ${escapeHtml(arc.arrival?.name || "Unknown")}
            </div>
            <div style="color: ${arc.color};">
              ${arc.count}x geflogen
            </div>
          </div>
        `}
        onArcClick={(arc: ArcData) => {
          if (onFlightClick && arc.flights && arc.flights.length > 0) {
            // Click on most recent flight in route
            const mostRecentFlight = arc.flights[arc.flights.length - 1];
            onFlightClick(mostRecentFlight.properties.id);
          }
        }}
        // Points (Airports) - Dynamic size based on zoom
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => (isDarkMode ? "#fbbf24" : "#f59e0b")}
        pointAltitude={0.01}
        pointRadius={(point: object) => {
          // Static radius calculation - no zoom-based scaling
          // Very small base size for better visibility
          const p = point as PointData;
          const baseRadius = Math.sqrt(p.size) * 0.08;
          return Math.min(baseRadius, 0.3); // Maximum size capped at 0.4
        }}
        pointLabel={(point: PointData) => `
          <div style="
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 6px 10px;
            border-radius: 4px;
            font-family: system-ui;
            font-size: 11px;
          ">
            <div style="font-weight: bold;">${escapeHtml(point.code)}</div>
            <div style="opacity: 0.8;">${escapeHtml(point.name)}</div>
            <div style="margin-top: 2px; color: #fbbf24;">
              ${point.size} flight${point.size !== 1 ? "s" : ""}
            </div>
          </div>
        `}
        // Globe settings
        atmosphereColor={isDarkMode ? "#4a5568" : "#3b82f6"}
        atmosphereAltitude={0.25}
        enablePointerInteraction={true}
        animateIn={true}
      />
    </div>
  );
}
