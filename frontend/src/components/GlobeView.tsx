import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import Globe from "react-globe.gl";
import type { GeoJSONFeature } from "../types";
import { escapeHtml } from "../lib/escapeHtml";
import { useTranslation } from "../hooks/useTranslation";

interface GlobeViewProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  minRouteCount?: number;
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

type GlobeInstance = {
  pointOfView: (
    point?: { lat: number; lng: number; altitude: number },
    transitionDuration?: number
  ) => { lat: number; lng: number; altitude: number } | void;
  controls: () => { autoRotate: boolean; autoRotateSpeed: number };
};

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
}

export default function GlobeView({
  flights = [],
  onFlightClick,
  minRouteCount = 1,
}: GlobeViewProps): JSX.Element {
  const { t } = useTranslation(["map"]);
  const globeRef = useRef<GlobeInstance | null>(null);
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

  const cameraAltitudeRef = useRef(cameraAltitude);
  cameraAltitudeRef.current = cameraAltitude;

  useEffect(() => {
    if (!globeRef.current) return;
    const interval = setInterval(() => {
      if (globeRef.current) {
        const pov = globeRef.current.pointOfView();
        if (pov && pov.altitude !== cameraAltitudeRef.current) {
          setCameraAltitude(pov.altitude);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const dynamicStroke = useMemo(() => {
    const zoomFactor = cameraAltitude / 2.5;
    return Math.min(Math.max(0.3 * zoomFactor, 0.08), 0.7);
  }, [cameraAltitude]);

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

    const arcs = Array.from(routeMap.values())
      .filter((route) => route.count >= minRouteCount)
      .map((route) => ({
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
    (arc: ArcData): string => `
      <div style="background:rgba(0,0,0,0.8);color:white;padding:8px 12px;border-radius:6px;font-family:system-ui;font-size:12px;">
        <div style="font-weight:bold;margin-bottom:4px;">
          ${escapeHtml(arc.departure?.iata ?? "UNK")} ↔ ${escapeHtml(arc.arrival?.iata ?? "UNK")}
        </div>
        <div style="font-size:11px;opacity:0.9;margin-bottom:6px;">
          ${escapeHtml(arc.departure?.name ?? "Unknown")} ↔ ${escapeHtml(arc.arrival?.name ?? "Unknown")}
        </div>
        <div style="color:${arc.color};">
          ${t("map:globe.timesFlown", { count: arc.count })}
        </div>
      </div>
    `,
    [t]
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
        arcsData={arcsData}
        arcColor={(arc: ArcData) => arc.color}
        arcStroke={dynamicStroke}
        arcStrokeOpacity={0.6}
        arcAltitude={(arc: ArcData) => arc.altitude}
        arcCurveResolution={64}
        arcDashLength={1}
        arcDashGap={0}
        arcDashInitialGap={() => 0}
        arcLabel={arcLabel}
        onArcClick={(arc: ArcData) => {
          if (onFlightClick && arc.flights.length > 0) {
            const mostRecentFlight = arc.flights[arc.flights.length - 1];
            onFlightClick(mostRecentFlight.properties.id);
          }
        }}
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => "#f0a947"}
        pointAltitude={0.01}
        pointRadius={(point: object) => {
          const p = point as PointData;
          return Math.min(Math.sqrt(p.size) * 0.08, 0.3);
        }}
        pointLabel={pointLabel}
        atmosphereColor="#f0a947"
        atmosphereAltitude={0.25}
        enablePointerInteraction={true}
        animateIn={true}
      />
    </div>
  );
}
