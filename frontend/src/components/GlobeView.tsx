import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
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

interface GlobeViewProps {
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
  q1: [148, 163, 184] as [number, number, number], // slate-400 — muted
};

const HEAT_HEX = {
  q4: "#ef4444",
  q3: "#f97316",
  q2: "#e8a045",
  q1: "#94a3b8",
};

const CRUISE_PATH_COLOR: [number, number, number, number] = [80, 180, 255, 230];
const AIRPORT_DOT_COLOR: [number, number, number, number] = [251, 191, 36, 230];
const PORT_DOT_COLOR: [number, number, number, number] = [56, 189, 248, 230];

// Airport + port column markers. Height and radius are constant so all
// markers look identical regardless of visit count — magnitude encoding
// belongs on the arcs (heatmap colour), not duplicated on the dots.
const MARKER_HEIGHT_M = 70_000;
const MARKER_RADIUS_M = 12_000;

// Auto-rotate behaviour.
const AUTO_ROTATE_DEG_PER_SEC = 4;
const AUTO_ROTATE_PAUSE_MS = 3500;
const AUTO_ROTATE_RAMP_MS = 800;

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
  // `interleaved: true` shares MapLibre's WebGL context so deck.gl uses
  // MapLibre's globe projection matrices directly — without it, the
  // overlay falls back to mercator and the layers detach into a flat
  // strip floating beside the globe whenever the camera is rotated.
  //
  // No `position` here: MapboxOverlay isn't a corner control, it's a
  // render-pipeline integration. Passing a position option causes
  // react-map-gl to mount it as a corner widget, which can confuse the
  // overlay's lifecycle.
  //
  // Caller must gate this component until MapLibre is confirmed in
  // globe projection — see `mapReady` in GlobeView.
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ layers, pickingRadius: 5, interleaved: true })
  );
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

type Quartile = 1 | 2 | 3 | 4;

const getQuartile = (count: number, t: HeatmapThresholds): Quartile => {
  if (count > t.q75) return 4;
  if (count > t.q50) return 3;
  if (count > t.q25) return 2;
  return 1;
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

/**
 * Peak altitude (meters above ellipsoid) for a flight arc with the
 * given great-circle distance.
 *
 * Industry standard on 3D globes (vasturiano/globe.gl, Cesium,
 * Mapbox examples) is to scale altitude with distance, not with
 * earth-radius staircase: short hops barely lift, long hauls bow
 * modestly. Our previous radius-staircase peaked at 0.45 R ≈ 2 870
 * km for long-haul, which towered above the globe and created the
 * "Saturn ring" look the user reported.
 *
 * Formula: 12 % of great-circle distance, capped at 15 % of earth
 * radius. Yields:
 *
 *   500 km   →   60 km peak
 *   2 500 km →  300 km
 *   8 000 km →  960 km
 *  15 000 km → 1 800 km
 *  ≥19 800 km caller skips (antipodal — degenerate great-circle)
 */
const EARTH_RADIUS_M = 6_371_000;
const ARC_ALTITUDE_FRACTION = 0.12;
const ARC_ALTITUDE_CAP_M = EARTH_RADIUS_M * 0.15;

/**
 * Distance threshold above which a city pair is "near-antipodal" and
 * its great circle is degenerate (infinitely many shortest paths
 * through both poles). deck.gl/three.js arc tessellation in this
 * regime produces a visible "ring around the pole" — the SYD↔TFS
 * artifact the user reported. Earth half-circumference is ~20 015
 * km; 19 800 km gives a ~1° antipodal exclusion zone.
 */
const ANTIPODAL_DISTANCE_KM = 19_800;

const getArcPeakAltitudeMeters = (distanceKm: number): number =>
  Math.min(distanceKm * 1000 * ARC_ALTITUDE_FRACTION, ARC_ALTITUDE_CAP_M);

/**
 * Vertex count for the great-circle slerp. Fixed 48 was wasteful for
 * short hops (a 300 km flight needs maybe 10 segments to look smooth)
 * and barely enough for long-haul (12 000 km routes show visible
 * polygonal kinks at 48). Scaling cuts total vertex count roughly in
 * half on a typical mixed dataset, which matters on mobile / slow GPUs
 * where ColumnLayer + PathLayer + base map already saturate the
 * fragment-shader budget.
 *
 *   500 km   →  10 (clamped to 12)
 *   2 500 km →  16
 *   6 000 km →  28
 *  12 000 km →  48
 *  18 000 km →  64 (clamped)
 */
const ARC_STEPS_MIN = 12;
const ARC_STEPS_MAX = 64;
const ARC_STEPS_LITE = 16;
const getArcSteps = (distanceKm: number, lite: boolean): number =>
  lite
    ? ARC_STEPS_LITE
    : Math.min(ARC_STEPS_MAX, Math.max(ARC_STEPS_MIN, Math.round(distanceKm / 300) + 8));

// Auto-suggest performance mode when the visible payload crosses these
// thresholds. Tuned against the 160-flight + 22-cruise demo seed (which
// runs comfortably without lite) and field reports of jank around the
// 200-arc / 100-cruise mark on integrated GPUs.
const LITE_AUTO_ARC_THRESHOLD = 200;
const LITE_AUTO_CRUISE_THRESHOLD = 100;

/**
 * Great-circle slerp between two [lng, lat] points with a parabolic
 * z-altitude profile, returning N+1 [lng, lat, altitudeMeters]
 * waypoints along the geodesic. Altitude peaks at the midpoint and
 * tapers to zero at the endpoints — gives the classic Flightradar /
 * three.js-GlobeView arc bow.
 *
 * Why we need this: deck.gl ArcLayer with `greatCircle: true` computes
 * arc height in screen-space, which collapses to zero on MapLibre's
 * globe projection (arcs become invisible). PathLayer with
 * pre-tessellated 3D waypoints renders the curve through MapLibre's
 * regular line pipeline, and the z-coordinate is honoured radially in
 * globe projection — the path bows outward from the sphere.
 *
 * Math: convert each endpoint to a unit Cartesian vector, slerp by
 * `t = i / steps`, project back to spherical, apply z = peak·sin(πt).
 * Long-way-around is suppressed by unwrapping the longitude difference
 * into [-π, π] before slerping.
 */
const greatCircleWaypoints = (
  from: [number, number],
  to: [number, number],
  peakAltitudeM: number,
  steps = 48
): [number, number, number][] => {
  const toRad = (x: number): number => (x * Math.PI) / 180;
  const toDeg = (x: number): number => (x * 180) / Math.PI;
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lam1 = toRad(lng1);
  let lam2 = toRad(lng2);
  const lamDiff = lam2 - lam1;
  if (lamDiff > Math.PI) lam2 -= 2 * Math.PI;
  else if (lamDiff < -Math.PI) lam2 += 2 * Math.PI;

  const dPhi = phi2 - phi1;
  const dLam = lam2 - lam1;
  const aH = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(Math.max(0, 1 - aH)));
  if (c < 1e-9)
    return [
      [lng1, lat1, 0],
      [lng2, lat2, 0],
    ];

  const sinC = Math.sin(c);
  const out: [number, number, number][] = [];
  // Continuous-longitude unwrapping: atan2 always returns lng in
  // (-180, 180], so a great circle that crosses the antimeridian would
  // emit a 360° jump between consecutive samples (e.g. 179 → -179).
  // PathLayer interprets that jump as "wrap around the whole globe"
  // and renders a phantom polyline circling the planet — the ghost
  // arcs the user reported. We unwrap each sample to stay within ±180
  // of the previous one so the polyline is mathematically monotone.
  // MapLibre globe projection accepts lng > 180 / < -180 (it's the
  // same point on the sphere), so the visible arc lands exactly where
  // it should. Pair this with `wrapLongitude: false` on PathLayer.
  let prevLng = lng1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const A = Math.sin((1 - t) * c) / sinC;
    const B = Math.sin(t * c) / sinC;
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let lng = toDeg(Math.atan2(y, x));
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    const altitude = peakAltitudeM * Math.sin(Math.PI * t);
    out.push([lng, lat, altitude]);
  }
  return out;
};

/**
 * Approximate sub-solar point (where the sun is directly overhead) at
 * a given UTC date. Uses Cooper's equation for solar declination and
 * the standard 15°/h rotation for the longitude. Accurate to ~1° —
 * good enough for a visualization terminator (the real terminator is
 * itself ~1° wide due to the sun's angular diameter + atmospheric
 * refraction so anyone wanting astrophysical precision would be
 * looking elsewhere).
 */
const sunDeclinationDeg = (date: Date): number => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000);
  return 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
};
const subSolarPoint = (date: Date): [number, number] => {
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lng = -15 * (utcHours - 12);
  return [lng, sunDeclinationDeg(date)];
};

/**
 * Tessellate the night terminator: the great circle 90° from the
 * sub-solar point. Result is a closed [lng, lat] ring with
 * monotone-unwrapped longitudes so PathLayer doesn't draw the
 * phantom-wrap artifact across the antimeridian.
 */
const terminatorRing = (date: Date, steps = 96): [number, number][] => {
  const toRad = (x: number): number => (x * Math.PI) / 180;
  const toDeg = (x: number): number => (x * 180) / Math.PI;
  const [sunLng, sunLat] = subSolarPoint(date);
  const phiS = toRad(sunLat);
  const lamS = toRad(sunLng);
  // Build orthonormal basis with sun direction as +Z.
  const sx = Math.cos(phiS) * Math.cos(lamS);
  const sy = Math.cos(phiS) * Math.sin(lamS);
  const sz = Math.sin(phiS);
  // East = z × sun (axis perpendicular to sun pointing east in tangent plane)
  const ex = -sy;
  const ey = sx;
  const ez = 0;
  const eMag = Math.hypot(ex, ey, ez) || 1;
  const ux = ex / eMag;
  const uy = ey / eMag;
  const uz = ez / eMag;
  // North = sun × east
  const nx = sy * uz - sz * uy;
  const ny = sz * ux - sx * uz;
  const nz = sx * uy - sy * ux;
  const out: [number, number][] = [];
  let prevLng = NaN;
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // Point on great circle 90° from sun: any combination of north/east basis.
    const x = c * ux + s * nx;
    const y = c * uy + s * ny;
    const z = c * uz + s * nz;
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let lng = toDeg(Math.atan2(y, x));
    if (Number.isFinite(prevLng)) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    out.push([lng, lat]);
  }
  return out;
};

interface ArcDatum {
  from: [number, number];
  to: [number, number];
  /**
   * Pre-tessellated great-circle path with parabolic z-altitude in
   * meters; first/last entries == [from, 0] / [to, 0]. The radial
   * altitude makes the path bow outward from the sphere on globe
   * projection, restoring the 3D arc look.
   */
  waypoints: [number, number, number][];
  count: number;
  flightIds: string[];
  color: [number, number, number];
  quartile: Quartile;
  departure: { iata?: string; name?: string };
  arrival: { iata?: string; name?: string };
  /**
   * Set when at least one constituent flight had no IATA on either
   * endpoint and we fell back to coordinate-rounded identity. The arc
   * may aggregate flights that were *almost* the same route — surfaced
   * to the user via a dashed style so they don't blindly trust the
   * count.
   */
  weak: boolean;
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
const createDirectionalKey = (a: string, b: string): string => `${a}→${b}`;

/**
 * Build a stable per-endpoint identity string. Prefers IATA, falls back
 * to rounded lat,lng (~11 km grid at the equator). Falling back to a
 * single sentinel like "UNK" would collapse every IATA-less flight into
 * one bucket and draw a single phantom mega-arc spanning whichever two
 * arbitrary endpoints happened to land first — exactly the bug Codex
 * spotted in this file.
 */
const endpointIdentity = (
  iata: string | undefined,
  lng: number,
  lat: number
): string => iata ?? `@${lng.toFixed(1)},${lat.toFixed(1)}`;

export default function GlobeView({
  flights = [],
  cruises = [],
  onFlightClick,
  minRouteCount = 1,
}: GlobeViewProps): JSX.Element {
  const { t } = useTranslation(["map"]);
  const mapRef = useRef<MapRef>(null);

  const [styleId, setStyleId] = useState<StyleId>(() => {
    if (typeof window === "undefined") return "standard";
    const stored = window.sessionStorage.getItem("globeStyleId");
    return STYLE_OPTIONS.some((s) => s.id === stored) ? (stored as StyleId) : "standard";
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Directional mode: when true, A→B and B→A are aggregated as separate
  // arcs so out-/return-leg imbalance shows up in the heatmap. Default
  // false keeps the current "city pair" aggregation.
  const [directional, setDirectional] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("globeDirectional") === "1";
  });
  // Performance mode: drops arc tessellation to a flat 16 steps,
  // halves column disk resolution, and disables auto-highlight on
  // pickable layers. Tri-state: "auto" lets the dataset thresholds
  // decide; "on" / "off" override forever (within a session).
  type LiteMode = "auto" | "on" | "off";
  const [liteMode, setLiteMode] = useState<LiteMode>(() => {
    if (typeof window === "undefined") return "auto";
    const stored = window.sessionStorage.getItem("globeLiteMode");
    return stored === "on" || stored === "off" ? stored : "auto";
  });
  const onLiteModeChange = useCallback((next: LiteMode) => {
    setLiteMode(next);
    try {
      window.sessionStorage.setItem("globeLiteMode", next);
    } catch {
      // sessionStorage may be unavailable in private mode — opt-in only
    }
  }, []);
  // Resolved boolean: lite is on if user forced it, OR auto + dataset
  // crosses one of the size thresholds. Recomputed every render — the
  // inputs are O(1) numbers so the cost is invisible.
  const lite = useMemo(() => {
    if (liteMode === "on") return true;
    if (liteMode === "off") return false;
    return (
      flights.length >= LITE_AUTO_ARC_THRESHOLD ||
      cruises.length >= LITE_AUTO_CRUISE_THRESHOLD
    );
  }, [liteMode, flights.length, cruises.length]);
  // Day/night terminator: thick semi-transparent dark band along the
  // great circle 90° from the sub-solar point. Anchored to the slider
  // currentDate in live mode, otherwise to "now" — so scrubbing the
  // timeline shows the terminator advance through the day.
  const [terminator, setTerminator] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("globeTerminator") === "1";
  });
  const onTerminatorChange = useCallback((next: boolean) => {
    setTerminator(next);
    try {
      window.sessionStorage.setItem("globeTerminator", next ? "1" : "0");
    } catch {
      // sessionStorage may be unavailable in private mode — opt-in only
    }
  }, []);
  // Bloom: render a wider, low-alpha clone of the arc layer underneath
  // the main one. Costs ~one extra draw call per arc — automatically
  // suppressed in lite mode. Off by default; opt-in via the bottom-left
  // control stack.
  const [bloom, setBloom] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("globeBloom") === "1";
  });
  const onBloomChange = useCallback((next: boolean) => {
    setBloom(next);
    try {
      window.sessionStorage.setItem("globeBloom", next ? "1" : "0");
    } catch {
      // sessionStorage may be unavailable in private mode — opt-in only
    }
  }, []);
  // First-run coachmark: shown on the first ever globe visit, dismissed
  // forever via localStorage. The check defaults to false (i.e. "shown")
  // when localStorage is unreadable so the user always gets at least
  // one chance to see it; setting the flag is best-effort.
  const [coachmarkOpen, setCoachmarkOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("globeCoachmarkSeen") !== "1";
    } catch {
      return false;
    }
  });
  const dismissCoachmark = useCallback(() => {
    setCoachmarkOpen(false);
    try {
      window.localStorage.setItem("globeCoachmarkSeen", "1");
    } catch {
      // localStorage may be unavailable in private mode — opt-in only
    }
  }, []);
  // Pinned selection: persistent detail card the user opens by clicking
  // a marker / arc / cruise path. Survives mouse-move (unlike the
  // hover tooltip) so they can read details without holding still.
  const [pinned, setPinned] = useState<
    | { kind: "arc"; data: ArcDatum }
    | { kind: "airport"; data: PointDatum }
    | { kind: "port"; data: PointDatum }
    | { kind: "cruise"; data: CruisePathDatum }
    | null
  >(null);
  // null = no filter (all quartiles visible at full opacity). 1-4 =
  // dim every arc outside this quartile so the click-selected band
  // pops. Click the active band again to clear.
  const [activeQuartile, setActiveQuartile] = useState<Quartile | null>(null);
  // Gate the deck.gl overlay until MapLibre is confirmed in globe
  // projection. Otherwise MapboxOverlay's constructor (run inside
  // useControl, which fires *before* onLoad) caches the initial
  // mercator projection state and never re-detects globe — the
  // visible symptom is the deck.gl arcs and dots rendering as a
  // flat mercator strip pasted over the rotated globe (right-mouse
  // drag rotates the basemap but the layer band stays detached).
  const [mapReady, setMapReady] = useState(false);

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

  const onDirectionalChange = useCallback((next: boolean) => {
    setDirectional(next);
    try {
      window.sessionStorage.setItem("globeDirectional", next ? "1" : "0");
    } catch {
      // sessionStorage may be unavailable in private mode — opt-in only
    }
  }, []);

  // Apply globe projection + sky on initial load. Driven by
  // react-map-gl's onLoad — the only event that fires after the map ref
  // is guaranteed populated. Re-application after style swaps is owned
  // by the next effect.
  const onMapLoad = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      map.setProjection({ type: "globe" });
    } catch (err) {
      logger.warn("GlobeView: setProjection(globe) failed", err);
    }
    try {
      map.setSky(currentStyleRef.current.sky);
    } catch (err) {
      logger.warn("GlobeView: setSky failed", err);
    }
    // Now that globe projection is engaged, mount the deck.gl overlay.
    // Constructor will detect globe mode and compile globe-aware shaders.
    setMapReady(true);
  }, []);

  // Re-apply globe projection + sky after every style swap. MapLibre
  // resets both when replacing the style, so we listen for `style.load`
  // and reapply. Owned by its own effect with explicit cleanup so a
  // remount or strict-mode double-invoke doesn't stack listeners — every
  // stacked listener would re-apply projection on the next style load
  // and slow the swap down linearly.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const reapply = (): void => {
      try {
        map.setProjection({ type: "globe" });
      } catch (err) {
        logger.warn("GlobeView: setProjection(globe) failed", err);
      }
      try {
        map.setSky(currentStyleRef.current.sky);
      } catch (err) {
        logger.warn("GlobeView: setSky failed", err);
      }
    };
    map.on("style.load", reapply);
    return () => {
      map.off("style.load", reapply);
    };
  }, [mapReady]);

  // Auto-rotation loop. Drives `map.jumpTo` ~60 fps with a constant
  // angular velocity (4 deg/s = one revolution / 90 s).
  //
  // Pauses on any user interaction (pointerdown / wheel / touchstart)
  // for AUTO_ROTATE_PAUSE_MS so the globe doesn't keep spinning while
  // the user is pinning a tooltip or zooming in. After the pause
  // expires, the angular velocity ramps from 0 → full over
  // AUTO_ROTATE_RAMP_MS so resume feels like a gentle acceleration
  // rather than a jerk.
  useEffect(() => {
    if (!autoRotate) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const container = map.getContainer();
    let raf = 0;
    let lastT = performance.now();
    let pausedUntil = 0;
    const onInteract = (): void => {
      pausedUntil = performance.now() + AUTO_ROTATE_PAUSE_MS;
    };
    const tick = (now: number): void => {
      const dt = now - lastT;
      lastT = now;
      const pauseRemaining = pausedUntil - now;
      if (pauseRemaining < 0) {
        const sinceResume = -pauseRemaining;
        const ramp = Math.min(1, sinceResume / AUTO_ROTATE_RAMP_MS);
        const center = map.getCenter();
        const newLng =
          ((center.lng + (dt * AUTO_ROTATE_DEG_PER_SEC * ramp) / 1000 + 540) % 360) - 180;
        map.jumpTo({ center: [newLng, center.lat] });
      }
      raf = requestAnimationFrame(tick);
    };
    container.addEventListener("pointerdown", onInteract);
    container.addEventListener("wheel", onInteract, { passive: true });
    container.addEventListener("touchstart", onInteract, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("pointerdown", onInteract);
      container.removeEventListener("wheel", onInteract);
      container.removeEventListener("touchstart", onInteract);
    };
  }, [autoRotate]);

  // Aggregate flights into city-pair routes with count + heatmap colour.
  const { arcsData, antipodalArcs, heatmapThresholds } = useMemo(() => {
    interface RouteAcc {
      count: number;
      from: [number, number];
      to: [number, number];
      flightIds: string[];
      departure: { iata?: string; name?: string };
      arrival: { iata?: string; name?: string };
      weak: boolean;
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
      const depKey = endpointIdentity(dep?.iata, start[0], start[1]);
      const arrKey = endpointIdentity(arr?.iata, end[0], end[1]);
      // Weak when either endpoint had no IATA — endpointIdentity then
      // falls back to a coord-rounded sentinel. This may collapse
      // multiple flights that were similar-but-not-identical routes.
      const flightWeak = !dep?.iata || !arr?.iata;
      const key = directional
        ? createDirectionalKey(depKey, arrKey)
        : createRouteKey(depKey, arrKey);
      const existing = routes.get(key);
      if (existing) {
        existing.count++;
        existing.flightIds.push(flight.properties.id);
        if (flightWeak) existing.weak = true;
      } else {
        routes.set(key, {
          count: 1,
          from: [start[0], start[1]],
          to: [end[0], end[1]],
          flightIds: [flight.properties.id],
          departure: dep ?? {},
          arrival: arr ?? {},
          weak: flightWeak,
        });
      }
    }
    const counts = Array.from(routes.values()).map((r) => r.count);
    const thresholds = calculateHeatmapThresholds(counts);
    const arcs: ArcDatum[] = [];
    const antipodals: ArcDatum[] = [];
    for (const r of routes.values()) {
      if (r.count < minRouteCount) continue;
      const distanceKm = calculateDistance(r.from[1], r.from[0], r.to[1], r.to[0]);
      // Antipodal pairs (e.g. SYD↔TFS, ~19 900 km) have a degenerate
      // great circle: the slerp picks an arbitrary polar path. Render
      // them as a flat surface line at altitude 0 so the route still
      // appears visually, but without the polar-ring artifact a high-
      // altitude arc would produce.
      const quartile = getQuartile(r.count, thresholds);
      if (distanceKm >= ANTIPODAL_DISTANCE_KM) {
        antipodals.push({
          from: r.from,
          to: r.to,
          waypoints: greatCircleWaypoints(r.from, r.to, 0, getArcSteps(distanceKm, lite)),
          count: r.count,
          flightIds: r.flightIds,
          departure: r.departure,
          arrival: r.arrival,
          color: getHeatmapColor(r.count, thresholds),
          quartile,
          weak: r.weak,
        });
        continue;
      }
      const peakAltitudeM = getArcPeakAltitudeMeters(distanceKm);
      arcs.push({
        from: r.from,
        to: r.to,
        waypoints: greatCircleWaypoints(r.from, r.to, peakAltitudeM, getArcSteps(distanceKm, lite)),
        count: r.count,
        flightIds: r.flightIds,
        departure: r.departure,
        arrival: r.arrival,
        color: getHeatmapColor(r.count, thresholds),
        quartile,
        weak: r.weak,
      });
    }
    return { arcsData: arcs, antipodalArcs: antipodals, heatmapThresholds: thresholds };
  }, [filteredFlights, minRouteCount, directional, lite]);

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
        logger.error("GlobeView: cruise geometry batch fetch failed", err);
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

  // Terminator path: closed great-circle ring 90° from the sub-solar
  // point at the slider's current date (live mode) or now (otherwise).
  // Recomputed only when the time changes — not every render. Empty
  // array when the toggle is off so the layer skips rendering entirely.
  const terminatorPath = useMemo<[number, number][]>(() => {
    if (!terminator) return [];
    const date = sliderMode === "live" && sliderCurrent ? sliderCurrent : new Date();
    return terminatorRing(date);
  }, [terminator, sliderMode, sliderCurrent]);

  // Live stats overlay: derived from the same slider-filtered data as
  // the layers, so the numbers move in lockstep with the time slider.
  // Cheap because everything is already memoised upstream.
  const liveStats = useMemo(() => {
    let flightKm = 0;
    for (const f of filteredFlights) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const start = coords[0];
      const end = coords[coords.length - 1];
      if (![start[0], start[1], end[0], end[1]].every(Number.isFinite)) continue;
      flightKm += calculateDistance(start[1], start[0], end[1], end[0]);
    }
    const topAirport = airportPoints.reduce<PointDatum | null>(
      (best, p) => (best && best.size >= p.size ? best : p),
      null
    );
    const cruiseCount = new Set(cruisePaths.map((c) => c.cruiseId)).size;
    return {
      flights: filteredFlights.length,
      routes: arcsData.length + antipodalArcs.length,
      flightKm: Math.round(flightKm),
      cruises: cruiseCount,
      ports: portPoints.length,
      topAirport,
    };
  }, [filteredFlights, airportPoints, cruisePaths, portPoints, arcsData, antipodalArcs]);

  // Re-center: fly back to the initial overview pose. Useful after the
  // user has zoomed deep or panned far and wants a quick reset without
  // hunting for the right zoom level.
  const onRecenter = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.flyTo({
      center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
      zoom: INITIAL_VIEW_STATE.zoom,
      bearing: INITIAL_VIEW_STATE.bearing,
      pitch: INITIAL_VIEW_STATE.pitch,
      duration: 1200,
    });
  }, []);

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
      // Day/night terminator — drawn first so everything else renders
      // above it. Wide stroke gives a "twilight band" look without
      // needing a SolidPolygonLayer fill (which doesn't compose well
      // with great-circle polygons in globe projection).
      ...(terminator && terminatorPath.length > 0
        ? [
            new PathLayer<[number, number][]>({
              id: "globe-terminator",
              data: [terminatorPath],
              getPath: (d) => d,
              getColor: [10, 14, 26, 165],
              getWidth: 28,
              widthUnits: "pixels",
              widthMinPixels: 18,
              widthMaxPixels: 38,
              capRounded: true,
              jointRounded: true,
              wrapLongitude: false,
              pickable: false,
            }),
          ]
        : []),
      // Optional bloom underlay — wider, low-alpha clone of the flight
      // arcs, drawn first so the main arcs render on top. Suppressed in
      // lite mode (the extra draw call defeats the purpose) and when
      // off by toggle. Same waypoints as the main layer, no picking
      // (the pickable main layer above already handles all interaction).
      ...(bloom && !lite
        ? [
            new PathLayer<ArcDatum>({
              id: "globe-flight-arcs-bloom",
              data: arcsData,
              getPath: (d) => d.waypoints,
              getColor: (d) =>
                [
                  ...d.color,
                  activeQuartile === null || activeQuartile === d.quartile ? 70 : 8,
                ] as [number, number, number, number],
              updateTriggers: { getColor: [activeQuartile] },
              getWidth: (d) => Math.max(6, Math.min(14, 6 + Math.log2(d.count + 1) * 2)),
              widthUnits: "pixels",
              widthMinPixels: 6,
              widthMaxPixels: 14,
              capRounded: true,
              jointRounded: true,
              wrapLongitude: false,
              pickable: false,
            }),
          ]
        : []),
      // Flight arcs as PathLayer with pre-tessellated great-circle
      // waypoints. ArcLayer.greatCircle is broken on globe projection
      // (height computed in screen-space → invisible) — explicit
      // waypoints sidestep the issue and the curve looks identical.
      // Dash extension is attached so that arcs aggregated from
      // metadata-weak flights (no IATA) render dashed; strong arcs
      // get a [0,0] dash array which the extension treats as solid.
      new PathLayer<ArcDatum>({
        id: "globe-flight-arcs",
        data: arcsData,
        getPath: (d) => d.waypoints,
        getColor: (d) =>
          [
            ...d.color,
            activeQuartile === null || activeQuartile === d.quartile ? 235 : 35,
          ] as [number, number, number, number],
        updateTriggers: { getColor: [activeQuartile] },
        getWidth: (d) => Math.max(1.5, Math.min(4, 1.5 + Math.log2(d.count + 1))),
        widthUnits: "pixels",
        widthMinPixels: 1.5,
        widthMaxPixels: 4,
        capRounded: true,
        jointRounded: true,
        // Waypoints are pre-unwrapped (lng can exceed ±180 to stay
        // monotone across the antimeridian). PathLayer's own wrapping
        // would cut them at ±180 and create the phantom-ring artifact.
        wrapLongitude: false,
        pickable: true,
        autoHighlight: !lite,
        highlightColor: [255, 255, 255, 180],
        onHover: onArcHover,
        onClick: ({ object }: { object?: ArcDatum }): void => {
          if (!object) return;
          setPinned({ kind: "arc", data: object });
          flyToArc(object);
        },
        extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
        getDashArray: (d: ArcDatum) => (d.weak ? [4, 3] : [0, 0]),
        dashJustified: true,
        dashGapPickable: false,
      } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] & PathStyleExtensionProps<ArcDatum>),
      // Antipodal routes (>= ANTIPODAL_DISTANCE_KM) — flat surface
      // line at altitude 0, narrower than normal arcs and slightly
      // muted, so the route still appears visually but doesn't grab
      // the eye like a real arc would. Counter shown in the legend.
      new PathLayer<ArcDatum>({
        id: "globe-flight-arcs-antipodal",
        data: antipodalArcs,
        getPath: (d) => d.waypoints,
        getColor: (d) =>
          [
            ...d.color,
            activeQuartile === null || activeQuartile === d.quartile ? 160 : 25,
          ] as [number, number, number, number],
        updateTriggers: { getColor: [activeQuartile] },
        getWidth: 1,
        widthUnits: "pixels",
        widthMinPixels: 1,
        widthMaxPixels: 1.5,
        capRounded: true,
        jointRounded: true,
        wrapLongitude: false,
        pickable: true,
        autoHighlight: !lite,
        highlightColor: [255, 255, 255, 180],
        onHover: onArcHover,
        onClick: ({ object }: { object?: ArcDatum }): void => {
          if (object) setPinned({ kind: "arc", data: object });
        },
      }),
      // Cruise paths render as a dashed "wake" — a long stroke + short
      // gap pattern visually distinguishes ship routes from the solid
      // flight arcs without needing a different colour. PathStyleExtension
      // ships its own shader; high-precision dashes work in globe
      // projection without the dash length scaling weirdly with zoom.
      // Cast: PathStyleExtension augments PathLayer props at runtime,
      // but @deck.gl/extensions doesn't merge those keys into PathLayer's
      // TS surface. Cast the whole config so the dash props reach the
      // constructor while keeping the rest literal-checked.
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
        extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
        getDashArray: [6, 3],
        dashJustified: true,
        dashGapPickable: false,
        pickable: true,
        autoHighlight: !lite,
        highlightColor: [255, 255, 255, 180],
        onHover: onCruisePathHover,
        onClick: ({ object }: { object?: CruisePathDatum }): void => {
          if (object) setPinned({ kind: "cruise", data: object });
        },
      } as ConstructorParameters<typeof PathLayer<CruisePathDatum>>[0] & PathStyleExtensionProps<CruisePathDatum>),
      // Airport + port markers as ColumnLayer (3D cylinders rendered
      // radially outward from the globe surface). Replaces the old
      // ScatterplotLayer dots that clipped into the sphere when viewed
      // from a low pitch — same visual idiom react-globe.gl used. Size
      // is intentionally constant (height + radius identical for every
      // marker): visit count is already encoded by the heatmap colour
      // on the arcs, so dual-encoding it here makes hub clusters
      // visually overwhelming without adding information.
      new ColumnLayer<PointDatum>({
        id: "globe-airport-columns",
        data: airportPoints,
        getPosition: (d) => d.position,
        getFillColor: AIRPORT_DOT_COLOR,
        getElevation: MARKER_HEIGHT_M,
        elevationScale: 1,
        radius: MARKER_RADIUS_M,
        diskResolution: lite ? 8 : 16,
        extruded: true,
        material: false,
        pickable: true,
        autoHighlight: !lite,
        highlightColor: [255, 255, 255, 200],
        onHover: onAirportHover,
        onClick: ({ object }: { object?: PointDatum }): void => {
          if (object) setPinned({ kind: "airport", data: object });
        },
      }),
      new ColumnLayer<PointDatum>({
        id: "globe-port-columns",
        data: portPoints,
        getPosition: (d) => d.position,
        getFillColor: PORT_DOT_COLOR,
        getElevation: MARKER_HEIGHT_M,
        elevationScale: 1,
        radius: MARKER_RADIUS_M,
        diskResolution: lite ? 8 : 16,
        extruded: true,
        material: false,
        pickable: true,
        autoHighlight: !lite,
        highlightColor: [255, 255, 255, 200],
        onHover: onPortHover,
        onClick: ({ object }: { object?: PointDatum }): void => {
          if (object) setPinned({ kind: "port", data: object });
        },
      }),
    ],
    [
      arcsData,
      antipodalArcs,
      cruisePaths,
      airportPoints,
      portPoints,
      activeQuartile,
      lite,
      bloom,
      terminator,
      terminatorPath,
      flyToArc,
      onArcHover,
      onAirportHover,
      onCruisePathHover,
      onPortHover,
      onFlightClick,
    ]
  );

  const legendRanges = useMemo<Array<{ q: Quartile; color: string; label: string }>>(
    () => [
      { q: 1, color: HEAT_HEX.q1, label: `1–${Math.max(heatmapThresholds.q25, 1)}×` },
      {
        q: 2,
        color: HEAT_HEX.q2,
        label: `${heatmapThresholds.q25 + 1}–${heatmapThresholds.q50}×`,
      },
      {
        q: 3,
        color: HEAT_HEX.q3,
        label: `${heatmapThresholds.q50 + 1}–${heatmapThresholds.q75}×`,
      },
      {
        q: 4,
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
        // Right-mouse drag-rotate / pitch is disabled on the globe.
        // The deck.gl overlay's MapLibre-globe sync isn't reliable
        // under bearing+pitch changes (layers detach into a flat
        // mercator strip), and the basemap is already a 3D sphere —
        // pan + zoom give a complete navigation model on a globe.
        // The Auto-Rotation toggle covers the "watch it spin" use case.
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        style={{ width: "100%", height: "100%" }}
      >
        {mapReady && <DeckGLOverlay layers={layers} />}
      </MapGL>

      {/* Top-left stats overlay — driven by the same slider-filtered data
          as the globe layers, so numbers tick in real time as the user
          scrubs the timeline. Hidden when there's nothing visible. */}
      {(liveStats.flights > 0 || liveStats.cruises > 0) && (
        <div
          className="absolute top-4 left-4 z-10"
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
              minWidth: 160,
            }}
          >
            <div className="mb-1.5 text-[11px] font-semibold opacity-90">
              {t("map:globe.stats.title")}
            </div>
            <div className="space-y-0.5 text-[11px]">
              {liveStats.flights > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="opacity-75">{t("map:globe.stats.flights")}</span>
                  <span className="font-medium tabular-nums">{liveStats.flights}</span>
                </div>
              )}
              {liveStats.routes > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="opacity-75">{t("map:globe.stats.routes")}</span>
                  <span className="font-medium tabular-nums">{liveStats.routes}</span>
                </div>
              )}
              {liveStats.flightKm > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="opacity-75">{t("map:globe.stats.flightKm")}</span>
                  <span className="font-medium tabular-nums">
                    {liveStats.flightKm.toLocaleString()} km
                  </span>
                </div>
              )}
              {liveStats.cruises > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="opacity-75">{t("map:globe.stats.cruises")}</span>
                  <span className="font-medium tabular-nums">{liveStats.cruises}</span>
                </div>
              )}
              {liveStats.ports > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="opacity-75">{t("map:globe.stats.ports")}</span>
                  <span className="font-medium tabular-nums">{liveStats.ports}</span>
                </div>
              )}
              {liveStats.topAirport && (
                <div className="mt-1.5 border-t pt-1 text-[10px] opacity-80"
                  style={{ borderColor: "rgba(255,255,255,0.12)" }}
                >
                  <span className="opacity-75">{t("map:globe.stats.top")}:</span>{" "}
                  <span className="font-medium">
                    {liveStats.topAirport.iata ?? liveStats.topAirport.name}
                  </span>
                  <span className="ml-1 opacity-60">×{liveStats.topAirport.size}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
          <label
            className="mt-1.5 flex cursor-pointer select-none items-center gap-2"
            title={t("map:globe.directionalHint")}
          >
            <input
              type="checkbox"
              checked={directional}
              onChange={(e) => onDirectionalChange(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="text-xs font-medium">↔ {t("map:globe.directional")}</span>
          </label>
          <label
            className="mt-1.5 flex cursor-pointer select-none items-center gap-2"
            title={t("map:globe.bloomHint")}
            style={{ opacity: lite ? 0.45 : 1 }}
          >
            <input
              type="checkbox"
              checked={bloom}
              disabled={lite}
              onChange={(e) => onBloomChange(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="text-xs font-medium">✨ {t("map:globe.bloom")}</span>
          </label>
          <label
            className="mt-1.5 flex cursor-pointer select-none items-center gap-2"
            title={t("map:globe.terminatorHint")}
          >
            <input
              type="checkbox"
              checked={terminator}
              onChange={(e) => onTerminatorChange(e.target.checked)}
              className="cursor-pointer"
            />
            <span className="text-xs font-medium">🌓 {t("map:globe.terminator")}</span>
          </label>
          <button
            type="button"
            onClick={onRecenter}
            className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs transition-colors"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(241,245,249,0.95)",
            }}
            title={t("map:globe.recenterHint")}
          >
            <span aria-hidden>🧭</span>
            <span className="font-medium">{t("map:globe.recenter")}</span>
          </button>
          <div
            className="mt-1.5 flex items-center justify-between gap-2"
            title={t("map:globe.performanceHint")}
          >
            <span className="text-xs font-medium">⚡ {t("map:globe.performance")}</span>
            <select
              value={liteMode}
              onChange={(e) => onLiteModeChange(e.target.value as LiteMode)}
              className="cursor-pointer rounded px-1.5 py-0.5 text-[11px]"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "rgba(241,245,249,0.95)",
              }}
            >
              <option value="auto">
                {t("map:globe.performanceAuto")} ({lite ? t("map:globe.performanceOn") : t("map:globe.performanceOff")})
              </option>
              <option value="on">{t("map:globe.performanceOn")}</option>
              <option value="off">{t("map:globe.performanceOff")}</option>
            </select>
          </div>
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
              {legendRanges.map(({ q, color, label }) => {
                const active = activeQuartile === q;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setActiveQuartile(active ? null : q)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 transition-colors"
                    style={{
                      background: active ? "rgba(255,255,255,0.10)" : "transparent",
                      opacity: activeQuartile === null || active ? 1 : 0.55,
                    }}
                    title={t("map:globe.quartileFilterHint")}
                  >
                    <div className="h-0.5 w-7" style={{ backgroundColor: color }} />
                    <span className="text-[11px]">{label}</span>
                  </button>
                );
              })}
            </div>
            {activeQuartile !== null && (
              <button
                type="button"
                onClick={() => setActiveQuartile(null)}
                className="mt-1.5 cursor-pointer text-[10px] underline opacity-70 hover:opacity-100"
              >
                {t("map:globe.quartileFilterClear")}
              </button>
            )}
            {antipodalArcs.length > 0 && (
              <div
                className="mt-2 border-t pt-1.5 text-[10px] opacity-70"
                style={{ borderColor: "rgba(255,255,255,0.12)" }}
              >
                {t("map:globe.antipodalSimplified", { count: antipodalArcs.length })}
              </div>
            )}
            {arcsData.some((a) => a.weak) && (
              <div
                className="mt-2 flex items-center gap-2 border-t pt-1.5 text-[10px] opacity-75"
                style={{ borderColor: "rgba(255,255,255,0.12)" }}
                title={t("map:globe.weakHint")}
              >
                <svg width="28" height="2" viewBox="0 0 28 2" aria-hidden>
                  <line
                    x1="0"
                    y1="1"
                    x2="28"
                    y2="1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                </svg>
                <span>{t("map:globe.weak")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top-center: time slider. Lives in its own opaque bar so
          mode toggles (Off / Live / Filter) read clearly against any
          basemap. Style picker stays bottom-center below. */}
      <div
        className="absolute top-3 left-1/2 z-10 -translate-x-1/2"
        style={{ pointerEvents: "auto" }}
      >
        <GlobeTimeSlider
          visibleFlights={filteredFlights.length}
          visibleCruises={new Set(cruisePaths.map((p) => p.cruiseId)).size}
        />
      </div>

      {/* Bottom-center: basemap style picker, flush with the screen edge. */}
      <div
        className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2"
        style={{ pointerEvents: "auto" }}
      >
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

      {/* First-run coachmark — semi-modal centered hint, dismissible
          forever via localStorage. Backdrop is click-through so
          autoload basemap interaction isn't blocked silently if the
          card is missed; only the card itself catches pointer. */}
      {coachmarkOpen && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="rounded-lg p-5 text-sm"
            style={{
              pointerEvents: "auto",
              maxWidth: 420,
              background: "rgba(13, 17, 23, 0.96)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(240,169,71,0.45)",
              color: "rgba(241,245,249,0.95)",
              fontFamily: "'Inter', sans-serif",
              boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
            }}
          >
            <div className="mb-2 text-base font-semibold">
              {t("map:globe.coachmark.title")}
            </div>
            <ul className="mb-4 space-y-1.5 text-[12px] opacity-90">
              <li>🖱️ {t("map:globe.coachmark.pan")}</li>
              <li>🔍 {t("map:globe.coachmark.zoom")}</li>
              <li>📍 {t("map:globe.coachmark.click")}</li>
              <li>↔ {t("map:globe.coachmark.directional")}</li>
              <li>🌍 {t("map:globe.coachmark.autoRotate")}</li>
            </ul>
            <button
              type="button"
              onClick={dismissCoachmark}
              className="w-full cursor-pointer rounded px-3 py-2 text-[12px] font-medium transition-colors"
              style={{
                background: "rgba(240,169,71,0.22)",
                border: "1px solid rgba(240,169,71,0.55)",
                color: "rgba(255,205,128,1)",
              }}
            >
              {t("map:globe.coachmark.dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Pinned detail card — persists after click until explicitly
          dismissed. Sits bottom-right so it doesn't fight the legend
          (bottom-left), style picker (bottom-center), or stats overlay
          (top-left). Includes a "Details" CTA on flight arcs that
          delegates to the parent's onFlightClick to open the full
          flight page. */}
      {pinned && (
        <div
          className="absolute right-4 bottom-4 z-20"
          style={{ pointerEvents: "auto", maxWidth: 280 }}
        >
          <div
            className="rounded-md p-3 text-xs"
            style={{
              background: "rgba(13, 17, 23, 0.92)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.22)",
              color: "rgba(241,245,249,0.95)",
              fontFamily: "'Inter', sans-serif",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              minWidth: 220,
            }}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="text-[12px] font-semibold">
                {pinned.kind === "arc" && (
                  <>
                    {pinned.data.departure.iata ?? "?"} {directional ? "→" : "↔"}{" "}
                    {pinned.data.arrival.iata ?? "?"}
                  </>
                )}
                {pinned.kind === "airport" && <>✈️ {pinned.data.iata}</>}
                {pinned.kind === "port" && <>⚓ {pinned.data.name}</>}
                {pinned.kind === "cruise" && <>🚢 {pinned.data.cruiseLabel}</>}
              </div>
              <button
                type="button"
                aria-label="close"
                onClick={() => setPinned(null)}
                className="cursor-pointer rounded px-1 text-[11px] leading-none opacity-70 hover:opacity-100"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                ✕
              </button>
            </div>
            {pinned.kind === "arc" && (
              <div className="space-y-1 text-[11px]">
                <div className="opacity-85">
                  {pinned.data.departure.name ?? pinned.data.departure.iata ?? "?"} →{" "}
                  {pinned.data.arrival.name ?? pinned.data.arrival.iata ?? "?"}
                </div>
                <div
                  style={{
                    color: `rgb(${pinned.data.color[0]},${pinned.data.color[1]},${pinned.data.color[2]})`,
                    fontWeight: 600,
                  }}
                >
                  {t("map:globe.timesFlown", { count: pinned.data.count })}
                </div>
                {onFlightClick && pinned.data.flightIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const last = pinned.data.flightIds[pinned.data.flightIds.length - 1];
                      onFlightClick(last);
                    }}
                    className="mt-2 cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      background: "rgba(240,169,71,0.18)",
                      border: "1px solid rgba(240,169,71,0.45)",
                      color: "rgba(255,205,128,1)",
                    }}
                  >
                    {t("map:globe.openLastFlight")}
                  </button>
                )}
              </div>
            )}
            {pinned.kind === "airport" && (
              <div className="space-y-1 text-[11px]">
                <div className="opacity-85">{pinned.data.name}</div>
                <div style={{ color: "#fbbf24", fontWeight: 600 }}>
                  {pinned.data.size}{" "}
                  {t("map:globe.flight", { count: pinned.data.size })}
                </div>
              </div>
            )}
            {pinned.kind === "port" && (
              <div className="space-y-1 text-[11px]">
                {pinned.data.iata !== pinned.data.name && (
                  <div className="opacity-85">{pinned.data.iata}</div>
                )}
                <div style={{ color: "#7dd3fc", fontWeight: 600 }}>
                  {pinned.data.size} {t("map:airportMarkers.visits")}
                </div>
              </div>
            )}
            {pinned.kind === "cruise" && (
              <div className="text-[11px] opacity-85">
                {t("map:visMode.tripRoutes")}
              </div>
            )}
          </div>
        </div>
      )}

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
