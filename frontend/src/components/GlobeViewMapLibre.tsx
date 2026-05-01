import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { StyleSpecification } from "maplibre-gl";
import type { GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { logger } from "../lib/logger";
import { escapeHtml } from "../lib/escapeHtml";
import { useTranslation } from "../hooks/useTranslation";
import { useTimeSliderStore } from "../store/timeSliderStore";
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

/**
 * Globe-mode renderer. MapLibre's native globe projection (5.x) draws
 * the basemap on a sphere; deck.gl renders the data overlay (flight
 * arcs, cruise paths, airport + port dots) through MapboxOverlay so the
 * same engine that powers the 2D map drives the globe too.
 *
 * Six tokenless basemap styles via the bottom-center picker (Standard /
 * Light / Dark / Voyager / Satellite / OSM), modelled after geojson.io.
 *
 * Day/night terminator was intentionally dropped when the migration
 * away from `react-globe.gl` + `three` happened — the atmosphere + rim
 * glow alone gives a strong "from orbit" look without the shader.
 */

interface GlobeViewMapLibreProps {
  flights: GeoJSONFeature[];
  cruises?: Cruise[];
  onFlightClick?: (flightId: string) => void;
  minRouteCount?: number;
}

// ────────────────────────────────────────────────────────────────────
// Style options — six tokenless basemaps, modelled after geojson.io.
// CARTO + OpenFreeMap + ESRI World Imagery + OSM Standard. None of
// them require an API key.
// ────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────
// Heatmap quartile palette — same colours the 2D `routesLayer` uses so
// flight-arc colour semantics match across map modes.
// ────────────────────────────────────────────────────────────────────
const HEAT_RGB = {
  q4: [239, 68, 68] as [number, number, number], // red — hotspot
  q3: [249, 115, 22] as [number, number, number], // orange-500
  q2: [232, 160, 69] as [number, number, number], // brand amber
  q1: [100, 116, 139] as [number, number, number], // slate-500 — muted
};

const HEAT_HEX = {
  q4: "#ef4444",
  q3: "#f97316",
  q2: "#e8a045",
  q1: "#64748b",
};

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

interface HeatmapThresholds {
  q25: number;
  q50: number;
  q75: number;
  max: number;
}

const calculateHeatmapThresholds = (counts: number[]): HeatmapThresholds => {
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

const getHeatmapColor = (count: number, t: HeatmapThresholds): [number, number, number] => {
  if (count > t.q75) return HEAT_RGB.q4;
  if (count > t.q50) return HEAT_RGB.q3;
  if (count > t.q25) return HEAT_RGB.q2;
  return HEAT_RGB.q1;
};

// Haversine distance in km for fly-to-arc zoom heuristic.
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

interface ArcDatum {
  from: [number, number];
  to: [number, number];
  count: number;
  flightIds: string[];
  color: [number, number, number];
  departure: { iata?: string; name?: string };
  arrival: { iata?: string; name?: string };
}

interface PointDatum {
  position: [number, number];
  size: number;
  iata: string;
  name: string;
}

interface CruisePathDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLabel: string;
}

interface TooltipState {
  html: string;
  x: number;
  y: number;
}

const createRouteKey = (a: string, b: string): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

export default function GlobeViewMapLibre({
  flights = [],
  cruises = [],
  onFlightClick,
  minRouteCount = 1,
}: GlobeViewMapLibreProps): JSX.Element {
  const { t } = useTranslation(["map"]);
  const mapRef = useRef<MapRef>(null);

  const [styleId, setStyleId] = useState<StyleId>(() => {
    if (typeof window === "undefined") return "standard";
    const stored = window.sessionStorage.getItem("globeStyleId");
    return STYLE_OPTIONS.some((s) => s.id === stored) ? (stored as StyleId) : "standard";
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Time-slider state. Sliced per-field so unrelated store changes
  // don't re-render the whole component. The store mode drives whether
  // flights / cruise legs / ports get filtered before they reach the
  // deck.gl layers.
  const sliderMode = useTimeSliderStore((s) => s.mode);
  const sliderCurrent = useTimeSliderStore((s) => s.currentDate);
  const sliderFilterStart = useTimeSliderStore((s) => s.filterStart);
  const sliderFilterEnd = useTimeSliderStore((s) => s.filterEnd);
  const setSliderRange = useTimeSliderStore((s) => s.setRange);

  // Push the data-driven [min, max] into the store every time flights
  // or cruises change identity. The store dedupes if the bounds didn't
  // actually move, so this stays O(1) on the hot selection-change path.
  useEffect(() => {
    const range = computeTimeRange(flights, cruises);
    if (range) setSliderRange(range.min, range.max);
  }, [flights, cruises, setSliderRange]);

  // Per-leg date metadata for every cruise. Computed once per cruises
  // identity. Keyed by cruiseId so the live-mode partial-draw can pair
  // a leg's geometry with its (start, end) dates in O(1).
  const cruiseLegDatesByCruise = useMemo<Map<string, CruiseLegDates[]>>(() => {
    const out = new Map<string, CruiseLegDates[]>();
    for (const c of cruises) out.set(c.id, computeCruiseLegDates(c));
    return out;
  }, [cruises]);

  // The pre-aggregation flight set, filtered by slider state. The arc
  // builder downstream still groups same-route flights together so a
  // city pair only renders one arc however many flights are visible.
  const filteredFlights = useMemo<GeoJSONFeature[]>(() => {
    if (sliderMode === "off") return flights;
    if (sliderMode === "live") {
      if (!sliderCurrent) return flights;
      return flights.filter((f) => flightVisibleLive(f, sliderCurrent));
    }
    if (!sliderFilterStart || !sliderFilterEnd) return flights;
    return flights.filter((f) => flightVisibleFilter(f, sliderFilterStart, sliderFilterEnd));
  }, [flights, sliderMode, sliderCurrent, sliderFilterStart, sliderFilterEnd]);

  const currentStyle = useMemo(
    () => STYLE_OPTIONS.find((s) => s.id === styleId) ?? STYLE_OPTIONS[0],
    [styleId]
  );
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

  // Apply globe projection + sky on initial load AND after every style
  // swap (MapLibre resets both when replacing the style). Driven by
  // react-map-gl's onLoad — that's the only event that fires after the
  // map ref is guaranteed populated.
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

  // Auto-rotation loop. Drives `map.jumpTo` ~30 fps with a constant
  // angular velocity, no easing — gives the same continuous "globe
  // turning in space" feel the old react-globe.gl impl had via three.js
  // OrbitControls.autoRotate. Cancellable mid-rotation by toggling the
  // checkbox; user pan/zoom doesn't pause it (matching old behaviour).
  useEffect(() => {
    if (!autoRotate) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let raf = 0;
    let lastT = performance.now();
    const tick = (now: number): void => {
      const dt = now - lastT;
      lastT = now;
      const center = map.getCenter();
      // 4 deg/s — a full revolution every 90 s, slightly faster than
      // the old impl so the motion is obvious without being dizzying.
      const newLng = ((center.lng + (dt * 4) / 1000 + 540) % 360) - 180;
      map.jumpTo({ center: [newLng, center.lat] });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  // Aggregate flights into city-pair routes with count + heatmap colour.
  const { arcsData, heatmapThresholds } = useMemo(() => {
    interface RouteAcc {
      count: number;
      from: [number, number];
      to: [number, number];
      flightIds: string[];
      departure: { iata?: string; name?: string };
      arrival: { iata?: string; name?: string };
    }
    const routes = new Map<string, RouteAcc>();
    for (const flight of filteredFlights) {
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
      const dep = flight.properties?.departureAirport;
      const arr = flight.properties?.arrivalAirport;
      const depKey = dep?.iata ?? "UNK";
      const arrKey = arr?.iata ?? "UNK";
      const key = createRouteKey(depKey, arrKey);
      const existing = routes.get(key);
      if (existing) {
        existing.count++;
        existing.flightIds.push(flight.properties.id);
      } else {
        routes.set(key, {
          count: 1,
          from: [start[0], start[1]],
          to: [end[0], end[1]],
          flightIds: [flight.properties.id],
          departure: dep ?? {},
          arrival: arr ?? {},
        });
      }
    }
    const counts = Array.from(routes.values()).map((r) => r.count);
    const thresholds = calculateHeatmapThresholds(counts);
    const arcs: ArcDatum[] = Array.from(routes.values())
      .filter((r) => r.count >= minRouteCount)
      .map((r) => ({
        from: r.from,
        to: r.to,
        count: r.count,
        flightIds: r.flightIds,
        departure: r.departure,
        arrival: r.arrival,
        color: getHeatmapColor(r.count, thresholds),
      }));
    return { arcsData: arcs, heatmapThresholds: thresholds };
  }, [filteredFlights, minRouteCount]);

  const airportPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<string, PointDatum>();
    for (const flight of filteredFlights) {
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
        else
          seen.set(key, {
            position: [start[0], start[1]],
            size: 1,
            iata: dep.iata,
            name: dep.name ?? dep.iata,
          });
      }
      if (arr?.iata && Number.isFinite(end[0]) && Number.isFinite(end[1])) {
        const key = arr.iata;
        const cur = seen.get(key);
        if (cur) cur.size++;
        else
          seen.set(key, {
            position: [end[0], end[1]],
            size: 1,
            iata: arr.iata,
            name: arr.name ?? arr.iata,
          });
      }
    }
    return Array.from(seen.values());
  }, [filteredFlights]);

  // Pull cruise leg geometry from the schematic-router endpoint; one
  // FeatureCollection per cruise. Same source as the 2D map.
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
      const label = cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? "Cruise";
      const legDates = cruiseLegDatesByCruise.get(cruise.id) ?? [];
      // Index legs by "from:to" so we can pair geometry to date in O(1).
      const dateByPair = new Map<string, CruiseLegDates>();
      for (const ld of legDates) dateByPair.set(`${ld.fromPortId}:${ld.toPortId}`, ld);

      for (const feature of fc.features) {
        const path = feature.geometry.coordinates as [number, number][];
        if (path.length < 2) continue;

        if (sliderMode === "live" && sliderCurrent) {
          const ld = dateByPair.get(
            `${feature.properties.fromPortId}:${feature.properties.toPortId}`
          );
          if (ld) {
            const p = legProgress(ld, sliderCurrent);
            if (p === 0) continue; // not yet sailed
            if (p < 1) {
              // truncatePolyline expects [lat, lng]; MapLibre paths are
              // [lng, lat]. Swap → truncate → swap back so the
              // haversine inside the helper sees real latitudes.
              const swapped = path.map(([lng, lat]) => [lat, lng] as [number, number]);
              const partialSwapped = truncatePolyline(swapped, p);
              if (partialSwapped.length < 2) continue;
              const partial = partialSwapped.map(([lat, lng]) => [lng, lat] as [number, number]);
              out.push({ path: partial, cruiseId: cruise.id, cruiseLabel: label });
              continue;
            }
            // p >= 1: full leg falls through to push-full below
          }
        }

        if (sliderMode === "filter" && sliderFilterStart && sliderFilterEnd) {
          const ld = dateByPair.get(
            `${feature.properties.fromPortId}:${feature.properties.toPortId}`
          );
          if (ld && !legVisibleFilter(ld, sliderFilterStart, sliderFilterEnd)) continue;
        }

        out.push({ path, cruiseId: cruise.id, cruiseLabel: label });
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

  const portPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<number, PointDatum>();
    for (const c of cruises) {
      const legs = cruiseLegDatesByCruise.get(c.id) ?? [];
      // A port is "visited" at the ARRIVAL date of the leg ending there
      // (or at startDate for the first port of the cruise).
      const portVisitDate = new Map<number, Date>();
      const startDate = c.startDate ? new Date(c.startDate) : null;
      const firstPortStop = c.stops.find((s) => !s.isAtSea && s.port);
      if (firstPortStop?.port && startDate) {
        portVisitDate.set(firstPortStop.port.id, startDate);
      }
      for (const ld of legs) portVisitDate.set(ld.toPortId, ld.endDate);

      for (const stop of c.stops) {
        if (stop.isAtSea || !stop.port) continue;
        const port = stop.port;
        const visit = portVisitDate.get(port.id);

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

        const cur = seen.get(port.id);
        if (cur) cur.size++;
        else
          seen.set(port.id, {
            position: [port.lon, port.lat],
            size: 1,
            iata: port.unlocode ?? port.name,
            name: port.name,
          });
      }
    }
    return Array.from(seen.values());
  }, [
    cruises,
    cruiseLegDatesByCruise,
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
  ]);

  // Smooth fly-to on arc click. Compute mid-point (handling wrap-around)
  // and pick a zoom level that keeps both endpoints visible without
  // teleporting too close on short hops.
  const flyToArc = useCallback((d: ArcDatum): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const lngDiff = d.to[0] - d.from[0];
    const wrappedTo = lngDiff > 180 ? d.to[0] - 360 : lngDiff < -180 ? d.to[0] + 360 : d.to[0];
    const midLng = (d.from[0] + wrappedTo) / 2;
    const midLat = (d.from[1] + d.to[1]) / 2;
    const distanceKm = calculateDistance(d.from[1], d.from[0], d.to[1], d.to[0]);
    // Short hops get more zoom; long-haul stays zoomed-out so both
    // endpoints fit. Tuned visually to feel like the old fly-to-arc.
    const zoom = Math.max(1.4, Math.min(4, 5.5 - Math.log2(distanceKm / 100)));
    map.flyTo({ center: [midLng, midLat], zoom, duration: 1500 });
  }, []);

  const onArcHover = useCallback(
    (info: PickingInfo<ArcDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        const d = info.object;
        const html = `
          <div style="font-weight:600;margin-bottom:2px;">
            ${escapeHtml(d.departure.iata ?? "UNK")} ↔ ${escapeHtml(d.arrival.iata ?? "UNK")}
          </div>
          <div style="font-size:11px;opacity:0.85;margin-bottom:4px;">
            ${escapeHtml(d.departure.name ?? "Unknown")} ↔ ${escapeHtml(d.arrival.name ?? "Unknown")}
          </div>
          <div style="color:rgb(${d.color[0]},${d.color[1]},${d.color[2]});font-weight:600;">
            ${escapeHtml(t("map:globe.timesFlown", { count: d.count }))}
          </div>`;
        setTooltip({ html, x: info.x, y: info.y });
      } else {
        setTooltip(null);
      }
    },
    [t]
  );

  const onAirportHover = useCallback(
    (info: PickingInfo<PointDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        const d = info.object;
        const html = `
          <div style="font-weight:600;">${escapeHtml(d.iata)}</div>
          <div style="opacity:0.85;font-size:11px;">${escapeHtml(d.name)}</div>
          <div style="color:#fbbf24;margin-top:2px;">
            ${d.size} ${escapeHtml(t("map:globe.flight", { count: d.size }))}
          </div>`;
        setTooltip({ html, x: info.x, y: info.y });
      } else {
        setTooltip(null);
      }
    },
    [t]
  );

  const onPortHover = useCallback((info: PickingInfo<PointDatum>): void => {
    if (info.object && info.x != null && info.y != null) {
      const d = info.object;
      const html = `
        <div style="font-weight:600;">⚓ ${escapeHtml(d.name)}</div>
        ${d.iata !== d.name ? `<div style="opacity:0.85;font-size:11px;">${escapeHtml(d.iata)}</div>` : ""}`;
      setTooltip({ html, x: info.x, y: info.y });
    } else {
      setTooltip(null);
    }
  }, []);

  const onCruisePathHover = useCallback((info: PickingInfo<CruisePathDatum>): void => {
    if (info.object && info.x != null && info.y != null) {
      const html = `<div style="font-weight:600;">🚢 ${escapeHtml(info.object.cruiseLabel)}</div>`;
      setTooltip({ html, x: info.x, y: info.y });
    } else {
      setTooltip(null);
    }
  }, []);

  const layers = useMemo<Layer[]>(
    () => [
      new ArcLayer<ArcDatum>({
        id: "globe-flight-arcs",
        data: arcsData,
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getSourceColor: (d) => [...d.color, 220] as [number, number, number, number],
        getTargetColor: (d) => [...d.color, 220] as [number, number, number, number],
        getWidth: (d) => Math.max(1, Math.min(4, 1 + Math.log2(d.count + 1))),
        widthUnits: "pixels",
        greatCircle: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 180],
        onHover: onArcHover,
        onClick: ({ object }: { object?: ArcDatum }): void => {
          if (!object) return;
          flyToArc(object);
          if (onFlightClick && object.flightIds.length > 0) {
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
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 180],
        onHover: onCruisePathHover,
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
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 200],
        onHover: onAirportHover,
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
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 200],
        onHover: onPortHover,
      }),
    ],
    [
      arcsData,
      cruisePaths,
      airportPoints,
      portPoints,
      flyToArc,
      onArcHover,
      onAirportHover,
      onCruisePathHover,
      onPortHover,
      onFlightClick,
    ]
  );

  const legendRanges = useMemo(
    () => [
      { color: HEAT_HEX.q1, label: `1–${Math.max(heatmapThresholds.q25, 1)}×` },
      {
        color: HEAT_HEX.q2,
        label: `${heatmapThresholds.q25 + 1}–${heatmapThresholds.q50}×`,
      },
      {
        color: HEAT_HEX.q3,
        label: `${heatmapThresholds.q50 + 1}–${heatmapThresholds.q75}×`,
      },
      {
        color: HEAT_HEX.q4,
        label: `${heatmapThresholds.q75 + 1}+ (max ${heatmapThresholds.max}×)`,
      },
    ],
    [heatmapThresholds]
  );

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

      {/* Bottom-left stack: auto-rotate toggle + heatmap legend */}
      <div
        className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2"
        style={{ pointerEvents: "auto" }}
      >
        <div
          className="rounded-md p-3 text-xs"
          style={{
            background: "rgba(13, 17, 23, 0.78)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "rgba(241,245,249,0.95)",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(e) => setAutoRotate(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="text-xs font-medium">🌍 {t("map:globe.autoRotation")}</span>
          </label>
        </div>

        {arcsData.length > 0 && (
          <div
            className="rounded-md p-3 text-xs"
            style={{
              background: "rgba(13, 17, 23, 0.78)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(241,245,249,0.95)",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <div className="mb-1.5 text-[11px] font-semibold opacity-90">
              {t("map:globe.routeFrequency")}
            </div>
            <div className="space-y-1">
              {legendRanges.map(({ color, label }) => (
                <div key={color} className="flex items-center gap-2">
                  <div className="h-0.5 w-7" style={{ backgroundColor: color }} />
                  <span className="text-[11px] opacity-80">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom-center stack: time slider on top, style picker below.
          Container's bottom is pinned to bottom-3 so the picker stays
          flush with the screen edge; the slider grows upward. */}
      <div
        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
        style={{ pointerEvents: "auto" }}
      >
        <GlobeTimeSlider
          visibleFlights={filteredFlights.length}
          visibleCruises={new Set(cruisePaths.map((p) => p.cruiseId)).size}
        />

        <div
          className="flex gap-1 rounded-md p-1"
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
      </div>

      {/* Hover tooltip — pre-escaped HTML (escapeHtml at every interpolation
          site upstream), positioned at the deck.gl pick coords. Offset
          slightly so the cursor doesn't sit on top of the popup. */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 rounded px-3 py-2 text-xs"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            maxWidth: "280px",
            background: "rgba(13, 17, 23, 0.92)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.22)",
            color: "rgba(241,245,249,0.95)",
            fontFamily: "'Inter', sans-serif",
            boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
          }}
          dangerouslySetInnerHTML={{ __html: tooltip.html }}
        />
      )}
    </div>
  );
}
