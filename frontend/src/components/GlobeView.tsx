import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import Globe from "react-globe.gl";
import * as THREE from "three";
import type { GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import { useTimeSliderStore } from "../store/timeSliderStore";
import { escapeHtml } from "../lib/escapeHtml";
import { useTranslation } from "../hooks/useTranslation";
import { DOMAINS } from "../shared/domains";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { logger } from "../lib/logger";
import { GlobeTimeSlider } from "./Globe/GlobeTimeSlider";
import {
  computeCruiseLegDates,
  computeTimeRange,
  flightVisibleFilter,
  flightVisibleLive,
  legProgress,
  legVisibleFilter,
  truncatePolyline,
  type CruiseLegDates,
} from "./Globe/timeSliderUtils";

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
const FLIGHT_POINT_COLOR = "#f0a947";
const ATMOSPHERE_COLOR = "#5fa3ff";
const ATMOSPHERE_ALTITUDE = 0.32;
const POINT_ALTITUDE = 0.01;
const ARC_STROKE_OPACITY = 0.6;
// Layer tweens are disabled — data identity changes whenever the time
// slider scrubs, and the lib's default ~1s tween creates massive churn
// (re-tesselating geometry every frame). 0 = jump directly, no tween.
const ZERO_TRANSITION = 0;
const BUMP_SCALE = 8;

interface CruisePathDatum {
  coords: Array<[number, number]>;
  cruiseId: string;
  cruiseLabel: string;
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
  if (count > thresholds.q25) return "#f0a947"; // brand amber
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
  renderer: () => THREE.WebGLRenderer;
  globeMaterial: () => THREE.Material;
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

interface MergedPoint extends PointData {
  _kind: "airport" | "port";
}

// Module-level accessors — referenced by identity, never re-created. The
// lib uses prop identity to decide whether a layer needs a full data
// digest, so stable functions matter on the hot path.
const arcColorFn = (arc: ArcData): string => arc.color;
const arcAltitudeFn = (arc: ArcData): number => arc.altitude;
const pathPointsFn = (p: CruisePathDatum): Array<[number, number]> => p.coords;
const pathPointLatFn = (coord: [number, number]): number => coord[0];
const pathPointLngFn = (coord: [number, number]): number => coord[1];
const pathColorFn = (): string => CRUISE_ARC_COLOR;
const pointColorFn = (point: object): string =>
  (point as MergedPoint)._kind === "port" ? CRUISE_PORT_COLOR : FLIGHT_POINT_COLOR;
const pointRadiusFn = (point: object): number => {
  const p = point as PointData;
  return Math.min(Math.sqrt(p.size) * 0.08, 0.3);
};

export default function GlobeView({
  flights = [],
  cruises = [],
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

  // Crank the texture sampler up to the GPU's max anisotropy as soon as
  // the globe mesh exists. Three's default of 1 leaves the day texture
  // and bump map looking soft at glancing angles when zoomed in — most
  // GPUs support 16, which is the visible-detail-on-zoom fix.
  const onGlobeReady = useCallback((): void => {
    const globe = globeRef.current;
    if (!globe) return;
    try {
      const max = globe.renderer().capabilities.getMaxAnisotropy();
      const material = globe.globeMaterial() as THREE.MeshPhongMaterial;
      if (material.map) material.map.anisotropy = max;
      if (material.bumpMap) material.bumpMap.anisotropy = max;
      // bumpScale ranges 0..N — the lib default 10 is too aggressive on
      // a 2k topology map. 8 reads as gentle relief without harsh banding.
      material.bumpScale = BUMP_SCALE;
      if (material.map) material.map.needsUpdate = true;
      if (material.bumpMap) material.bumpMap.needsUpdate = true;
    } catch (err: unknown) {
      logger.warn("GlobeView: anisotropy upgrade skipped", err);
    }
  }, []);

  // Camera-altitude tracking. Subscribes to the OrbitControls 'change'
  // event which fires only on user input (drag / wheel / pinch). Updates
  // state only when altitude crossed a noticeable threshold so dependent
  // memos don't churn on sub-pixel changes during a slow drag.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    if (!controls?.addEventListener) return;
    const onChange = (): void => {
      const pov = globe.pointOfView();
      if (!pov) return;
      setCameraAltitude((prev) => (Math.abs(pov.altitude - prev) > 0.05 ? pov.altitude : prev));
    };
    controls.addEventListener("change", onChange);
    return () => controls.removeEventListener("change", onChange);
  }, []);

  const dynamicStroke = useMemo(() => {
    const zoomFactor = cameraAltitude / 2.5;
    return Math.min(Math.max(0.3 * zoomFactor, 0.08), 0.7);
  }, [cameraAltitude]);

  // Arc tesselation LOD. 32 segments at wide-angle (whole-hemisphere
  // visible), 64 zoomed-in. Halving vertex count for the wide view
  // halves Three.js geometry work for the route layer.
  const arcResolution = useMemo<number>(() => (cameraAltitude > 3 ? 32 : 64), [cameraAltitude]);
  const pathStroke = useMemo(() => Math.max(dynamicStroke * 0.85, 0.18), [dynamicStroke]);

  // Time-slider state. Sliced per-field so unrelated store changes don't
  // re-render the whole component.
  const sliderMode = useTimeSliderStore((s) => s.mode);
  const sliderCurrent = useTimeSliderStore((s) => s.currentDate);
  const sliderFilterStart = useTimeSliderStore((s) => s.filterStart);
  const sliderFilterEnd = useTimeSliderStore((s) => s.filterEnd);
  const setSliderRange = useTimeSliderStore((s) => s.setRange);

  useEffect(() => {
    const range = computeTimeRange(flights, cruises);
    if (range) setSliderRange(range.min, range.max);
  }, [flights, cruises, setSliderRange]);

  const cruiseLegDatesByCruise = useMemo<Map<string, CruiseLegDates[]>>(() => {
    const out = new Map<string, CruiseLegDates[]>();
    for (const c of cruises) out.set(c.id, computeCruiseLegDates(c));
    return out;
  }, [cruises]);

  const filteredFlights = useMemo<GeoJSONFeature[]>(() => {
    if (sliderMode === "off") return flights;
    if (sliderMode === "live") {
      if (!sliderCurrent) return flights;
      return flights.filter((f) => flightVisibleLive(f, sliderCurrent));
    }
    if (!sliderFilterStart || !sliderFilterEnd) return flights;
    return flights.filter((f) => flightVisibleFilter(f, sliderFilterStart, sliderFilterEnd));
  }, [flights, sliderMode, sliderCurrent, sliderFilterStart, sliderFilterEnd]);

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

    for (const flight of filteredFlights) {
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
  }, [filteredFlights, minRouteCount]);

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
        logger.error("GlobeView: cruise geometry batch fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cruises]);

  const cruisePathsData = useMemo<CruisePathDatum[]>(() => {
    const out: CruisePathDatum[] = [];
    for (const cruise of cruises) {
      const fc = cruiseGeometry.get(cruise.id);
      if (!fc) continue;
      const label = cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? "Cruise";
      const legDates = cruiseLegDatesByCruise.get(cruise.id) ?? [];
      const dateByPair = new Map<string, CruiseLegDates>();
      for (const ld of legDates) {
        dateByPair.set(`${ld.fromPortId}:${ld.toPortId}`, ld);
      }
      for (const feature of fc.features) {
        const coords = feature.geometry.coordinates.map(
          ([lon, lat]) => [lat, lon] as [number, number]
        );
        if (coords.length < 2) continue;

        if (sliderMode === "live" && sliderCurrent) {
          const ld = dateByPair.get(
            `${feature.properties.fromPortId}:${feature.properties.toPortId}`
          );
          if (ld) {
            const p = legProgress(ld, sliderCurrent);
            if (p === 0) continue;
            const partial = p < 1 ? truncatePolyline(coords, p) : coords;
            if (partial.length < 2) continue;
            out.push({ coords: partial, cruiseId: cruise.id, cruiseLabel: label });
            continue;
          }
        }

        if (sliderMode === "filter" && sliderFilterStart && sliderFilterEnd) {
          const ld = dateByPair.get(
            `${feature.properties.fromPortId}:${feature.properties.toPortId}`
          );
          if (ld && !legVisibleFilter(ld, sliderFilterStart, sliderFilterEnd)) {
            continue;
          }
        }

        out.push({ coords, cruiseId: cruise.id, cruiseLabel: label });
      }
    }
    return out;
  }, [
    cruises,
    cruiseGeometry,
    cruiseLegDatesByCruise,
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
  ]);

  const cruisePointsData = useMemo<PointData[]>(() => {
    const portMap = new Map<number, PointData>();
    for (const c of cruises) {
      const legs = cruiseLegDatesByCruise.get(c.id) ?? [];
      const portVisitDate = new Map<number, Date>();
      const startDate = c.startDate ? new Date(c.startDate) : null;
      const firstPortStop = c.stops.find((s) => !s.isAtSea && s.port);
      if (firstPortStop?.port && startDate) {
        portVisitDate.set(firstPortStop.port.id, startDate);
      }
      for (const ld of legs) {
        portVisitDate.set(ld.toPortId, ld.endDate);
      }

      for (const s of c.stops) {
        if (s.isAtSea || !s.port) continue;
        const visit = portVisitDate.get(s.port.id);
        if (sliderMode === "live" && sliderCurrent) {
          if (!visit || visit.getTime() > sliderCurrent.getTime()) continue;
        } else if (sliderMode === "filter" && sliderFilterStart && sliderFilterEnd) {
          if (
            !visit ||
            visit.getTime() < sliderFilterStart.getTime() ||
            visit.getTime() > sliderFilterEnd.getTime()
          ) {
            continue;
          }
        }
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
  }, [
    cruises,
    cruiseLegDatesByCruise,
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
  ]);

  const pointsData = useMemo(() => {
    const airportMap = new Map<string, PointData>();

    for (const flight of filteredFlights) {
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
  }, [filteredFlights]);

  // Merged airport + port array — react-globe.gl wants one pointsData
  // prop. Keep the merge memoized so prop identity only changes when
  // either input list changes, not on every render.
  const mergedPointsData = useMemo<MergedPoint[]>(() => {
    const out: MergedPoint[] = new Array(pointsData.length + cruisePointsData.length);
    let i = 0;
    for (const p of pointsData) {
      out[i++] = { ...p, _kind: "airport" };
    }
    for (const p of cruisePointsData) {
      out[i++] = { ...p, _kind: "port" };
    }
    return out;
  }, [pointsData, cruisePointsData]);

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

  const cruisePathLabel = useCallback(
    (path: CruisePathDatum): string => `
      <div style="background:rgba(0,0,0,0.8);color:white;padding:6px 10px;border-radius:6px;font-family:system-ui;font-size:12px;">
        🚢 <strong>${escapeHtml(path.cruiseLabel)}</strong>
      </div>
    `,
    []
  );

  const flyToArc = useCallback(
    (startLat: number, startLng: number, endLat: number, endLng: number): void => {
      if (!globeRef.current) return;
      const midLat = (startLat + endLat) / 2;
      const lngDiff = endLng - startLng;
      const adjustedEnd = lngDiff > 180 ? endLng - 360 : lngDiff < -180 ? endLng + 360 : endLng;
      const midLng = (startLng + adjustedEnd) / 2;
      const distance = calculateDistance(startLat, startLng, endLat, endLng);
      const altitude = Math.max(0.8, Math.min(2.5, distance / 5000));
      globeRef.current.pointOfView({ lat: midLat, lng: midLng, altitude }, 1500);
    },
    []
  );

  const onArcClick = useCallback(
    (arc: ArcData): void => {
      flyToArc(arc.startLat, arc.startLng, arc.endLat, arc.endLng);
      if (onFlightClick && arc.flights.length > 0) {
        const mostRecentFlight = arc.flights[arc.flights.length - 1];
        onFlightClick(mostRecentFlight.properties.id);
      }
    },
    [flyToArc, onFlightClick]
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
        color: "#f0a947",
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
      <div
        className="absolute bottom-4 left-4 z-[9999] flex flex-col gap-2 items-start"
        style={{ touchAction: "auto", pointerEvents: "auto" }}
      >
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

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[9999]"
        style={{ touchAction: "auto", pointerEvents: "auto" }}
      >
        <GlobeTimeSlider
          visibleFlights={filteredFlights.length}
          visibleCruises={new Set(cruisePathsData.map((p) => p.cruiseId)).size}
        />
      </div>

      <Globe
        ref={globeRef}
        style={{ width: "100%", height: "100%" }}
        globeImageUrl="/earth-day.jpg"
        bumpImageUrl="/earth-topology.png"
        backgroundImageUrl="/night-sky.png"
        onGlobeReady={onGlobeReady}
        atmosphereColor={ATMOSPHERE_COLOR}
        atmosphereAltitude={ATMOSPHERE_ALTITUDE}
        arcsData={arcsData}
        arcColor={arcColorFn}
        arcStroke={dynamicStroke}
        arcStrokeOpacity={ARC_STROKE_OPACITY}
        arcAltitude={arcAltitudeFn}
        arcCurveResolution={arcResolution}
        arcDashLength={1}
        arcDashGap={0}
        arcDashInitialGap={0}
        arcsTransitionDuration={ZERO_TRANSITION}
        arcLabel={arcLabel}
        onArcClick={onArcClick}
        pathsData={cruisePathsData}
        pathPoints={pathPointsFn}
        pathPointLat={pathPointLatFn}
        pathPointLng={pathPointLngFn}
        pathColor={pathColorFn}
        pathStroke={pathStroke}
        pathDashLength={1}
        pathDashGap={0}
        pathDashAnimateTime={0}
        pathTransitionDuration={ZERO_TRANSITION}
        pathLabel={cruisePathLabel}
        pointsData={mergedPointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={pointColorFn}
        pointAltitude={POINT_ALTITUDE}
        pointRadius={pointRadiusFn}
        pointsTransitionDuration={ZERO_TRANSITION}
        pointLabel={pointLabel}
        enablePointerInteraction={true}
        animateIn={true}
      />
    </div>
  );
}
