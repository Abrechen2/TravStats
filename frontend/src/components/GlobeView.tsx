import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import Globe from "react-globe.gl";
import type { GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import { useThemeStore } from "../store/themeStore";
import { escapeHtml } from "../lib/escapeHtml";
import { useTranslation } from "../hooks/useTranslation";
import { DOMAINS } from "../shared/domains";

interface GlobeViewProps {
  flights: GeoJSONFeature[];
  cruises?: Cruise[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  minRouteCount?: number;
}

const CRUISE_HEX_RGB = ((): { r: number; g: number; b: number } => {
  const hex = DOMAINS.cruise.color.replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
})();
const CRUISE_ARC_COLOR = `rgba(${CRUISE_HEX_RGB.r}, ${CRUISE_HEX_RGB.g}, ${CRUISE_HEX_RGB.b}, 0.85)`;
const CRUISE_PORT_COLOR = `rgba(${CRUISE_HEX_RGB.r}, ${CRUISE_HEX_RGB.g}, ${CRUISE_HEX_RGB.b}, 0.95)`;

interface CruiseArcDatum {
  type: "cruise";
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  altitude: number;
  cruiseId: string;
  cruiseLabel: string;
  fromPort: string;
  toPort: string;
}

interface CombinedArcDatum {
  type: "flight" | "cruise";
}

const createRouteKey = (airportA: string, airportB: string): string =>
  airportA < airportB ? `${airportA}-${airportB}` : `${airportB}-${airportA}`;

const calculateHeatmapThresholds = (
  counts: number[]
): { q25: number; q50: number; q75: number; max: number } => {
  if (counts.length === 0) return { q25: 1, q50: 2, q75: 3, max: 5 };

  const sorted = [...counts].sort((a, b) => a - b);
  const len = sorted.length;
  const max = sorted[len - 1];
  const min = sorted[0];

  if (max === min) {
    return {
      q25: Math.floor(min * 0.75),
      q50: Math.floor(min * 0.85),
      q75: Math.floor(min * 0.95),
      max,
    };
  }

  const q25 = sorted[Math.floor(len * 0.25)] ?? min;
  let q50 = sorted[Math.floor(len * 0.5)] ?? min + Math.floor((max - min) * 0.33);
  let q75 = sorted[Math.floor(len * 0.75)] ?? min + Math.floor((max - min) * 0.66);

  if (q50 <= q25) q50 = q25 + Math.max(1, Math.floor((max - q25) * 0.4));
  if (q75 <= q50) q75 = q50 + Math.max(1, Math.floor((max - q50) * 0.5));

  return { q25, q50, q75, max };
};

const getHeatmapColor = (
  count: number,
  thresholds: { q25: number; q50: number; q75: number }
): string => {
  if (count > thresholds.q75) return "#ef4444"; // red — hotspot
  if (count > thresholds.q50) return "#f97316"; // orange-500
  if (count > thresholds.q25) return "#e8a045"; // brand amber
  return "#64748b"; // slate-500 — muted
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const toRad = (deg: number): number => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getBaseArcAltitude = (distance: number): number => {
  if (distance < 1000) return 0.02 + (distance / 1000) * 0.02;
  if (distance < 5000) return 0.04 + ((distance - 1000) / 4000) * 0.08;
  if (distance < 10000) return 0.12 + ((distance - 5000) / 5000) * 0.13;
  return Math.min(0.25 + ((distance - 10000) / 10000) * 0.15, 0.45);
};

const getStaticArcAltitude = (
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): number => getBaseArcAltitude(calculateDistance(startLat, startLng, endLat, endLng));

type GlobeControls = {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (event: string, fn: () => void) => void;
  removeEventListener: (event: string, fn: () => void) => void;
};

type GlobeInstance = {
  pointOfView: (
    point?: { lat: number; lng: number; altitude: number },
    transitionDuration?: number
  ) => { lat: number; lng: number; altitude: number } | void;
  controls: () => GlobeControls;
};

interface ArcData {
  type: "flight";
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
}

export default function GlobeView({
  flights = [],
  cruises = [],
  onFlightClick,
  minRouteCount = 1,
}: GlobeViewProps): JSX.Element {
  const { t } = useTranslation(["map"]);
  const globeRef = useRef<GlobeInstance | null>(null);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [autoRotate, setAutoRotate] = useState(false);
  const [cameraAltitude, setCameraAltitude] = useState(2.2);

  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.pointOfView({ lat: 0, lng: 0, altitude: 2.2 }, 0);
    }
  }, []);

  useEffect(() => {
    if (globeRef.current?.controls()) {
      globeRef.current.controls().autoRotate = autoRotate;
      globeRef.current.controls().autoRotateSpeed = 0.3;
    }
  }, [autoRotate]);

  // Camera-altitude tracking. Previously polled pointOfView() every 500ms
  // even when the camera was idle; now subscribes to the OrbitControls
  // 'change' event which fires only on user input (drag / wheel / pinch).
  // Updates state only when altitude actually crossed a noticeable
  // threshold so dynamicStroke + arcCurveResolution memos don't churn on
  // sub-pixel changes during a slow drag.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    if (!controls?.addEventListener) return;
    const onChange = (): void => {
      const pov = globe.pointOfView();
      if (!pov) return;
      // Only re-render when altitude moves more than ~5% — keeps dependent
      // memos cheap during slow camera moves.
      setCameraAltitude((prev) => (Math.abs(pov.altitude - prev) > 0.05 ? pov.altitude : prev));
    };
    controls.addEventListener("change", onChange);
    return () => controls.removeEventListener("change", onChange);
  }, []);

  const dynamicStroke = useMemo(() => {
    const zoomFactor = cameraAltitude / 2.5;
    return Math.min(Math.max(0.3 * zoomFactor, 0.08), 0.7);
  }, [cameraAltitude]);

  // Arc tesselation LOD. The default resolution of 64 segments per arc
  // is overkill when the user is zoomed all the way out (altitude > 3 ≈
  // a full hemisphere visible) — at that scale 32 segments still curves
  // smoothly. Halving vertex count for the wide view ~halves Three.js
  // geometry work for the route layer when there are many arcs.
  const arcResolution = useMemo<number>(() => (cameraAltitude > 3 ? 32 : 64), [cameraAltitude]);

  const { arcsData, heatmapThresholds } = useMemo(() => {
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

    const routeMap = new Map<string, RouteData>();

    for (const flight of flights) {
      if (!flight?.properties || !flight?.geometry) continue;
      const coords = flight.geometry.coordinates;
      if (coords.length < 2) continue;

      const start = coords[0];
      const end = coords[coords.length - 1];
      const validCoords =
        Number.isFinite(start[0]) &&
        Number.isFinite(start[1]) &&
        Number.isFinite(end[0]) &&
        Number.isFinite(end[1]) &&
        !(start[0] === 0 && start[1] === 0) &&
        !(end[0] === 0 && end[1] === 0);
      if (!validCoords) continue;

      const depIATA =
        flight.properties.departureAirport?.iata ||
        flight.properties.departureAirport?.icao ||
        "UNKNOWN";
      const arrIATA =
        flight.properties.arrivalAirport?.iata ||
        flight.properties.arrivalAirport?.icao ||
        "UNKNOWN";
      const key = createRouteKey(depIATA, arrIATA);

      if (!routeMap.has(key)) {
        routeMap.set(key, {
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
        const route = routeMap.get(key)!;
        route.count++;
        route.flights.push(flight);
      }
    }

    const counts = Array.from(routeMap.values()).map((r) => r.count);
    const thresholds = calculateHeatmapThresholds(counts);

    const arcs: ArcData[] = Array.from(routeMap.values())
      .filter((route) => route.count >= minRouteCount)
      .map((route) => ({
        type: "flight" as const,
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

  // Cruise arcs: one per consecutive port-pair across all cruises. Sea-day
  // and unmatched stops are skipped. Distinct from flight arcs both visually
  // (sky-blue, dashed) and structurally (no heatmap bucketing — they all
  // get the same treatment, count would be misleading because most cruises
  // are unique routings rather than repeats of the same route).
  const cruiseArcsData = useMemo<CruiseArcDatum[]>(() => {
    const out: CruiseArcDatum[] = [];
    for (const c of cruises) {
      const orderedStops = c.stops
        .filter((s) => !s.isAtSea && s.port !== null)
        .map((s) => s.port!) as Array<{ id: number; name: string; lat: number; lon: number }>;
      const label = c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "Cruise";
      for (let i = 0; i < orderedStops.length - 1; i++) {
        const a = orderedStops[i];
        const b = orderedStops[i + 1];
        out.push({
          type: "cruise",
          startLat: a.lat,
          startLng: a.lon,
          endLat: b.lat,
          endLng: b.lon,
          altitude: getStaticArcAltitude(a.lat, a.lon, b.lat, b.lon) * 0.6, // flatter than flight arcs
          cruiseId: c.id,
          cruiseLabel: label,
          fromPort: a.name,
          toPort: b.name,
        });
      }
    }
    return out;
  }, [cruises]);

  // Distinct port markers across all cruises so popular embarkation ports
  // (Hamburg, Civitavecchia, …) get a single dot rather than one per cruise.
  const cruisePointsData = useMemo<PointData[]>(() => {
    const portMap = new Map<number, PointData>();
    for (const c of cruises) {
      for (const s of c.stops) {
        if (s.isAtSea || !s.port) continue;
        const port = s.port;
        const existing = portMap.get(port.id);
        if (existing) {
          existing.size++;
        } else {
          portMap.set(port.id, {
            lat: port.lat,
            lng: port.lon,
            name: port.name,
            code: port.unlocode ?? port.name,
            size: 1,
          });
        }
      }
    }
    return Array.from(portMap.values());
  }, [cruises]);

  // Merge flight + cruise arcs into a single arrays for the Globe component
  // (it only accepts one arcsData prop). Type discriminator drives per-arc
  // styling functions below.
  const allArcsData = useMemo(() => [...arcsData, ...cruiseArcsData], [arcsData, cruiseArcsData]);

  const pointsData = useMemo(() => {
    const airportMap = new Map<string, PointData>();

    for (const flight of flights) {
      if (!flight?.properties || !flight?.geometry) continue;
      const coords = flight.geometry.coordinates;
      if (coords.length < 2) continue;

      const depLat = coords[0][1];
      const depLng = coords[0][0];
      const depCode =
        flight.properties.departureAirport?.iata ??
        flight.properties.departureAirport?.icao ??
        "Unknown";
      if ([depLat, depLng].every(Number.isFinite) && !(depLat === 0 && depLng === 0)) {
        const key = depCode !== "Unknown" ? depCode : `${depLat.toFixed(2)}_${depLng.toFixed(2)}`;
        if (!airportMap.has(key)) {
          airportMap.set(key, {
            lat: depLat,
            lng: depLng,
            name: flight.properties.departureAirport?.name ?? depCode,
            code: depCode,
            size: 0,
          });
        }
        airportMap.get(key)!.size++;
      }

      const arrLat = coords[coords.length - 1][1];
      const arrLng = coords[coords.length - 1][0];
      const arrCode =
        flight.properties.arrivalAirport?.iata ??
        flight.properties.arrivalAirport?.icao ??
        "Unknown";
      if ([arrLat, arrLng].every(Number.isFinite) && !(arrLat === 0 && arrLng === 0)) {
        const key = arrCode !== "Unknown" ? arrCode : `${arrLat.toFixed(2)}_${arrLng.toFixed(2)}`;
        if (!airportMap.has(key)) {
          airportMap.set(key, {
            lat: arrLat,
            lng: arrLng,
            name: flight.properties.arrivalAirport?.name ?? arrCode,
            code: arrCode,
            size: 0,
          });
        }
        airportMap.get(key)!.size++;
      }
    }

    return Array.from(airportMap.values());
  }, [flights]);

  const arcLabel = useCallback(
    (arc: CombinedArcDatum): string => {
      if (arc.type === "cruise") {
        const c = arc as CruiseArcDatum;
        return `
          <div style="background:rgba(0,0,0,0.8);color:white;padding:8px 12px;border-radius:6px;font-family:system-ui;font-size:12px;">
            <div style="font-weight:bold;margin-bottom:4px;">
              🚢 ${escapeHtml(c.cruiseLabel)}
            </div>
            <div style="font-size:11px;opacity:0.9;">
              ${escapeHtml(c.fromPort)} → ${escapeHtml(c.toPort)}
            </div>
          </div>
        `;
      }
      const f = arc as ArcData;
      return `
        <div style="background:rgba(0,0,0,0.8);color:white;padding:8px 12px;border-radius:6px;font-family:system-ui;font-size:12px;">
          <div style="font-weight:bold;margin-bottom:4px;">
            ${escapeHtml(f.departure?.iata ?? "UNK")} ↔ ${escapeHtml(f.arrival?.iata ?? "UNK")}
          </div>
          <div style="font-size:11px;opacity:0.9;margin-bottom:6px;">
            ${escapeHtml(f.departure?.name ?? "Unknown")} ↔ ${escapeHtml(f.arrival?.name ?? "Unknown")}
          </div>
          <div style="color:${f.color};">
            ${t("map:globe.timesFlown", { count: f.count })}
          </div>
        </div>
      `;
    },
    [t]
  );

  // Smooth fly-to on arc click. Compute the geographic mid-point of the arc
  // and zoom in so the user sees the full route without jarring teleport.
  const flyToArc = useCallback(
    (startLat: number, startLng: number, endLat: number, endLng: number): void => {
      if (!globeRef.current) return;
      const midLat = (startLat + endLat) / 2;
      // Wrap-around handling: pick the shorter longitude path so a Pacific
      // route doesn't camera-pan the long way around.
      const lngDiff = endLng - startLng;
      const adjustedEnd = lngDiff > 180 ? endLng - 360 : lngDiff < -180 ? endLng + 360 : endLng;
      const midLng = (startLng + adjustedEnd) / 2;
      const distance = calculateDistance(startLat, startLng, endLat, endLng);
      // Bigger arcs zoom out further so both endpoints stay framed.
      const altitude = Math.max(0.8, Math.min(2.5, distance / 5000));
      globeRef.current.pointOfView({ lat: midLat, lng: midLng, altitude }, 1500);
    },
    []
  );

  const pointLabel = useCallback(
    (point: object): string => {
      const p = point as PointData;
      return `
        <div style="background:rgba(0,0,0,0.8);color:white;padding:6px 10px;border-radius:4px;font-family:system-ui;font-size:11px;">
          <div style="font-weight:bold;">${escapeHtml(p.code)}</div>
          <div style="opacity:0.8;">${escapeHtml(p.name)}</div>
          <div style="margin-top:2px;color:#fbbf24;">
            ${p.size} ${t("map:globe.flight", { count: p.size })}
          </div>
        </div>
      `;
    },
    [t]
  );

  const legendRanges = useMemo(
    () => [
      { color: "#64748b", label: `1–${Math.max(heatmapThresholds.q25, 1)}x` },
      {
        color: "#e8a045",
        label: `${heatmapThresholds.q25 + 1}–${heatmapThresholds.q50}x`,
      },
      {
        color: "#f97316",
        label: `${heatmapThresholds.q50 + 1}–${heatmapThresholds.q75}x`,
      },
      {
        color: "#ef4444",
        label: `${heatmapThresholds.q75 + 1}+ (${heatmapThresholds.max}x max)`,
      },
    ],
    [heatmapThresholds]
  );

  return (
    <div
      className="h-full w-full relative flex items-center justify-center"
      style={{ touchAction: "pan-x pan-y pinch-zoom" }}
    >
      {/* Bottom-left stack: auto-rotation control + route legend */}
      <div
        className="absolute bottom-4 left-4 z-[9999] flex flex-col gap-2 items-start"
        style={{ touchAction: "auto", pointerEvents: "auto" }}
      >
        {/* Control Panel */}
        <div className="bg-[var(--bg-surface)] rounded-lg shadow-lg p-4 border border-[var(--color-border)]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(e) => setAutoRotate(e.target.checked)}
              className="checkbox"
            />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              🌍 {t("map:globe.autoRotation")}
            </span>
          </label>
        </div>

        {/* Heatmap Legend */}
        {arcsData.length > 0 && (
          <div className="bg-[var(--bg-surface)] rounded-lg shadow-lg p-3 border border-[var(--color-border)]">
            <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">
              {t("map:globe.routeFrequency")}
            </div>
            <div className="space-y-1">
              {legendRanges.map(({ color, label }) => (
                <div key={color} className="flex items-center gap-2">
                  <div className="w-8 h-0.5" style={{ backgroundColor: color }} />
                  <span className="text-xs text-[var(--text-muted)]">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Globe
        ref={globeRef}
        style={{ width: "100%", height: "100%" }}
        globeImageUrl="/earth-night.jpg"
        bumpImageUrl="/earth-topology.png"
        backgroundImageUrl="/night-sky.png"
        arcsData={allArcsData}
        arcColor={(arc: CombinedArcDatum) =>
          arc.type === "cruise" ? CRUISE_ARC_COLOR : (arc as ArcData).color
        }
        arcStroke={dynamicStroke}
        arcStrokeOpacity={0.6}
        arcAltitude={(arc: CombinedArcDatum) => (arc as ArcData | CruiseArcDatum).altitude}
        arcCurveResolution={arcResolution}
        // Animated dash flow: short bright dash sliding along each arc gives
        // a "plane trail / current" feel. Cruises run slower (longer cycle)
        // to read as ship traffic vs. air traffic.
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashInitialGap={(arc: CombinedArcDatum) =>
          // Stagger initial offset by latitude so multiple arcs don't pulse
          // in lockstep — produces a much livelier idle map.
          ((arc as ArcData | CruiseArcDatum).startLat + 90) / 180
        }
        arcDashAnimateTime={(arc: CombinedArcDatum) => (arc.type === "cruise" ? 7000 : 4000)}
        arcLabel={arcLabel}
        onArcClick={(arc: CombinedArcDatum) => {
          const a = arc as ArcData | CruiseArcDatum;
          // Smooth POV transition first — feels like a polished travel app.
          flyToArc(a.startLat, a.startLng, a.endLat, a.endLng);
          if (arc.type === "flight") {
            const f = arc as ArcData;
            if (onFlightClick && f.flights.length > 0) {
              const mostRecentFlight = f.flights[f.flights.length - 1];
              onFlightClick(mostRecentFlight.properties.id);
            }
          }
        }}
        pointsData={[
          ...pointsData.map((p) => ({ ...p, _kind: "airport" as const })),
          ...cruisePointsData.map((p) => ({ ...p, _kind: "port" as const })),
        ]}
        pointLat="lat"
        pointLng="lng"
        pointColor={(point: object) => {
          const p = point as PointData & { _kind: "airport" | "port" };
          if (p._kind === "port") return CRUISE_PORT_COLOR;
          return isDarkMode ? "#fbbf24" : "#f59e0b";
        }}
        pointAltitude={0.01}
        pointRadius={(point: object) => {
          const p = point as PointData;
          return Math.min(Math.sqrt(p.size) * 0.08, 0.3);
        }}
        pointLabel={pointLabel}
        atmosphereColor={isDarkMode ? "#e8a045" : "#3b82f6"}
        atmosphereAltitude={0.25}
        enablePointerInteraction={true}
        animateIn={true}
      />
    </div>
  );
}
