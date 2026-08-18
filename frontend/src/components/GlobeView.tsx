import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "./Globe/EarthOcclusionExtension";
import {
  ANTIPODAL_DISTANCE_KM,
  LITE_AUTO_ARC_THRESHOLD,
  LITE_AUTO_CRUISE_THRESHOLD,
  calculateDistance,
  createRouteKey,
  endpointIdentity,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "./Globe/arcUtils";
import {
  HEAT_HEX,
  calculateHeatmapThresholds,
  getHeatmapColor,
  getQuartile,
  type Quartile,
} from "./Globe/heatmapUtils";
import {
  buildGlobeLayers,
  DEFAULT_AIRPORT_COLOR,
  DEFAULT_PORT_COLOR,
} from "./Globe/buildGlobeLayers";
import { type AppearanceDomain } from "./map/controlPanelKit";
import type { LabelsMode } from "./map/labelPriority";
import { loadMapAppearance, saveMapAppearance } from "./map/mapAppearance";
import { loadGlobeChrome, saveGlobeChrome } from "./map/globeChrome";
import { useFlightColorStore } from "../store/flightColorStore";

// Base marker radius (px) a size preset scales. off → 0 (hidden).
const GLOBE_MARKER_BASE_PX = 5;
import { nightCells as computeNightCells } from "./Globe/sunPosition";
import { HoverTooltip, type HoverTooltipApi } from "./Globe/HoverTooltip";
import { PinnedCard } from "./Globe/PinnedCard";
import { PinnedCardBoundary } from "./Globe/PinnedCardBoundary";
import { GlobeLabelsOverlay } from "./Globe/GlobeLabelsOverlay";
import { toPortLabel } from "./map/portLabel";
import { applyMapOverlays } from "./Globe/mapOverlays";
import { GlobeControlPanel, type StyleId, type LiteMode } from "./Globe/GlobeControlPanel";
import type { ArcDatum, CruisePathDatum, GlobePinned, PointDatum } from "./Globe/globeLayerTypes";
import type { StyleSpecification } from "maplibre-gl";
import type { GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { resolveCruiseArcColor } from "../lib/cruiseColor";
import { useCruiseColorStore } from "../store/cruiseColorStore";
import { logger } from "../lib/logger";
import { escapeHtml } from "../lib/escapeHtml";
import { flagImgHtml, countryName } from "../lib/countryFlag";
import { useTranslation } from "../hooks/useTranslation";
import { useTimeSliderStore } from "../store/timeSliderStore";
import { GlobeTimeHistogram } from "./Globe/GlobeTimeHistogram";
import {
  computeCruiseLegDates,
  computeTimeRange,
  computeMonthlyBuckets,
  flightVisibleFilter,
  flightVisibleLive,
  legProgress,
  legVisibleFilter,
  truncatePolyline,
  type CruiseLegDates,
  type MonthBucket,
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
  /** Fired by the pinned-card "Open last flight" CTA — should open the
      flight (modal or detail page). */
  onFlightOpen?: (flightId: string) => void;
  /** Fired by the pinned-card "Open cruise" CTA — should navigate to
      the cruise detail page. */
  onCruiseOpen?: (cruiseId: string) => void;
  minRouteCount?: number;
  /** Which domain appearance sections the control panel exposes. Globe
      currently only mounts on the Alle tab, so this defaults to both. */
  appearanceDomains?: readonly AppearanceDomain[];
}

// ────────────────────────────────────────────────────────────────────
// Style options — six tokenless basemaps, modelled after geojson.io.
// CARTO + OpenFreeMap + ESRI World Imagery + OSM Standard. None of
// them require an API key.
// `StyleId` / `LiteMode` are defined in and imported from GlobeControlPanel
// so the panel and this component share one source of truth.
// ────────────────────────────────────────────────────────────────────

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
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

const SKY_DARK: SkyConfig = {
  "sky-color": "#0a0e1a",
  "horizon-color": "#3b3f5e",
  "fog-color": "#1f2937",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

const SKY_VOYAGER: SkyConfig = {
  "sky-color": "#1c2540",
  "horizon-color": "#7aa3c8",
  "fog-color": "#cfe0ee",
  "fog-ground-blend": 0.5,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
};

const SKY_SATELLITE: SkyConfig = {
  "sky-color": "#000814",
  "horizon-color": "#3a4a6e",
  "fog-color": "#0b1a2a",
  "fog-ground-blend": 0.4,
  "horizon-fog-blend": 0,
  "sky-horizon-blend": 0.7,
  "atmosphere-blend": 0,
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

function formatTooltipDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

interface DeckOverlayProps {
  layers: Layer[];
  onHover: (info: PickingInfo) => void;
}

function DeckGLOverlay({ layers, onHover }: DeckOverlayProps): null {
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
  // No `getTooltip` either: GlobeView renders its own rich React-state
  // tooltip via `onAirportHover` / `onPortHover` / `onArcHover` /
  // `onCruisePathHover`. Wiring `buildMarkerTooltip` here in addition
  // would stack two bubbles on the same hover (a deck.gl-rendered name
  // tooltip behind, and the React rich tooltip on top).
  //
  // Caller must gate this component until MapLibre is confirmed in
  // globe projection — see `mapReady` in GlobeView.
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 5,
        interleaved: true,
        onHover,
      })
  );
  overlay.setProps({ layers, onHover });
  return null;
}

export default function GlobeView({
  flights = [],
  cruises = [],
  onFlightOpen,
  onCruiseOpen,
  minRouteCount = 1,
  appearanceDomains = ["flight", "cruise"],
}: GlobeViewProps): JSX.Element {
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";
  const mapRef = useRef<MapRef>(null);

  const [styleId, setStyleId] = useState<StyleId>(() => {
    const stored = loadMapAppearance().styleId;
    return stored && STYLE_OPTIONS.some((s) => s.id === stored) ? (stored as StyleId) : "dark";
  });
  // Globe-only chrome — persisted in its own blob (globeChrome.v1), NOT in
  // the shared mapAppearance: these switches have no 2D meaning. They were
  // the only map settings that reset on reload before the 2026-08-03 audit.
  const [autoRotate, setAutoRotate] = useState(() => loadGlobeChrome().autoRotate ?? false);
  // Day/night terminator overlay. `nightTick` recomputes the night grid on a
  // slow interval so the shade drifts with real time (60 s is far finer than
  // the terminator visibly moves at globe zoom).
  const [showNight, setShowNight] = useState(() => loadGlobeChrome().showNight ?? true);
  useEffect(() => {
    saveGlobeChrome({ autoRotate, showNight });
  }, [autoRotate, showNight]);
  // Marker-label reveal: off / key markers only (greedy screen-space
  // collision, the default) / all (ignore overlap). Persisted.
  const [labelsMode, setLabelsMode] = useState<LabelsMode>(
    () => loadMapAppearance().labelsMode ?? "important"
  );
  // Map-appearance customisation (the panel's "Anpassung" section) plus
  // the style-level overlays, all persisted to localStorage so a user's
  // look survives reloads.
  //
  // Flight-domain route COLOUR is NOT local state: it lives in the shared
  // flight-colour store (mode + colours), which the flat map, both control
  // panels and the dashboard legend read too — so the globe can never show a
  // different colour than the 2D map for the same route.
  const flightColorConfig = useFlightColorStore((s) => s.config);
  const setFlightColorMode = useFlightColorStore((s) => s.setMode);
  const setFlightColor = useFlightColorStore((s) => s.setColor);
  const [flightRouteWidth, setFlightRouteWidth] = useState<number>(
    () => loadMapAppearance().flightRouteWidth ?? 1
  );
  // Marker colours are nullable: null = brand default (the "Auto" pill).
  const [airportColor, setAirportColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().airportColor ?? null
  );
  const [flightMarkerSize, setFlightMarkerSize] = useState<number>(
    () => loadMapAppearance().flightMarkerSize ?? 1
  );
  // Cruise-domain appearance. Route COLOUR is NOT local state either: it lives
  // in the shared cruise-colour store (mode + colours), so the globe, the flat
  // map, both panels and the dashboard legend cannot disagree about what a
  // cruise route looks like.
  const cruiseColorConfig = useCruiseColorStore((s) => s.config);
  const setCruiseColorMode = useCruiseColorStore((s) => s.setMode);
  const setCruiseColor = useCruiseColorStore((s) => s.setColor);
  const [cruiseRouteWidth, setCruiseRouteWidth] = useState<number>(
    () => loadMapAppearance().cruiseRouteWidth ?? 1
  );
  const [portColor, setPortColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().portColor ?? null
  );
  const [cruiseMarkerSize, setCruiseMarkerSize] = useState<number>(
    () => loadMapAppearance().cruiseMarkerSize ?? 1
  );
  // Style-level overlays (relief hillshade + basemap place names).
  const [showTerrain, setShowTerrain] = useState<boolean>(
    () => loadMapAppearance().showTerrain ?? false
  );
  const [showPlaceLabels, setShowPlaceLabels] = useState<boolean>(
    () => loadMapAppearance().showPlaceLabels ?? true
  );

  // Persist every appearance / overlay choice as one blob.
  useEffect(() => {
    saveMapAppearance({
      styleId,
      flightRouteWidth,
      airportColor,
      flightMarkerSize,
      cruiseRouteWidth,
      portColor,
      cruiseMarkerSize,
      showTerrain,
      showPlaceLabels,
      labelsMode,
    });
  }, [
    styleId,
    flightRouteWidth,
    airportColor,
    flightMarkerSize,
    cruiseRouteWidth,
    portColor,
    cruiseMarkerSize,
    showTerrain,
    showPlaceLabels,
    labelsMode,
  ]);

  // Mirror the overlay toggles into refs so the `style.load` re-apply
  // handler (which is created once) always reads the current values.
  const showTerrainRef = useRef(showTerrain);
  const showPlaceLabelsRef = useRef(showPlaceLabels);
  useEffect(() => {
    showTerrainRef.current = showTerrain;
  }, [showTerrain]);
  useEffect(() => {
    showPlaceLabelsRef.current = showPlaceLabels;
  }, [showPlaceLabels]);

  const [nightTick, setNightTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNightTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nightCellsData = useMemo(
    () => (showNight ? computeNightCells(new Date(nightTick)) : []),
    [showNight, nightTick]
  );
  // Tooltip lives in a leaf component (HoverTooltip) so onHover updates at
  // 60–120 Hz don't re-render the whole GlobeView tree. Imperative API only.
  const tooltipRef = useRef<HoverTooltipApi | null>(null);

  // Hand cursor over a pickable object (#247). Written straight onto MapLibre's
  // canvas rather than through React state, for the same reason the tooltip
  // above is imperative: this fires on every mouse move across the globe, and
  // a state flip here would re-render the whole tree. Guarded by a ref so the
  // DOM write only happens when the pointer actually crosses an edge.
  const overCursorRef = useRef(false);
  const handleDeckHover = useCallback((info: PickingInfo): void => {
    const over = Boolean(info?.object);
    if (over === overCursorRef.current) return;
    overCursorRef.current = over;
    const canvas = mapRef.current?.getMap().getCanvas();
    if (canvas) canvas.style.cursor = over ? "pointer" : "";
  }, []);
  // Map zoom — used as a level-of-detail signal for arc altitude. At
  // low zoom the standard altitude-based arcs look great; at high zoom
  // they become horizontal streaks across the screen because the
  // altitude is in absolute meters. Quantised to 0.05 so re-tessellation
  // of greatCircleWaypoints only fires on coarse zoom changes — without
  // the quantisation every scroll tick rebuilds the waypoint arrays.
  // Sourced from MapLibre's `zoom` event only (NOT `move`) so pan +
  // rotate don't trigger unrelated layer re-renders.
  const [mapZoom, setMapZoom] = useState<number>(0.6);
  // Altitude factor: full bow at low zoom, gradually flattens but never
  // below 0.25 so arcs stay visually present even at city zoom. The
  // EarthOcclusionExtension handles back-of-globe clipping per fragment,
  // so we no longer need to flatten arcs to "tame" the streaks — we
  // only need to scale them down enough that the bow doesn't dominate
  // the screen at street level.
  const altitudeFactor =
    Math.round(Math.max(0.25, Math.min(1, 1 - 0.18 * Math.max(0, mapZoom - 1))) * 20) / 20;

  // EarthOcclusionExtension props are static — the extension reads the
  // live camera (lng / lat / zoom) from `viewport` inside its draw()
  // hook every frame, so we don't push camera state through React.
  // That avoids per-frame layer reconstruction and the one-frame lag
  // between basemap rotation and arc rendering.
  const occlusionProps = useMemo<EarthOcclusionExtensionProps>(
    () => ({ earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 }),
    []
  );
  // Single shared extension instance — deck.gl reuses the same shader
  // module across layers, and a stable reference avoids unnecessary
  // pipeline recompiles when the layer list rebuilds.
  const occlusionExt = useMemo(() => new EarthOcclusionExtension(), []);
  // Performance mode: drops arc tessellation to a flat 16 steps,
  // halves column disk resolution, and disables auto-highlight on
  // pickable layers. Tri-state: "auto" lets the dataset thresholds
  // decide; "on" / "off" override forever (within a session).
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
      flights.length >= LITE_AUTO_ARC_THRESHOLD || cruises.length >= LITE_AUTO_CRUISE_THRESHOLD
    );
  }, [liteMode, flights.length, cruises.length]);
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
  const [pinned, setPinned] = useState<GlobePinned | null>(null);

  // The pinned card is rendered as a custom absolutely-positioned
  // overlay above the map container. MapLibre's own Popup primitive
  // was attempted in beta.12 — it crashed the WebGL canvas on click
  // in our specific stack (maplibre-gl 5.19 + deck.gl 9 interleaved
  // + globe projection), per upstream issue #512: the popup's
  // `locationOccludedOpacity` path performs an internal occlusion
  // pass that does not restore `gl.SCISSOR_TEST`, leaving the shared
  // GL state corrupted on next deck.gl draw. The custom overlay
  // here uses `map.project()` on every render frame and a JS-side
  // dot-product visibility check — same math as
  // EarthOcclusionExtension — so we never trigger the popup's
  // internal occlusion pipeline.
  const [popupScreenPos, setPopupScreenPos] = useState<{
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);
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

  // Monthly activity buckets for the time histogram (flights + cruises).
  const monthBuckets = useMemo<MonthBucket[]>(() => {
    const range = computeTimeRange(flights, cruises);
    return range ? computeMonthlyBuckets(flights, cruises, range.min, range.max) : [];
  }, [flights, cruises]);

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

  // Basemap choice persists via the shared appearance blob (save effect
  // below), so it carries across the 2D ↔ 3D switch.
  const onStyleChange = useCallback((next: StyleId) => setStyleId(next), []);

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

  // Track map zoom as React state — only used to drive `altitudeFactor`,
  // which controls the bow height of arc waypoints. Subscribes to the
  // `zoom` event ONLY (not `move`), so pan + rotate don't trigger
  // unrelated re-renders. rAF-throttled to coalesce wheel-tick bursts.
  // The horizon-occlusion uniforms run inside the extension's draw()
  // hook reading `viewport` directly, so React doesn't need to know
  // about the camera direction at all.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let raf = 0;
    const onZoom = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setMapZoom(map.getZoom());
      });
    };
    map.on("zoom", onZoom);
    onZoom();
    return () => {
      map.off("zoom", onZoom);
      cancelAnimationFrame(raf);
    };
  }, [mapReady]);

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
      // A style swap wipes the hillshade source/layer and resets symbol
      // visibility — re-apply both from the latest toggle values.
      applyMapOverlays(map, {
        showTerrain: showTerrainRef.current,
        showPlaceLabels: showPlaceLabelsRef.current,
      });
    };
    map.on("style.load", reapply);
    return () => {
      map.off("style.load", reapply);
    };
  }, [mapReady]);

  // Apply the style-level overlays on initial ready and whenever a
  // toggle flips (basemap swaps are handled by the `style.load` reapply
  // above). Idempotent, so the overlap with initial load is harmless.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    applyMapOverlays(map, { showTerrain, showPlaceLabels });
  }, [mapReady, showTerrain, showPlaceLabels]);

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
      // Route carries at least one scheduled flight / at least one
      // flight that's actually been flown (i.e. status !== 'scheduled').
      // Mirrors routesLayer.ts's RouteRecord — combined, these two flags
      // simplify to a "past" vs. "scheduled" two-tone bucket: a route is
      // "scheduled" only when EVERY flight on it is still scheduled.
      hasUpcoming: boolean;
      hasPastFlown: boolean;
      // Status-aware split of `count`, same predicate as routesLayer.ts's
      // RouteRecord — flown = status 'flown'|'historical', scheduled =
      // status 'scheduled'. Threaded through to ArcDatum for the hover
      // tooltip's two-part label.
      flownCount: number;
      scheduledCount: number;
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
      const isScheduled = flight.properties?.status === "scheduled";
      // Same predicate as routesLayer.ts's aggregateAllRoutes: flown covers
      // both 'flown' and 'historical' (a route already sailed either way).
      const isFlown =
        flight.properties?.status === "flown" || flight.properties?.status === "historical";
      const key = createRouteKey(depKey, arrKey);
      const existing = routes.get(key);
      if (existing) {
        existing.count++;
        existing.flightIds.push(flight.properties.id);
        if (flightWeak) existing.weak = true;
        if (isScheduled) existing.hasUpcoming = true;
        if (!isScheduled) existing.hasPastFlown = true;
        if (isScheduled) existing.scheduledCount += 1;
        if (isFlown) existing.flownCount += 1;
      } else {
        routes.set(key, {
          count: 1,
          from: [start[0], start[1]],
          to: [end[0], end[1]],
          flightIds: [flight.properties.id],
          departure: dep ?? {},
          arrival: arr ?? {},
          weak: flightWeak,
          hasUpcoming: isScheduled,
          hasPastFlown: !isScheduled,
          flownCount: isFlown ? 1 : 0,
          scheduledCount: isScheduled ? 1 : 0,
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
      // Pure-scheduled (never flown) → "scheduled"; everything else
      // (historical-only, mixed, regular past-only) collapses to "past" —
      // mirrors routesLayer.ts's pureScheduled collapsing rule exactly.
      const status: ArcDatum["status"] = r.hasUpcoming && !r.hasPastFlown ? "scheduled" : "past";
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
          status,
          flownCount: r.flownCount,
          scheduledCount: r.scheduledCount,
        });
        continue;
      }
      const peakAltitudeM = getArcPeakAltitudeMeters(distanceKm) * altitudeFactor;
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
        status,
        flownCount: r.flownCount,
        scheduledCount: r.scheduledCount,
      });
    }
    return { arcsData: arcs, antipodalArcs: antipodals, heatmapThresholds: thresholds };
  }, [filteredFlights, minRouteCount, lite, altitudeFactor]);

  const airportPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<string, PointDatum>();
    const bumpLastVisit = (cur: PointDatum, candidate: string | undefined): string | undefined => {
      if (!candidate) return cur.lastVisit;
      if (!cur.lastVisit || candidate > cur.lastVisit) return candidate;
      return cur.lastVisit;
    };
    for (const flight of filteredFlights) {
      const coords = flight.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const dep = flight.properties?.departureAirport;
      const arr = flight.properties?.arrivalAirport;
      const start = coords[0];
      const end = coords[coords.length - 1];
      // A scheduled flight is a future flight — it must never bump
      // "last visit" into the future. `size` stays all-status (its label
      // is neutral); only the visit timestamp is status-gated (mirrors
      // routesLayer.ts's buildAirportPoints).
      const departureTime =
        flight.properties?.status !== "scheduled"
          ? (flight.properties?.departureTime ?? undefined)
          : undefined;
      if (dep?.iata && Number.isFinite(start[0]) && Number.isFinite(start[1])) {
        const key = dep.iata;
        const cur = seen.get(key);
        if (cur) {
          seen.set(key, {
            ...cur,
            size: cur.size + 1,
            lastVisit: bumpLastVisit(cur, departureTime),
          });
        } else {
          seen.set(key, {
            position: [start[0], start[1]],
            size: 1,
            iata: dep.iata,
            name: dep.name ?? dep.iata,
            icao: dep.icao,
            city: dep.city ?? undefined,
            country: dep.country ?? undefined,
            lastVisit: departureTime,
          });
        }
      }
      if (arr?.iata && Number.isFinite(end[0]) && Number.isFinite(end[1])) {
        const key = arr.iata;
        const cur = seen.get(key);
        if (cur) {
          seen.set(key, {
            ...cur,
            size: cur.size + 1,
            lastVisit: bumpLastVisit(cur, departureTime),
          });
        } else {
          seen.set(key, {
            position: [end[0], end[1]],
            size: 1,
            iata: arr.iata,
            name: arr.name ?? arr.iata,
            icao: arr.icao,
            city: arr.city ?? undefined,
            country: arr.country ?? undefined,
            lastVisit: departureTime,
          });
        }
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

  // Mount / re-anchor / dismount the MapLibre Popup that hosts the
  // pinned detail card. `locationOccludedOpacity: 0` uses MapLibre's
  // own globe-visibility math to fade the popup when the anchor is on
  // the back of the earth — same logic as the layer occlusion shader,
  // no JS-side dot-product replay needed.
  // Subscribe to MapLibre `render` events while a card is pinned and
  // re-project the anchor lng/lat → screen pixel each frame. The
  // visibility check is the same dot-product math the EarthOcclusion
  // shader uses on the GPU, just executed once per frame in JS.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (!pinned) {
      setPopupScreenPos(null);
      return;
    }

    const [lng, lat] = pinned.anchorLngLat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      setPopupScreenPos(null);
      return;
    }

    const update = (): void => {
      try {
        const p = map.project([lng, lat]);
        // Visibility: anchor is on the front hemisphere if the dot
        // product between its surface-normal vector and the camera's
        // direction vector is greater than cos(horizonAngle). Same
        // approach as EarthOcclusionExtension, just JS-side.
        const center = map.getCenter();
        const zoom = map.getZoom();
        const DEG = Math.PI / 180;
        const camLng = center.lng * DEG;
        const camLat = center.lat * DEG;
        const aLng = lng * DEG;
        const aLat = lat * DEG;
        const camDir: [number, number, number] = [
          Math.cos(camLat) * Math.cos(camLng),
          Math.cos(camLat) * Math.sin(camLng),
          Math.sin(camLat),
        ];
        const anchorDir: [number, number, number] = [
          Math.cos(aLat) * Math.cos(aLng),
          Math.cos(aLat) * Math.sin(aLng),
          Math.sin(aLat),
        ];
        const dotProd =
          camDir[0] * anchorDir[0] + camDir[1] * anchorDir[1] + camDir[2] * anchorDir[2];
        // cameraDistanceFromZoom heuristic, mirrored from the shader
        const dist = 1 + 1.5 * Math.pow(2, -Math.max(0, zoom) * 0.7);
        const cosHorizon = 1.0 / Math.max(1.001, dist);
        const visible = dotProd > cosHorizon;
        setPopupScreenPos({ x: p.x, y: p.y, visible });
      } catch (err) {
        logger.error({ err, pinned }, "globe.pinned-overlay.project-failed");
        setPopupScreenPos(null);
      }
    };

    update();
    map.on("render", update);
    return () => {
      map.off("render", update);
    };
  }, [pinned]);

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
      // Resolved once per cruise — same helper the flat map's
      // cruiseArcsLayer.ts uses, so both renderers agree pixel-for-pixel on
      // every mode. There is no override path: the user's config is the only
      // input (the old `cruiseRouteColor ?? …` override IS the "solid" mode now).
      const color = resolveCruiseArcColor(cruise, cruiseColorConfig);
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
              out.push({
                path: partial,
                cruiseId: cruise.id,
                cruiseLabel: label,
                status: cruise.status,
                color,
              });
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

        out.push({ path, cruiseId: cruise.id, cruiseLabel: label, status: cruise.status, color });
      }
    }
    return out;
  }, [
    cruises,
    cruiseGeometry,
    cruiseLegDatesByCruise,
    cruiseColorConfig,
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
  ]);

  const portPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<number, PointDatum>();
    for (const c of cruises) {
      // A scheduled/in-progress/cancelled cruise hasn't (fully) sailed —
      // only flown/historical port calls count as an actual visit (mirrors
      // cruisePortsLayer.ts's sailed-only guard).
      if (c.status !== "flown" && c.status !== "historical") continue;
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

        const visitIso = visit ? visit.toISOString() : undefined;
        const cur = seen.get(port.id);
        if (cur) {
          const nextLast =
            visitIso && (!cur.lastVisit || visitIso > cur.lastVisit) ? visitIso : cur.lastVisit;
          seen.set(port.id, { ...cur, size: cur.size + 1, lastVisit: nextLast });
        } else {
          seen.set(port.id, {
            position: [port.lon, port.lat],
            size: 1,
            iata: port.unlocode ?? port.name,
            name: port.name,
            city: port.city ?? undefined,
            // On-map pill shows the readable port name, not the raw
            // UN/LOCODE (the tooltip still surfaces the code via `iata`).
            label: toPortLabel(port.name),
            // Flag from the LOCODE country prefix (only when it's a real code).
            country: port.unlocode ? port.unlocode.slice(0, 2) : undefined,
            lastVisit: visitIso,
          });
        }
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

  // Live-mode head marker: in live slider mode, find the single most
  // recent flight (latest departureDate) and isolate its great-circle
  // path. Rendered as a wider, brand-orange overlay so the user's eye
  // tracks "what just happened" as the slider moves. Empty array
  // outside live mode → layer is not produced.
  const headFlightArc = useMemo<ArcDatum | null>(() => {
    if (sliderMode !== "live" || filteredFlights.length === 0) return null;
    let latest: GeoJSONFeature | null = null;
    let latestT = -Infinity;
    for (const f of filteredFlights) {
      const dateStr = f.properties?.departureTime;
      if (!dateStr) continue;
      const t = new Date(dateStr).getTime();
      if (Number.isNaN(t)) continue;
      if (t > latestT) {
        latestT = t;
        latest = f;
      }
    }
    if (!latest) return null;
    const coords = latest.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const start = coords[0];
    const end = coords[coords.length - 1];
    if (![start[0], start[1], end[0], end[1]].every(Number.isFinite)) return null;
    const distanceKm = calculateDistance(start[1], start[0], end[1], end[0]);
    const peakAltitudeM = getArcPeakAltitudeMeters(distanceKm) * altitudeFactor;
    const isScheduled = latest.properties?.status === "scheduled";
    const isFlown =
      latest.properties?.status === "flown" || latest.properties?.status === "historical";
    return {
      from: [start[0], start[1]],
      to: [end[0], end[1]],
      waypoints: greatCircleWaypoints(
        [start[0], start[1]],
        [end[0], end[1]],
        peakAltitudeM,
        getArcSteps(distanceKm, lite)
      ),
      count: 1,
      flightIds: [latest.properties.id],
      color: [240, 169, 71],
      quartile: getQuartile(1, { q25: 1, q50: 1, q75: 1, max: 1 }),
      departure: latest.properties.departureAirport ?? {},
      arrival: latest.properties.arrivalAirport ?? {},
      weak: false,
      status: isScheduled ? "scheduled" : "past",
      flownCount: isFlown ? 1 : 0,
      scheduledCount: isScheduled ? 1 : 0,
    };
  }, [sliderMode, filteredFlights, lite, altitudeFactor]);

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
        const epLine = (ep: { iata?: string; name?: string; country?: string | null }): string =>
          `<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;padding:1px 0;">
            ${flagImgHtml(ep.country, 18)}<span>${escapeHtml(ep.iata ?? "UNK")}</span>
            <span style="opacity:0.6;font-weight:500;font-size:11px;">${escapeHtml(ep.name ?? "")}</span>
          </div>`;
        // Two-part label, same rule as markerTooltip.ts's renderArcHtml:
        // flown first, then scheduled, zero-count parts omitted. Falls back
        // to the legacy flown-only label for a cancelled-only route where
        // both counts are 0 despite count > 0 (accepted pre-existing
        // cancelled semantic, out of this fix's scope).
        const labelParts: string[] = [];
        if (d.flownCount > 0) labelParts.push(t("map:globe.timesFlown", { count: d.flownCount }));
        if (d.scheduledCount > 0)
          labelParts.push(t("map:globe.timesPlanned", { count: d.scheduledCount }));
        const label = labelParts.join(" · ") || t("map:globe.timesFlown", { count: d.count });
        const html = `
          ${epLine(d.departure)}
          ${epLine(d.arrival)}
          <div style="color:rgb(${d.color[0]},${d.color[1]},${d.color[2]});font-weight:600;margin-top:4px;">
            ${escapeHtml(label)}
          </div>`;
        tooltipRef.current?.show({ html, x: info.x, y: info.y });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t]
  );

  const onAirportHover = useCallback(
    (info: PickingInfo<PointDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        const d = info.object;
        const lastVisitLine = d.lastVisit
          ? `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">
              ${escapeHtml(t("map:tooltip.lastVisit"))}: ${escapeHtml(formatTooltipDate(d.lastVisit, locale))}
            </div>`
          : "";
        const icaoPill = d.icao
          ? `<span style="font-size:10px;font-family:monospace;color:rgba(241,245,249,0.5);background:rgba(255,255,255,0.06);border-radius:4px;padding:1px 5px;">${escapeHtml(d.icao)}</span>`
          : "";
        const place = [d.city, countryName(d.country, locale)].filter(Boolean).join(", ");
        const placeLine = place
          ? `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
          : "";
        const html = `
          <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;">${flagImgHtml(d.country, 19)}<span>${escapeHtml(d.iata)}</span>${icaoPill}</div>
          <div style="opacity:0.88;font-size:11.5px;margin-top:3px;">${escapeHtml(d.name)}</div>
          ${placeLine}
          <div style="color:#fbbf24;margin-top:4px;">
            ${d.size} ${escapeHtml(t("map:globe.flight", { count: d.size }))}
          </div>
          ${lastVisitLine}`;
        tooltipRef.current?.show({ html, x: info.x, y: info.y });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, locale]
  );

  const onPortHover = useCallback(
    (info: PickingInfo<PointDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        const d = info.object;
        const lastCallLine = d.lastVisit
          ? `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">
              ${escapeHtml(t("map:tooltip.lastCall"))}: ${escapeHtml(formatTooltipDate(d.lastVisit, locale))}
            </div>`
          : "";
        const place = [d.city, countryName(d.country, locale)].filter(Boolean).join(", ");
        const placeLine = place
          ? `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
          : "";
        const codeLine =
          d.iata !== d.name
            ? `<div style="opacity:0.55;font-size:10px;font-family:monospace;margin-top:2px;">${escapeHtml(d.iata)}</div>`
            : "";
        const html = `
          <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;">${d.country ? flagImgHtml(d.country, 19) : "⚓"}<span>${escapeHtml(d.name)}</span></div>
          ${placeLine}
          ${codeLine}
          ${lastCallLine}`;
        tooltipRef.current?.show({ html, x: info.x, y: info.y });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, locale]
  );

  const onCruisePathHover = useCallback((info: PickingInfo<CruisePathDatum>): void => {
    if (info.object && info.x != null && info.y != null) {
      const html = `<div style="font-weight:600;">🚢 ${escapeHtml(info.object.cruiseLabel)}</div>`;
      tooltipRef.current?.show({ html, x: info.x, y: info.y });
    } else {
      tooltipRef.current?.hide();
    }
  }, []);

  const layers = useMemo<Layer[]>(
    () =>
      buildGlobeLayers({
        arcsData,
        antipodalArcs,
        cruisePaths,
        airportPoints,
        portPoints,
        headFlightArc,
        activeQuartile,
        lite,
        occlusionExt,
        occlusionProps,
        onArcHover,
        onAirportHover,
        onPortHover,
        onCruisePathHover,
        flyToArc,
        setPinned,
        flightColorConfig,
        arcWidthScale: flightRouteWidth,
        cruiseArcWidthScale: cruiseRouteWidth,
        airportColor: airportColor ?? DEFAULT_AIRPORT_COLOR,
        portColor: portColor ?? DEFAULT_PORT_COLOR,
        airportRadius: GLOBE_MARKER_BASE_PX * flightMarkerSize,
        portRadius: GLOBE_MARKER_BASE_PX * cruiseMarkerSize,
        nightCells: nightCellsData,
        showNight,
      }),
    [
      arcsData,
      antipodalArcs,
      cruisePaths,
      airportPoints,
      portPoints,
      activeQuartile,
      lite,
      headFlightArc,
      flyToArc,
      onArcHover,
      onAirportHover,
      onCruisePathHover,
      onPortHover,
      occlusionExt,
      occlusionProps,
      flightColorConfig,
      flightRouteWidth,
      cruiseRouteWidth,
      airportColor,
      portColor,
      flightMarkerSize,
      cruiseMarkerSize,
      nightCellsData,
      showNight,
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
        {mapReady && <DeckGLOverlay layers={layers} onHover={handleDeckHover} />}
      </MapGL>

      {/* Top-right stats overlay — driven by the same slider-filtered
          data as the globe layers, so numbers tick in real time as the
          user scrubs. Lives top-right because the top-left is owned by
          the dashboard's Aktivität sidebar (would otherwise overlap).
          Offset down (top-16, not top-4) to clear DashboardLayout's
          "+ hinzufügen" button, which lives in the same corner and is
          always present regardless of map mode. */}
      {(liveStats.flights > 0 || liveStats.cruises > 0) && (
        <div className="absolute top-16 right-4 z-10" style={{ pointerEvents: "auto" }}>
          <div
            className="rounded-xl p-3 text-xs"
            style={{
              background: "rgba(13, 17, 23, 0.85)",
              backdropFilter: "blur(14px)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(241,245,249,0.95)",
              fontFamily: "'Inter', sans-serif",
              minWidth: 168,
              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            }}
          >
            <div
              className="mb-1.5 text-[10px] font-semibold uppercase"
              style={{ letterSpacing: "0.08em", color: "rgba(241,245,249,0.45)" }}
            >
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
                <div
                  className="mt-1.5 border-t pt-1 text-[10px] opacity-80"
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

      {/* Consolidated map controls — layers, basemap, frequency filter,
          performance + recenter in one collapsible panel (own design). */}
      <div className="absolute bottom-4 left-4 z-10" style={{ pointerEvents: "auto" }}>
        <GlobeControlPanel
          autoRotate={autoRotate}
          onAutoRotateChange={setAutoRotate}
          showNight={showNight}
          onShowNightChange={setShowNight}
          labelsMode={labelsMode}
          onLabelsModeChange={setLabelsMode}
          showTerrain={showTerrain}
          onShowTerrainChange={setShowTerrain}
          showPlaceLabels={showPlaceLabels}
          onShowPlaceLabelsChange={setShowPlaceLabels}
          styleOptions={STYLE_OPTIONS}
          styleId={styleId}
          onStyleChange={onStyleChange}
          liteMode={liteMode}
          lite={lite}
          onLiteModeChange={onLiteModeChange}
          onRecenter={onRecenter}
          legendRanges={legendRanges}
          activeQuartile={activeQuartile}
          onQuartileChange={setActiveQuartile}
          hasArcs={arcsData.length > 0}
          antipodalCount={antipodalArcs.length}
          hasWeakArcs={arcsData.some((a) => a.weak)}
          appearanceDomains={appearanceDomains}
          flightAppearance={{
            colorConfig: flightColorConfig,
            onColorModeChange: setFlightColorMode,
            onColorChange: setFlightColor,
            routeWidth: flightRouteWidth,
            onRouteWidthChange: setFlightRouteWidth,
            markerColor: airportColor,
            onMarkerColorChange: setAirportColor,
            markerSize: flightMarkerSize,
            onMarkerSizeChange: setFlightMarkerSize,
          }}
          cruiseAppearance={{
            colorConfig: cruiseColorConfig,
            onColorModeChange: setCruiseColorMode,
            onColorChange: setCruiseColor,
            routeWidth: cruiseRouteWidth,
            onRouteWidthChange: setCruiseRouteWidth,
            markerColor: portColor,
            onMarkerColorChange: setPortColor,
            markerSize: cruiseMarkerSize,
            onMarkerSizeChange: setCruiseMarkerSize,
          }}
        />
      </div>

      {/* Top-center: activity histogram — filter (brush) + playback (▶) in
          one strip, replacing the old three-mode slider. Sits at the top
          centre: the dashboard's colour legend now lives in a bottom-right
          table (AllTab), so the top band is clear. */}
      <div
        className="absolute top-3 left-1/2 z-10 -translate-x-1/2"
        style={{ pointerEvents: "auto" }}
      >
        <GlobeTimeHistogram
          buckets={monthBuckets}
          visibleFlights={filteredFlights.length}
          visibleCruises={new Set(cruisePaths.map((p) => p.cruiseId)).size}
        />
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
            <div className="mb-2 text-base font-semibold">{t("map:globe.coachmark.title")}</div>
            <ul className="mb-4 space-y-1.5 text-[12px] opacity-90">
              <li>🖱️ {t("map:globe.coachmark.pan")}</li>
              <li>🔍 {t("map:globe.coachmark.zoom")}</li>
              <li>📍 {t("map:globe.coachmark.click")}</li>
              <li>🌍 {t("map:globe.coachmark.autoRotate")}</li>
            </ul>
            <button
              type="button"
              onClick={dismissCoachmark}
              className="w-full cursor-pointer rounded-sm px-3 py-2 text-[12px] font-medium transition-colors"
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

      {/* IATA / port labels — HTML overlay (deck.gl billboard text does
          not render under the globe projection; see GlobeLabelsOverlay). */}
      <GlobeLabelsOverlay
        mapRef={mapRef}
        mapReady={mapReady}
        airports={airportPoints}
        ports={portPoints}
        mode={labelsMode}
      />

      {/* Pinned detail card — custom React overlay positioned via
          map.project() on every render frame. Replaces the MapLibre
          Popup primitive that was crashing the WebGL canvas in this
          stack (interleaved deck.gl 9 + globe projection). Visibility
          flag from the JS-side dot-product check fades the card when
          the anchor rotates to the back of the globe. */}
      {/* Pulse ring on the selected marker (airports + ports). Drawn under
          the pinned card, non-interactive; reduced-motion shows a static
          ring. Colour follows the domain. */}
      {pinned &&
        (pinned.kind === "airport" || pinned.kind === "port") &&
        popupScreenPos &&
        popupScreenPos.visible && (
          <div
            className="pointer-events-none absolute z-20"
            style={{ left: popupScreenPos.x, top: popupScreenPos.y }}
          >
            {[0, 0.6].map((delay) => (
              <span
                key={delay}
                className="map-pulse-ring"
                style={
                  {
                    "--pulse-color": pinned.kind === "port" ? "#6fa0d6" : "#f0a947",
                    animationDelay: `${delay}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

      {pinned && popupScreenPos && popupScreenPos.visible && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={{
            left: popupScreenPos.x,
            top: popupScreenPos.y,
            transform: "translate(-50%, calc(-100% - 14px))",
          }}
        >
          <PinnedCardBoundary>
            <PinnedCard
              pinned={pinned}
              flights={flights}
              cruises={cruises ?? []}
              onClose={() => setPinned(null)}
              onFlightOpen={onFlightOpen}
              onCruiseOpen={onCruiseOpen}
            />
          </PinnedCardBoundary>
        </div>
      )}

      {/* Hover tooltip — leaf component with imperative show/hide so onHover
          updates at 60–120 Hz don't re-render the parent GlobeView tree. */}
      <HoverTooltip ref={tooltipRef} />
    </div>
  );
}
