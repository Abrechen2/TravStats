import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { type MapRef } from "react-map-gl/maplibre";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "./Globe/EarthOcclusionExtension";
import { createCursorMux, useNativeGlobe } from "./Globe/native/useNativeGlobe";
import { DeckGLOverlay } from "./Globe/DeckGLOverlay";
import { arcBaseOffsetM } from "./Globe/arcUtils";
import { heatLegendRanges, type Quartile } from "./Globe/heatmapUtils";
import {
  buildGlobeLayers,
  DEFAULT_AIRPORT_COLOR,
  DEFAULT_PORT_COLOR,
} from "./Globe/buildGlobeLayers";
import { type AppearanceDomain } from "./map/controlPanelKit";
import { useResilientStyle } from "./map/basemapFallback";
import { loadGlobeChrome, saveGlobeChrome } from "./map/globeChrome";
import { effectiveRoutes, useMapRoutesStore } from "../store/mapRoutesStore";
import { withoutHiddenRoutes } from "../lib/mapRoutes";
import { useMapCameraStore } from "../store/mapCameraStore";
import { useMapLabelsModeStore } from "../store/mapLabelsModeStore";

// Base marker radius (px) a size preset scales. off → 0 (hidden).
const GLOBE_MARKER_BASE_PX = 5;
import { nightCells as computeNightCells } from "./Globe/sunPosition";
import { HoverTooltip, type HoverTooltipApi } from "./map/cards/HoverTooltip";
import { GlobeLabelsOverlay } from "./Globe/GlobeLabelsOverlay";
import { usePinnedAnchor } from "./Globe/usePinnedAnchor";
import { occludeExtraLayers } from "./Globe/occludeExtraLayers";
import { GlobeStatsCard } from "./Globe/GlobeStatsCard";
import { GlobePinnedOverlay } from "./Globe/GlobePinnedOverlay";
import { useGlobeLiteMode } from "./Globe/useGlobeLiteMode";
import { useGlobeTimeSlider } from "./Globe/useGlobeTimeSlider";
import { useGlobeHover } from "./Globe/useGlobeHover";
import { useGlobeAppearance } from "./Globe/useGlobeAppearance";
import { useGlobeMapLifecycle } from "./Globe/useGlobeMapLifecycle";
import { buildCruisePaths } from "./Globe/cruisePathData";
import { buildHeadFlightArc, computeGlobeLiveStats } from "./Globe/liveGlobeData";
import { buildAirportPoints, buildPortPoints } from "./Globe/globePointData";
import { buildGlobeArcData } from "./Globe/globeArcData";
import { lodgingLabelPoints, placeLabelPoints, stationLabelPoints } from "./Globe/globePinLabels";
import { GlobeControlPanel, type StyleId } from "./Globe/GlobeControlPanel";
import type { ArcDatum, CruisePathDatum, PointDatum } from "./Globe/globeLayerTypes";
import type { MapPinned } from "./map/cards/pinnedTypes";
import { STYLE_OPTIONS } from "./Globe/globeStyles";
import type { Flight, GeoJSONFeature } from "../types";
import type { Cruise } from "../types/cruise";
import type { Lodging } from "../types/lodging";
import type { Place } from "../types/place";
import type { Rgb } from "../lib/cruiseColor";
import type { PlaceLabelList } from "../lib/placeLabel";
import { useCruiseGeometry } from "../hooks/useCruiseGeometry";
import { GLOBE_FOCUS, focusMarker, useMapSelectionCards } from "./map/cards/useMapSelectionCards";
import { resolveFlightTipColor } from "../lib/flightColor";
import { useTranslation } from "../hooks/useTranslation";
import { GlobeTimeHistogram } from "./Globe/GlobeTimeHistogram";
import { GlobeCoachmark } from "./Globe/GlobeCoachmark";

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
  /**
   * Cruises the CARD may look up, which is not the same list as the one the
   * globe DRAWS.
   *
   * `showInternalCruises={false}` means "I draw my own cruise lines" — the
   * Reise view draws exactly one trip's. It does not mean "the reader may not
   * read a cruise". Passing the empty draw-list to both left the card heading
   * itself "🚢 AIDAnova" above the not-found body, because `getCruiseStats`
   * had nothing to find. Defaults to `cruises`, so a caller that draws what it
   * reads says it once.
   */
  cruisesForCard?: readonly Cruise[];
  /** Fired by the pinned-card "Open last flight" CTA — should open the
      flight (modal or detail page). */
  onFlightOpen?: (flightId: string) => void;
  /** Fired by the pinned-card "Open cruise" CTA — should navigate to
      the cruise detail page. */
  onCruiseOpen?: (cruiseId: string) => void;
  /**
   * Fired by the card's "Bearbeiten" action. Threaded here so the globe's
   * card carries the SAME action row as the flat map's — the ruling asked for
   * one card, and a card with one fewer action on one surface is two.
   */
  onEdit?: (flight: Flight) => void;
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
// Stable empty defaults: a fresh `[]` per render would rebuild every native source.
const NO_LAYERS: Layer[] = [];
const NO_LODGINGS: readonly Lodging[] = [];
const NO_PLACES: readonly Place[] = [];

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 25,
  zoom: 1.6,
  pitch: 0,
  bearing: 0,
};

export default function GlobeView({
  flights = [],
  cruises = [],
  cruisesForCard,
  onFlightOpen,
  onCruiseOpen,
  onEdit,
  minRouteCount = 1,
  appearanceDomains = ["flight", "cruise"],
  extraLayers = NO_LAYERS,
  lodgings = NO_LODGINGS,
  onLodgingOpen,
  places = NO_PLACES,
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

  const {
    styleId,
    setStyleId,
    flightColorConfig,
    setFlightColorMode,
    setFlightColor,
    flightRouteWidth,
    setFlightRouteWidth,
    airportColor,
    setAirportColor,
    flightMarkerSize,
    setFlightMarkerSize,
    cruiseColorConfig,
    setCruiseColorMode,
    setCruiseColor,
    cruiseRouteWidth,
    setCruiseRouteWidth,
    portColor,
    setPortColor,
    cruiseMarkerSize,
    setCruiseMarkerSize,
    lodgingColorConfig,
    setLodgingColorMode,
    setLodgingColor,
    placeColorConfig,
    setPlaceColorMode,
    setPlaceColor,
    placeLabelSource,
    setPlaceLabelSource,
    showTerrain,
    setShowTerrain,
    showPlaceLabels,
    setShowPlaceLabels,
  } = useGlobeAppearance();
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
  const { mode: labelsMode, setMode: setLabelsMode } = useMapLabelsModeStore();
  // Map-appearance customisation (the panel's "Anpassung" section) plus
  // the style-level overlays, all persisted to localStorage so a user's
  // look survives reloads.
  //

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
  const hideTooltip = useCallback((): void => tooltipRef.current?.hide(), []);

  // Hand cursor over a pickable object (#247). Written straight onto MapLibre's
  // canvas rather than through React state, for the same reason the tooltip
  // above is imperative: this fires on every mouse move across the globe, and
  // a state flip here would re-render the whole tree. Guarded by a ref so the
  // DOM write only happens when the pointer actually crosses an edge.
  const cursorMux = useMemo(() => createCursorMux(() => mapRef.current?.getMap().getCanvas()), []);
  const getDeckCursor = useCallback(
    ({ isDragging, isHovering }: { isDragging: boolean; isHovering: boolean }): string =>
      isDragging ? "grabbing" : isHovering || cursorMux.isOver() ? "pointer" : "grab",
    [cursorMux]
  );
  const handleDeckHover = useCallback(
    (info: PickingInfo): void => cursorMux.set("deck", Boolean(info?.object)),
    [cursorMux]
  );
  // Map zoom — used as a level-of-detail signal for arc altitude. At
  // low zoom the standard altitude-based arcs look great; at high zoom
  // they become horizontal streaks across the screen because the
  // altitude is in absolute meters. Quantised to 0.05 so re-tessellation
  // of greatCircleWaypoints only fires on coarse zoom changes — without
  // the quantisation every scroll tick rebuilds the waypoint arrays.
  // Sourced from MapLibre's `zoom` event only (NOT `move`) so pan +
  // rotate don't trigger unrelated layer re-renders.
  const currentStyle = useMemo(
    () => STYLE_OPTIONS.find((s) => s.id === styleId) ?? STYLE_OPTIONS[0],
    [styleId]
  );
  const resilientStyle = useResilientStyle(currentStyle.id);
  // Basemap choice persists via the shared appearance blob across 2D ↔ 3D.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setStyleId is a state setter, stable
  const onStyleChange = useCallback((next: StyleId) => setStyleId(next), []);
  const { mapReady, mapZoom, onMapLoad } = useGlobeMapLifecycle({
    mapRef,
    sky: currentStyle.sky,
    showTerrain,
    showPlaceLabels,
    autoRotate,
  });
  // Altitude factor: full bow at low zoom, gradually flattens but never
  // below 0.25 so arcs stay visually present even at city zoom. The
  // EarthOcclusionExtension handles back-of-globe clipping per fragment,
  // so we no longer need to flatten arcs to "tame" the streaks — we
  // only need to scale them down enough that the bow doesn't dominate
  // the screen at street level.
  const altitudeFactor =
    Math.round(Math.max(0.25, Math.min(1, 1 - 0.18 * Math.max(0, mapZoom - 1))) * 20) / 20;
  // Per whole zoom level, not per scroll tick (`mapZoom` moves on every tick).
  const arcBaseOffset = arcBaseOffsetM(mapZoom);

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
  const { liteMode, onLiteModeChange, lite } = useGlobeLiteMode(flights.length, cruises.length);
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

  // Time-slider state. Sliced per-field so unrelated store changes
  const {
    sliderMode,
    sliderCurrent,
    sliderFilterStart,
    sliderFilterEnd,
    monthBuckets,
    cruiseLegDatesByCruise,
    filteredFlights,
  } = useGlobeTimeSlider(flights, cruises);

  // Aggregate flights into city-pair routes with count + heatmap colour.
  const { arcsData, antipodalArcs, heatmapThresholds } = useMemo(
    () => buildGlobeArcData(filteredFlights, minRouteCount, lite, altitudeFactor, arcBaseOffset),
    [filteredFlights, minRouteCount, lite, altitudeFactor, arcBaseOffset]
  );

  const airportPoints = useMemo<PointDatum[]>(
    () => buildAirportPoints(filteredFlights),
    [filteredFlights]
  );
  // FeatureCollection per cruise. Same source as the 2D map: the shared hook
  // chunks the batch, lifts the timeout and toasts a failure.
  const cruiseGeometry = useCruiseGeometry(cruises);

  const cruisePaths = useMemo<CruisePathDatum[]>(
    () =>
      buildCruisePaths(cruises, cruiseGeometry, cruiseLegDatesByCruise, cruiseColorConfig, {
        mode: sliderMode,
        current: sliderCurrent,
        filterStart: sliderFilterStart,
        filterEnd: sliderFilterEnd,
      }),
    [
      cruises,
      cruiseGeometry,
      cruiseLegDatesByCruise,
      cruiseColorConfig,
      sliderMode,
      sliderCurrent,
      sliderFilterStart,
      sliderFilterEnd,
    ]
  );

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

  const headFlightArc = useMemo<ArcDatum | null>(
    () => buildHeadFlightArc(sliderMode, filteredFlights, lite, altitudeFactor, arcBaseOffset),
    [sliderMode, filteredFlights, lite, altitudeFactor, arcBaseOffset]
  );

  const liveStats = useMemo(
    () =>
      computeGlobeLiveStats(
        filteredFlights,
        airportPoints,
        cruisePaths,
        portPoints,
        arcsData,
        antipodalArcs
      ),
    [filteredFlights, airportPoints, cruisePaths, portPoints, arcsData, antipodalArcs]
  );

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

  const { cardFlights, clearSelections, selectionScope, resolveSelectedFlight, openTripDetails } =
    useMapSelectionCards({
      flights,
      flightColor: flightCardColor,
      focus: focusOnGlobe,
      setPinned,
    });

  const { onArcHover, onAirportHover, onPortHover, onCruisePathHover, onPinHover } = useGlobeHover(
    tooltipRef,
    t,
    locale
  );

  // Pin + station labels: the HTML overlay is their only route onto the globe (GlobeLabelsOverlay).
  const pinLabels = useMemo(
    () => [
      ...stationLabelPoints(extraLayers),
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
      extraLayers,
    ]
  );

  // The lines of every domain the user switched off go; markers and labels stay.
  const routesVisible = useMapRoutesStore(effectiveRoutes);

  // Everything that lies on the ground is a native MapLibre layer on the globe
  // projection, so it sits on the surface (forgejo#331). deck.gl keeps the
  // flight arcs and whichever caller layers cannot be drawn natively.
  const native = useNativeGlobe({
    mapRef,
    mapReady,
    input: {
      nightCells: nightCellsData,
      showNight,
      cruisePaths,
      cruiseWidthScale: cruiseRouteWidth,
      airportPoints,
      airportColor: airportColor ?? DEFAULT_AIRPORT_COLOR,
      airportRadius: GLOBE_MARKER_BASE_PX * flightMarkerSize,
      portPoints,
      portColor: portColor ?? DEFAULT_PORT_COLOR,
      portRadius: GLOBE_MARKER_BASE_PX * cruiseMarkerSize,
      lodgings,
      lodgingColors: lodgingColorConfig,
      lodgingRadius: GLOBE_MARKER_BASE_PX * lodgingMarkerSize,
      places,
      placeColors: placeColorConfig,
      placeListColors,
      placeRadius: GLOBE_MARKER_BASE_PX * placeMarkerSize,
      extraLayers,
      routesVisible,
      lite,
    },
    hover: {
      airport: onAirportHover,
      port: onPortHover,
      cruise: onCruisePathHover,
      pin: onPinHover,
    },
    hideTooltip: hideTooltip,
    setPinned,
    onOverChange: (over) => cursorMux.set("native", over),
  });

  const drawnLayers = useMemo<Layer[]>(
    () => [
      ...buildGlobeLayers({
        arcsData,
        antipodalArcs,
        headFlightArc,
        activeQuartile,
        lite,
        occlusionExt,
        occlusionProps,
        onArcHover,
        isOverNative: native.isOverNative,
        setPinned,
        flightColorConfig,
        arcWidthScale: flightRouteWidth,
      }),
      // The caller's layers that could not go native (heatmaps, polygons, icon
      // and station-label layers). They DO get the occlusion extension every
      // globe-built layer carries, or one on the far side of the sphere draws
      // through it — and the shared tooltip.
      ...occludeExtraLayers(native.remainingExtras, occlusionExt, occlusionProps, onPinHover),
    ],
    [
      arcsData,
      antipodalArcs,
      activeQuartile,
      lite,
      headFlightArc,
      onArcHover,
      native.isOverNative,
      native.remainingExtras,
      occlusionExt,
      occlusionProps,
      flightColorConfig,
      flightRouteWidth,
      onPinHover,
    ]
  );
  const layers = useMemo(
    () => withoutHiddenRoutes(drawnLayers, routesVisible),
    [drawnLayers, routesVisible]
  );

  const legendRanges = useMemo(() => heatLegendRanges(heatmapThresholds), [heatmapThresholds]);

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
        mapStyle={resilientStyle}
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
        {mapReady && (
          <DeckGLOverlay layers={layers} onHover={handleDeckHover} getCursor={getDeckCursor} />
        )}
      </MapGL>

      <GlobeStatsCard stats={liveStats} t={t} />

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

      {/* First-run coachmark: only once there is something on the globe to act on. */}
      <GlobeCoachmark
        hasContent={flights.length + cruises.length + lodgings.length + places.length > 0}
      />

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

      <GlobePinnedOverlay
        pinned={pinned}
        screen={popupScreenPos}
        flights={cardFlights}
        cruises={[...(cruisesForCard ?? cruises)]}
        selectionScope={selectionScope}
        onClose={() => {
          setPinned(null);
          clearSelections();
        }}
        onFlightOpen={onFlightOpen}
        onFlightEdit={
          onEdit
            ? (flightId) => {
                const target = resolveSelectedFlight(flightId);
                if (!target) return;
                setPinned(null);
                clearSelections();
                onEdit(target);
              }
            : undefined
        }
        onTripDetails={() => {
          setPinned(null);
          openTripDetails();
        }}
        onCruiseOpen={onCruiseOpen}
        onLodgingOpen={onLodgingOpen}
        onPlaceOpen={onPlaceOpen}
      />
      {/* Hover tooltip — leaf component with imperative show/hide so onHover
          updates at 60–120 Hz don't re-render the parent GlobeView tree. */}
      <HoverTooltip ref={tooltipRef} />
    </div>
  );
}
