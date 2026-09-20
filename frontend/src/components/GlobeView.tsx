import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "./Globe/EarthOcclusionExtension";
import {
  LITE_AUTO_ARC_THRESHOLD,
  LITE_AUTO_CRUISE_THRESHOLD,
  calculateDistance,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "./Globe/arcUtils";
import { HEAT_HEX, getQuartile, type Quartile } from "./Globe/heatmapUtils";
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
import { LODGING_COLOR } from "../lib/lodgingColor";
import { PLACE_COLOR } from "../lib/placeColor";
import { rgbCss } from "../lib/flightColor";
import { useLodgingColorStore } from "../store/lodgingColorStore";
import { usePlaceColorStore } from "../store/placeColorStore";
import { useMapCameraStore } from "../store/mapCameraStore";

// Base marker radius (px) a size preset scales. off → 0 (hidden).
const GLOBE_MARKER_BASE_PX = 5;
import { nightCells as computeNightCells } from "./Globe/sunPosition";
import { HoverTooltip, type HoverTooltipApi } from "./map/cards/HoverTooltip";
import { PinnedCard } from "./map/cards/PinnedCard";
import { PinnedCardBoundary } from "./map/cards/PinnedCardBoundary";
import {
  airportHoverHtml,
  arcHoverHtml,
  cruiseHoverHtml,
  portHoverHtml,
} from "./map/cards/hoverCardHtml";
import { GlobeLabelsOverlay } from "./Globe/GlobeLabelsOverlay";
import { usePinnedAnchor } from "./Globe/usePinnedAnchor";
import { applyMapOverlays } from "./Globe/mapOverlays";
import { buildAirportPoints, buildPortPoints } from "./Globe/globePointData";
import { buildGlobeArcData } from "./Globe/globeArcData";
import { lodgingLabelPoints, placeLabelPoints } from "./Globe/globePinLabels";
import { createMarkerTooltip } from "./map/markerTooltip";
import { GlobeControlPanel, type StyleId, type LiteMode } from "./Globe/GlobeControlPanel";
import type { ArcDatum, CruisePathDatum, PointDatum } from "./Globe/globeLayerTypes";
import type { MapPinned } from "./map/cards/pinnedTypes";
import { STYLE_OPTIONS } from "./Globe/globeStyles";
import type { GeoJSONFeature } from "../types";
import { isCountableFlight } from "../shared/flightCounting";
import type { Cruise } from "../types/cruise";
import type { Lodging } from "../types/lodging";
import type { Place } from "../types/place";
import type { Rgb } from "../lib/cruiseColor";
import type { PlaceLabelList, PlaceLabelSource } from "../lib/placeLabel";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { resolveCruiseArcColor } from "../lib/cruiseColor";
import { useCruiseColorStore } from "../store/cruiseColorStore";
import { GLOBE_FOCUS, focusMarker, useMapSelectionCards } from "./map/cards/useMapSelectionCards";
import { resolveFlightTipColor } from "../lib/flightColor";
import { logger } from "../lib/logger";
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
  /**
   * Extra deck.gl layers appended after every internally-built layer --
   * the globe-mode counterpart of DeckGLMap's extraLayers prop
   * (MapContainer3D.tsx). Before this existed, MapContainer3D only
   * threaded extraLayers into DeckGLMap, so anything a caller drew this
   * way (dashboard-wide tour paths, journey-mode layers) silently
   * vanished the moment the user switched to globe mode -- the globe
   * rendered with nothing on it while a legend built from the same data
   * kept claiming otherwise. Merged into the deck.gl overlay's own
   * layer list below, never a second overlay.
   */
  extraLayers?: Layer[];
  /**
   * Lodgings to pin, already filtered by the caller — the globe half of
   * MapContainer3D's `lodgingsOverride`.
   *
   * Measured on main (2026-09-20): MapContainer3D dropped this prop, and five
   * others beside it, the moment the mode was globe. The comment there said
   * "pins are flat-map only for now"; what it meant in use was that
   * `/dashboard/lodging?mode=globe` drew an empty sphere while its own sidebar
   * listed 31 hotels, and the Alle tab's legend named Unterkünfte the globe
   * never drew.
   */
  lodgings?: readonly Lodging[];
  /**
   * Fired by the pinned card's "open" CTA — the globe's counterpart of the
   * flat map's pin click. It is deliberately NOT called on the click itself:
   * the Alle tab's handler navigates to the place page, and a click that
   * yanked the user off the globe would make the card it just opened
   * unreachable. Same trade the flight arc and the cruise path already make
   * with `onFlightOpen` / `onCruiseOpen`.
   */
  onLodgingOpen?: (lodgingId: string) => void;
  /** Places to pin, on the same terms as `lodgings`. */
  places?: readonly Place[];
  /** Fired by the pinned card's "open" CTA for a place. */
  onPlaceOpen?: (placeId: string) => void;
  /** Place id → its list's colour, for the `list` colour mode. */
  placeListColors?: ReadonlyMap<string, Rgb>;
  /** Place id → its list's label default, for the symbol labels. */
  placeListLabels?: ReadonlyMap<string, PlaceLabelList>;
  /** Lodging marker-size multiplier, owned and persisted by MapContainer3D. */
  lodgingMarkerSize?: number;
  onLodgingMarkerSizeChange?: (size: number) => void;
  /** Place marker-size multiplier, owned and persisted by MapContainer3D. */
  placeMarkerSize?: number;
  onPlaceMarkerSizeChange?: (size: number) => void;
}

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
  onHover: (info: PickingInfo) => void;
}

/**
 * The ring that pulses on the marker a pinned card belongs to. Only the four
 * SINGLE-POINT kinds get one — an arc or a cruise path is pinned somewhere
 * along a line, where a ring would mark a spot the user did not click.
 * Lodging and place read their domain colour rather than a literal, so the
 * ring cannot disagree with the pin it surrounds.
 */
function pulseColor(kind: MapPinned["kind"]): string | null {
  if (kind === "airport") return "#f0a947";
  if (kind === "port") return "#6fa0d6";
  if (kind === "lodging") return rgbCss(LODGING_COLOR);
  if (kind === "place") return rgbCss(PLACE_COLOR);
  return null;
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
  extraLayers = [],
  lodgings = [],
  onLodgingOpen,
  places = [],
  onPlaceOpen,
  placeListColors,
  placeListLabels,
  lodgingMarkerSize = 1,
  onLodgingMarkerSizeChange,
  placeMarkerSize = 1,
  onPlaceMarkerSizeChange,
}: GlobeViewProps): JSX.Element {
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";
  const mapRef = useRef<MapRef>(null);
  // Read ONCE, at mount — the same trap as the flat map (#290): every tab
  // switch mounts a fresh globe, and a constant `initialViewState` put it back
  // at the overview pose each time. The globe keeps its own entry because its
  // zoom scale differs from the flat map's for the same framing.
  const [initialViewState] = useState<MapViewState>(
    () => useMapCameraStore.getState().camera.globe ?? INITIAL_VIEW_STATE
  );
  const rememberCamera = useMapCameraStore((s) => s.remember);

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
  // Lodging + place appearance. Colour is store state for the same reason the
  // flight and cruise colours are: the flat map, both panels, the legend and
  // this renderer all read one config, so a pin and its swatch cannot drift.
  const lodgingColorConfig = useLodgingColorStore((s) => s.config);
  const setLodgingColorMode = useLodgingColorStore((s) => s.setMode);
  const setLodgingColor = useLodgingColorStore((s) => s.setColor);
  const placeColorConfig = usePlaceColorStore((s) => s.config);
  const setPlaceColorMode = usePlaceColorStore((s) => s.setMode);
  const setPlaceColor = usePlaceColorStore((s) => s.setColor);
  // Whether a place pill says its name or its list's symbol. The flat map owns
  // the same setting (DeckGLMap), persisted in the shared mapAppearance blob,
  // so flipping it on one map is already flipped on the other.
  const [placeLabelSource, setPlaceLabelSource] = useState<PlaceLabelSource>(
    () => loadMapAppearance().placeLabelSource ?? "list"
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
      placeLabelSource,
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
    placeLabelSource,
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
  // Typed as the SHARED `MapPinned`, not the globe's own `GlobePinned`: the
  // globe's layer datums are assignable to it (that is what `pinnedTypes.ts`
  // is a subset for), and the activity sidebar's selections — a hotel, a place
  // — have no globe layer datum at all.
  const [pinned, setPinned] = useState<MapPinned | null>(null);

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
  // Screen position + front-hemisphere visibility for the pinned card. The
  // occlusion maths lives in `Globe/usePinnedAnchor.ts` — globe-specific on
  // purpose, since "the earth is in the way" is not a question the flat map has.
  const getMapForAnchor = useCallback(() => mapRef.current?.getMap(), []);
  const popupScreenPos = usePinnedAnchor(pinned, getMapForAnchor);
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
  const { arcsData, antipodalArcs, heatmapThresholds } = useMemo(
    () => buildGlobeArcData(filteredFlights, minRouteCount, lite, altitudeFactor),
    [filteredFlights, minRouteCount, lite, altitudeFactor]
  );

  const airportPoints = useMemo<PointDatum[]>(
    () => buildAirportPoints(filteredFlights),
    [filteredFlights]
  );
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

  const portPoints = useMemo<PointDatum[]>(
    () =>
      buildPortPoints(cruises, cruiseLegDatesByCruise, {
        mode: sliderMode,
        current: sliderCurrent,
        filterStart: sliderFilterStart,
        filterEnd: sliderFilterEnd,
      }),
    [cruises, cruiseLegDatesByCruise, sliderMode, sliderCurrent, sliderFilterStart, sliderFilterEnd]
  );

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
    const isFlown = isCountableFlight(latest.properties);
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

  // Selections from OUTSIDE the globe — the activity sidebar, the flight
  // panel — become a card and a camera move, on exactly the terms the flat map
  // uses (`map/cards/useMapSelectionCards.ts`). The globe read NONE of the
  // four selection stores before (owner, 2026-09-20). `clearOnEmpty` stays
  // false here: a click on an arc pins a card without touching the store, and
  // clearing on an empty store would wipe the card the click just opened.
  const focusOnGlobe = useCallback((lngLat: [number, number]): void => {
    focusMarker(mapRef.current?.getMap(), lngLat, GLOBE_FOCUS);
  }, []);
  // Memoised: `resolveFlightTipColor` returns a fresh array, which as a raw
  // effect dependency is "changed" on every render — an effect that sets state
  // every render, which is a render loop.
  const flightCardColor = useMemo(
    () => resolveFlightTipColor(flightColorConfig),
    [flightColorConfig]
  );

  const { cardFlights } = useMapSelectionCards({
    flights,
    flightColor: flightCardColor,
    focus: focusOnGlobe,
    setPinned,
  });

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

  // Hover content lives in `map/cards/hoverCardHtml.ts` — the flat map draws
  // the same four tooltips, and it had its own near-twin of each until the
  // owner's 2026-09-20 ruling made the globe the reference for map chrome.
  const onArcHover = useCallback(
    (info: PickingInfo<ArcDatum>): void => {
      if (info.object && info.x != null && info.y != null) {
        tooltipRef.current?.show({
          html: arcHoverHtml(info.object, { t }),
          x: info.x,
          y: info.y,
        });
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
        tooltipRef.current?.show({
          html: airportHoverHtml(
            {
              iata: d.iata,
              icao: d.icao,
              name: d.name,
              city: d.city,
              country: d.country,
              count: d.size,
              lastVisit: d.lastVisit,
            },
            { t, locale }
          ),
          x: info.x,
          y: info.y,
        });
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
        // No visit count on the globe's port tooltip: the pinned card answers
        // that, and the marker datum's `size` is a radius here, not a tally.
        tooltipRef.current?.show({
          html: portHoverHtml(
            {
              name: d.name,
              code: d.iata,
              city: d.city,
              country: d.country,
              lastVisit: d.lastVisit,
            },
            { t, locale }
          ),
          x: info.x,
          y: info.y,
        });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [t, locale]
  );

  const onCruisePathHover = useCallback((info: PickingInfo<CruisePathDatum>): void => {
    if (info.object && info.x != null && info.y != null) {
      tooltipRef.current?.show({
        html: cruiseHoverHtml(info.object.cruiseLabel),
        x: info.x,
        y: info.y,
      });
    } else {
      tooltipRef.current?.hide();
    }
  }, []);

  // Hover on a lodging or place pin goes through the flat map's own tooltip
  // renderer, which already keys on the layer id (markerTooltip.ts) — a second
  // renderer for the same datum is a second thing that can disagree.
  const markerTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const onPinHover = useCallback(
    (info: PickingInfo): void => {
      const rendered = info.object ? markerTooltip(info) : null;
      if (rendered && info.x != null && info.y != null) {
        tooltipRef.current?.show({ html: rendered.html, x: info.x, y: info.y });
      } else {
        tooltipRef.current?.hide();
      }
    },
    [markerTooltip]
  );

  // Pin labels for the HTML overlay. deck.gl billboard text does not render
  // under the globe projection at all (see GlobeLabelsOverlay), so this is the
  // only route a hotel or place name has onto the sphere.
  const pinLabels = useMemo(
    () => [
      ...lodgingLabelPoints(lodgings, lodgingColorConfig),
      ...placeLabelPoints(
        places,
        placeColorConfig,
        placeListColors,
        placeListLabels,
        placeLabelSource
      ),
    ],
    [
      lodgings,
      lodgingColorConfig,
      places,
      placeColorConfig,
      placeListColors,
      placeListLabels,
      placeLabelSource,
    ]
  );

  const layers = useMemo<Layer[]>(
    () => [
      ...buildGlobeLayers({
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
        lodgings,
        lodgingColors: lodgingColorConfig,
        lodgingRadius: GLOBE_MARKER_BASE_PX * lodgingMarkerSize,
        places,
        placeColors: placeColorConfig,
        placeListColors,
        placeRadius: GLOBE_MARKER_BASE_PX * placeMarkerSize,
        onPinHover,
        nightCells: nightCellsData,
        showNight,
      }),
      // Appended, never merged into buildGlobeLayers itself -- these are the
      // caller's own layers (e.g. dashboard-wide tour paths), not part of
      // what this component knows how to build.
      ...extraLayers,
    ],
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
      extraLayers,
      flightColorConfig,
      flightRouteWidth,
      cruiseRouteWidth,
      airportColor,
      portColor,
      flightMarkerSize,
      cruiseMarkerSize,
      lodgings,
      lodgingColorConfig,
      lodgingMarkerSize,
      places,
      placeColorConfig,
      placeListColors,
      placeMarkerSize,
      onPinHover,
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
        initialViewState={initialViewState}
        mapStyle={currentStyle.url}
        attributionControl={false}
        onLoad={onMapLoad}
        // Auto-rotation drives `jumpTo` per frame, so this fires ~60 times a
        // second while it spins — the write is a five-field copy that no
        // component re-renders on (the only selector here picks the stable
        // `remember` function), cheap enough that writing on unmount instead
        // is not worth the extra lifecycle.
        onMoveEnd={(e) => rememberCamera("globe", e.viewState)}
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
          lodgingAppearance={{
            markerSize: lodgingMarkerSize,
            // The size lives in MapContainer3D, which persists it — a tab that
            // renders the globe without threading the setter gets a slider it
            // cannot move, so it gets no setter and the section still reads.
            onMarkerSizeChange: onLodgingMarkerSizeChange ?? (() => {}),
            colorConfig: lodgingColorConfig,
            onColorModeChange: setLodgingColorMode,
            onColorChange: setLodgingColor,
          }}
          placeAppearance={{
            colorConfig: placeColorConfig,
            onColorModeChange: setPlaceColorMode,
            onColorChange: setPlaceColor,
            markerSize: placeMarkerSize,
            onMarkerSizeChange: onPlaceMarkerSizeChange ?? (() => {}),
            labelSource: placeLabelSource,
            onLabelSourceChange: setPlaceLabelSource,
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
        extras={pinLabels}
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
      {pinned && pulseColor(pinned.kind) && popupScreenPos && popupScreenPos.visible && (
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
                  "--pulse-color": pulseColor(pinned.kind),
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
              flights={cardFlights}
              cruises={cruises ?? []}
              onClose={() => setPinned(null)}
              onFlightOpen={onFlightOpen}
              onCruiseOpen={onCruiseOpen}
              onLodgingOpen={onLodgingOpen}
              onPlaceOpen={onPlaceOpen}
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
