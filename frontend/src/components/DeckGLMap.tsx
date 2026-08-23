import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import MapGL, { useControl, useMap, type MapRef, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { applyHoverCursor } from "./map/mapCursor";
import { createMarkerTooltip } from "./map/markerTooltip";
import { LightingEffect, type PickingInfo } from "@deck.gl/core";
import { useDeckHoverCursor } from "../hooks/useDeckHoverCursor";
import { useTranslation } from "../hooks/useTranslation";
import { applyMapOverlays } from "./Globe/mapOverlays";
import { FlatMapControlPanel } from "./map/FlatMapControlPanel";
import { type AppearanceDomain } from "./map/controlPanelKit";
import type { LabelsMode } from "./map/labelPriority";
import { loadFlightRouteShape, loadMapAppearance, saveMapAppearance } from "./map/mapAppearance";
import type { FlightRouteShape } from "../lib/flightRouteShape";
import { useFlightColorStore } from "../store/flightColorStore";
import { useLodgingColorStore } from "../store/lodgingColorStore";
import { usePlaceColorStore } from "../store/placeColorStore";
import { FLAT_BASEMAPS, resolveFlatStyle, type FlatStyleId } from "./map/basemapStyles";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { Cruise, GeoJSONFeature, Flight } from "../types";
import type { Lodging } from "../types/lodging";
import type { MapMode } from "./MapContainer3D";
import { buildRouteData, createRoutesLayers } from "./layers/routesLayer";
import { buildLodgingPins } from "./layers/lodgingPinsLayer";
import { createHeatmapLayer } from "./layers/heatmapLayer";
import { createTripsLayer, buildTripsData, getTimeRange } from "./layers/tripsLayer";
import { createSpecialFlightsLayers } from "./layers/specialFlightsLayer";
import { SpecialFlightTooltip } from "./specialFlights/SpecialFlightTooltip";
import { getSpecialTooltipAnchor } from "./specialFlights/specialTooltipAnchor";
import {
  createCruiseArcsLayer,
  createCruiseArrowsLayer,
  type CruiseGeometryMap,
} from "./layers/cruiseArcsLayer";
import { useCruiseColorStore } from "../store/cruiseColorStore";
import { createCruisePortsLayer } from "./layers/cruisePortsLayer";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../lib/api/cruise";
import { TimeSlider } from "./TimeSlider";
import { useThemeStore } from "../store/themeStore";
import { MAP_LAYER_COLORS } from "../types/mapTheme";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import { useCruiseSelectionStore } from "../store/cruiseSelectionStore";
import { CruiseTooltip } from "./CruiseTooltip";
import { computeBbox } from "../utils/mapAnimationHelpers";
import { usePlaneAnimation } from "../hooks/usePlaneAnimation";
import { usePulseAnimation } from "../hooks/usePulseAnimation";
import { MapTooltip } from "./MapTooltip";
import { TripTooltip } from "./TripTooltip";
import { AirportTooltip } from "./AirportTooltip";
import {
  NativeRoutesLayer,
  NATIVE_ROUTE_LINE_ID,
  NATIVE_AIRPORT_CIRCLE_ID,
} from "./NativeRoutesLayer";

// Small delay before the click tooltip appears — just enough for the flyTo
// to start so the card doesn't flash at the old anchor, then it rides the
// reprojection as the camera moves. Was 1800 ms, which read as sluggish.
const TOOLTIP_DELAY_MS = 220;

/** Check once whether WebGL2 is available (deck.gl requires it). */
function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return gl !== null;
  } catch {
    return false;
  }
}

const webgl2Available = hasWebGL2();

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

interface DeckOverlayProps {
  layers: Layer[];
  effects: LightingEffect[];
  getTooltip: ReturnType<typeof createMarkerTooltip>;
  onHover: (info: PickingInfo) => void;
}

function DeckGLOverlay({ layers, effects, getTooltip, onHover }: DeckOverlayProps): null {
  const { current: map } = useMap();
  // Issue #247: the pointer must say what is clickable. deck.gl's own
  // `getCursor` cannot do it here — MapboxOverlay mounts the deck canvas with
  // `pointerEvents: 'none'` and never reads that prop, so the visible cursor
  // belongs to the MapLibre canvas underneath.
  const hoverWithCursor = (info: PickingInfo): void => {
    applyHoverCursor(map, Boolean(info.object));
    onHover(info);
  };
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        effects,
        pickingRadius: 5,
        getTooltip,
        onHover: hoverWithCursor,
      }),
    { position: "top-left" }
  );
  // Push getTooltip on every render too so language switches propagate
  // — MapboxOverlay caches the constructor's getTooltip otherwise. `onHover`
  // rides along for the same reason.
  overlay.setProps({ layers, effects, pickingRadius: 5, getTooltip, onHover: hoverWithCursor });
  return null;
}

interface DeckGLMapProps {
  flights: GeoJSONFeature[];
  visMode: MapMode;
  minRouteCount?: number;
  onFlightClick?: (flightId: string) => void;
  onRouteClick?: (flightIds: string[]) => void;
  onEdit?: (flight: Flight) => void;
  flightList?: Flight[];
  onResetTrip?: () => void;
  cruises?: Cruise[];
  /** Extra deck.gl layers appended after all internally-built layers. */
  extraLayers?: Layer[];
  /** Which domain appearance sections the control panel exposes. */
  appearanceDomains?: readonly AppearanceDomain[];
  /**
   * Lodging marker-size slider value + setter. Controlled from the PARENT
   * (`MapContainer3D`), unlike the flight/cruise marker sizes which
   * DeckGLMap owns as local state — MapContainer3D is what builds the
   * lodging pin layer (via `buildLodgingPins`) and passes it in as part of
   * `extraLayers`, so it needs to own the value to re-memo on it. DeckGLMap
   * only needs it to render the slider in the flat-map control panel.
   * Both default to a no-op 1× so callers that don't use the lodging
   * domain (every tab except LodgingTab) are unaffected.
   */
  lodgingMarkerSize?: number;
  onLodgingMarkerSizeChange?: (s: number) => void;
  /**
   * Lodging places (hotels/campsites) to render as pins + name labels.
   * Built into a ScatterplotLayer + TextLayer HERE (not by the caller, via
   * `buildLodgingPins`) — unlike the marker-size value above, the pin layer
   * itself needs `zoom` and `labelsMode`, both of which are private state
   * that only exists inside this component (mirrors exactly how
   * `createCruisePortsLayer` is built here rather than by MapContainer3D).
   * Undefined/empty means "no lodging layer at all".
   */
  lodgingsOverride?: readonly Lodging[];
  /**
   * Fired when a lodging pin is clicked — receives the lodging id. Wrapped
   * internally so the click also sets `deckClickedRef` (see
   * `handleLodgingClick`), the same guard `handleAirportClick`/
   * `handleFlightClick` use to stop the native background-click handler
   * from immediately clearing whatever the click just did.
   */
  onLodgingClick?: (lodgingId: string) => void;
}

export function DeckGLMap({
  flights,
  visMode,
  minRouteCount = 1,
  onFlightClick,
  onRouteClick,
  onEdit,
  flightList,
  onResetTrip,
  cruises = [],
  extraLayers,
  appearanceDomains = ["flight", "cruise"],
  lodgingMarkerSize = 1,
  onLodgingMarkerSizeChange,
  lodgingsOverride,
  onLodgingClick,
}: DeckGLMapProps): JSX.Element {
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";
  const getTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const mapTheme = useThemeStore((state) => state.mapTheme);
  // Flight arc colour comes exclusively from the shared flight-colour store
  // (mode + user colours) — see lib/flightColor.ts. themeColors still drives
  // the layers that are NOT flight arcs (airport dots, heatmap).
  const themeColors = useMemo(() => MAP_LAYER_COLORS[mapTheme], [mapTheme]);
  // One store, shared with the globe, both control panels and the dashboard
  // legend — so the legend can never disagree with what is on the map.
  const flightColorConfig = useFlightColorStore((s) => s.config);
  const setFlightColorMode = useFlightColorStore((s) => s.setMode);
  const setFlightColor = useFlightColorStore((s) => s.setColor);
  // Same deal for cruises: the mode + colours live in one store the globe, both
  // panels and the dashboard legend read too. The mode used to be a hardcoded
  // prop per dashboard tab — the user had no say and never saw "Pro Reise".
  const cruiseColorConfig = useCruiseColorStore((s) => s.config);
  const lodgingColorConfig = useLodgingColorStore((s) => s.config);
  const setLodgingColorMode = useLodgingColorStore((s) => s.setMode);
  const setLodgingColor = useLodgingColorStore((s) => s.setColor);
  // POI has no marker-size slider of its own — place pins share the airport/
  // port dot sizing — so only mode + colours travel to the panel.
  const placeColorConfig = usePlaceColorStore((s) => s.config);
  const setPlaceColorMode = usePlaceColorStore((s) => s.setMode);
  const setPlaceColor = usePlaceColorStore((s) => s.setColor);
  const setCruiseColorMode = useCruiseColorStore((s) => s.setMode);
  const setCruiseColor = useCruiseColorStore((s) => s.setColor);
  const mapRef = useRef<MapRef>(null);

  // Hand cursor over any pickable deck object — airports, ports, lodging pins
  // (#247). Driven by picking, so it needs no per-layer wiring.
  const { isHovering, onHover: onDeckHover } = useDeckHoverCursor();

  const [mapLoaded, setMapLoaded] = useState(false);
  // Flat-map appearance customisation (mirrors the globe's "Anpassung"
  // panel) + style-level overlays, persisted so the look survives reloads.
  // `markerColor === null` keeps the theme airport-dot colour.
  const [styleId, setStyleId] = useState<FlatStyleId>(() => loadMapAppearance().styleId ?? "dark");
  // Flight-domain appearance. The route COLOUR lives in the flight-colour
  // store above (mode + colours); only shape / width / marker settings are local.
  //
  // The SHAPE (#183) is flat-map-only, which is why it lives here as plain
  // component state next to the width slider rather than in a shared store like
  // the colour config: the globe never reads it, and the flat map is the only
  // renderer that has to know.
  const [flightRouteShape, setFlightRouteShape] = useState<FlightRouteShape>(() =>
    loadFlightRouteShape()
  );
  const [flightRouteWidth, setFlightRouteWidth] = useState<number>(
    () => loadMapAppearance().flightRouteWidth ?? 1
  );
  const [markerColor, setMarkerColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().airportColor ?? null
  );
  const [flightMarkerSize, setFlightMarkerSize] = useState<number>(
    () => loadMapAppearance().flightMarkerSize ?? 1
  );
  // Cruise-domain appearance. The route COLOUR lives in the cruise-colour store
  // above (mode + colours); only width / marker / arrow settings are local.
  const [cruiseRouteWidth, setCruiseRouteWidth] = useState<number>(
    () => loadMapAppearance().cruiseRouteWidth ?? 1
  );
  const [portColor, setPortColor] = useState<[number, number, number] | null>(
    () => loadMapAppearance().portColor ?? null
  );
  const [cruiseMarkerSize, setCruiseMarkerSize] = useState<number>(
    () => loadMapAppearance().cruiseMarkerSize ?? 1
  );
  const [cruiseArrowScale, setCruiseArrowScale] = useState<number>(
    () => loadMapAppearance().cruiseArrowScale ?? 1
  );
  const [showTerrain, setShowTerrain] = useState<boolean>(
    () => loadMapAppearance().showTerrain ?? false
  );
  const [showPlaceLabels, setShowPlaceLabels] = useState<boolean>(
    () => loadMapAppearance().showPlaceLabels ?? true
  );
  const [labelsMode, setLabelsMode] = useState<LabelsMode>(
    () => loadMapAppearance().labelsMode ?? "important"
  );
  useEffect(() => {
    saveMapAppearance({
      styleId,
      flightRouteShape,
      flightRouteWidth,
      airportColor: markerColor,
      flightMarkerSize,
      cruiseRouteWidth,
      portColor,
      cruiseMarkerSize,
      cruiseArrowScale,
      showTerrain,
      showPlaceLabels,
      labelsMode,
    });
  }, [
    styleId,
    flightRouteShape,
    flightRouteWidth,
    markerColor,
    flightMarkerSize,
    cruiseRouteWidth,
    portColor,
    cruiseMarkerSize,
    cruiseArrowScale,
    showTerrain,
    showPlaceLabels,
    labelsMode,
  ]);
  // Apply the style-level overlays (relief hillshade + basemap place
  // names) once the map is loaded and whenever a toggle flips. Same
  // generic MapLibre helper the globe uses.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;
    applyMapOverlays(map, { showTerrain, showPlaceLabels });
  }, [mapLoaded, showTerrain, showPlaceLabels]);
  // Mirror the toggles into refs so the once-mounted style.load handler
  // below reads current values after a basemap swap wipes the overlays.
  const showTerrainRef = useRef(showTerrain);
  const showPlaceLabelsRef = useRef(showPlaceLabels);
  useEffect(() => {
    showTerrainRef.current = showTerrain;
  }, [showTerrain]);
  useEffect(() => {
    showPlaceLabelsRef.current = showPlaceLabels;
  }, [showPlaceLabels]);
  // A basemap swap (styleId change) reloads the MapLibre style, wiping the
  // hillshade source/layer and resetting symbol visibility — re-apply on
  // every style.load from the latest toggle values.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;
    const reapply = (): void =>
      applyMapOverlays(map, {
        showTerrain: showTerrainRef.current,
        showPlaceLabels: showPlaceLabelsRef.current,
      });
    map.on("style.load", reapply);
    return () => {
      map.off("style.load", reapply);
    };
  }, [mapLoaded]);
  // Zoom is read from MapGL viewState on every move so layers can hide
  // labels / decimate symbols at low zoom. Updated via the move handler
  // to avoid an extra render path.
  const [zoom, setZoom] = useState<number>(INITIAL_VIEW_STATE.zoom ?? 2);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const deckClickedRef = useRef(false);

  // Real A* sea-route geometry for each cruise, indexed by cruise id.
  // Fetched lazily after mount; the arcs layer renders Bezier until an
  // entry lands here, then swaps to the computed route. Any fetch
  // failure is logged via the api client's interceptor and left as
  // a missing entry — the Bezier fallback keeps the UI working.
  const [cruiseGeometry, setCruiseGeometry] = useState<Map<string, CruiseRouteFeatureCollection>>(
    () => new Map()
  );

  // Ref mirror of `cruiseGeometry` so the fetch loop can read the
  // latest state without re-triggering the effect on every successful
  // fetch. We only want to re-run when the cruise list itself changes.
  const cruiseGeometryRef = useRef<Map<string, CruiseRouteFeatureCollection>>(cruiseGeometry);
  useEffect(() => {
    cruiseGeometryRef.current = cruiseGeometry;
  }, [cruiseGeometry]);

  useEffect(() => {
    if (cruises.length === 0) return;
    let cancelled = false;
    // Single batch round-trip for all cruise geometries. Server returns
    // a {[id]: FeatureCollection} map; we merge into local state. The
    // server cache makes repeat calls (mode switches, refilters) cheap.
    // Anything already in state is filtered out so we never re-fetch.
    const run = async (): Promise<void> => {
      const missingIds = cruises
        .map((c) => c.id)
        .filter((id) => !cruiseGeometryRef.current.has(id));
      if (missingIds.length === 0) return;
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
      } catch {
        // Swallow — interceptor handles logging. Bezier fallback remains.
      }
    };
    void run();
    return (): void => {
      cancelled = true;
    };
  }, [cruises]);

  // Per-field selectors. Bare `useFlightSelectionStore()` would re-render
  // the map on every field change in the store; with selectors we only
  // re-render when the specific field this component reads changes.
  const selectedIds = useFlightSelectionStore((s) => s.selectedIds);
  const selectedFlights = useFlightSelectionStore((s) => s.selectedFlights);
  const highlightMode = useFlightSelectionStore((s) => s.highlightMode);
  const clearSelection = useFlightSelectionStore((s) => s.clearSelection);
  const showDetails = useFlightSelectionStore((s) => s.showDetails);
  const selectedCruiseId = useCruiseSelectionStore((s) => s.selectedCruiseId);
  const selectedCruise = useCruiseSelectionStore((s) => s.selectedCruise);
  const setCruiseSelection = useCruiseSelectionStore((s) => s.setSelection);
  const clearCruiseSelection = useCruiseSelectionStore((s) => s.clearSelection);

  // Reset playing state when leaving trips mode (Bug 3)
  useEffect(() => {
    if (visMode !== "trips") {
      setPlaying(false);
    }
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

  const planeLayers = usePlaneAnimation(selectedFlights);
  const pulseLayers = usePulseAnimation(selectedFlights);

  // ── Tooltip geo anchors ─────────────────────────────────────────────────────
  // All tooltips store geographic coordinates so they reproject correctly on move.

  // Flight / trip tooltip
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const tooltipGeoRef = useRef<{
    mode: "group" | "single";
    points: Array<[number, number]>; // [lon, lat]
  } | null>(null);

  // Airport tooltip
  const [airportIata, setAirportIata] = useState<string | null>(null);
  const [airportPos, setAirportPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const airportGeoRef = useRef<[number, number] | null>(null); // [lon, lat]

  // Reproject all active tooltips — called on every map move/zoom via onMove
  const recomputeAllPositions = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const anchor = tooltipGeoRef.current;
    if (anchor) {
      if (anchor.mode === "group") {
        const screenPts = anchor.points.map((p) => map.project(p));
        const minX = Math.min(...screenPts.map((p) => p.x));
        const maxX = Math.max(...screenPts.map((p) => p.x));
        const minY = Math.min(...screenPts.map((p) => p.y));
        setTooltipPos({ x: (minX + maxX) / 2, y: minY });
      } else {
        const pt = map.project(anchor.points[0]);
        setTooltipPos({ x: pt.x, y: pt.y });
      }
    }

    const airportAnchor = airportGeoRef.current;
    if (airportAnchor) {
      const pt = map.project(airportAnchor);
      setAirportPos({ x: pt.x, y: pt.y });
    }
  }, []);

  const moveRafRef = useRef<number | null>(null);

  const handleMapMove = useCallback(() => {
    if (moveRafRef.current !== null) return; // already scheduled
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = null;
      recomputeAllPositions();
      const map = mapRef.current?.getMap();
      if (map) {
        const z = map.getZoom();
        // Snap to integer to avoid re-rendering layers on every fractional
        // zoom tick — only the threshold crossing matters for label visibility.
        const snapped = Math.round(z);
        setZoom((prev) => (prev === snapped ? prev : snapped));
      }
    });
  }, [recomputeAllPositions]);

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setTooltipVisible(false);
    tooltipGeoRef.current = null;
    if (selectedFlights.length === 0) return;

    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map || selectedFlights.length === 0) return;

      if (highlightMode === "group") {
        const pts: Array<[number, number]> = [];
        for (const f of selectedFlights) {
          if (f.depLon != null && f.depLat != null) pts.push([f.depLon, f.depLat]);
          if (f.arrLon != null && f.arrLat != null) pts.push([f.arrLon, f.arrLat]);
        }
        if (pts.length === 0) return;
        tooltipGeoRef.current = { mode: "group", points: pts };
      } else {
        const f = selectedFlights[0];
        // Special flights anchor off event/pattern coords when regular
        // dep/arr coords would make the tooltip float over empty ocean
        // (e.g. eclipse chase mid-Atlantic, ZeroG hold pattern).
        if (f.specialType) {
          const anchor = getSpecialTooltipAnchor(f);
          if (!anchor) return;
          tooltipGeoRef.current = { mode: "single", points: [anchor] };
        } else {
          if (f.depLon == null || f.arrLon == null || f.depLat == null || f.arrLat == null) return;
          tooltipGeoRef.current = {
            mode: "single",
            points: [[(f.depLon + f.arrLon) / 2, (f.depLat + f.arrLat) / 2]],
          };
        }
      }

      recomputeAllPositions();
      setTooltipVisible(true);
    }, TOOLTIP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [selectedFlights, highlightMode, recomputeAllPositions]);

  // Wrap onFlightClick so that a deck.gl layer click sets the guard ref BEFORE the
  // Map onClick fires and would otherwise clear the selection immediately (Bug 1).
  const handleFlightClick = useCallback(
    (flightIdOrIds: string | string[]): void => {
      deckClickedRef.current = true;
      setAirportIata(null);
      airportGeoRef.current = null;
      // Route clicks pass all flightIds for that route; single-flight clicks pass a string
      if (Array.isArray(flightIdOrIds)) {
        onRouteClick?.(flightIdOrIds);
      } else {
        onFlightClick?.(flightIdOrIds);
      }
    },
    [onFlightClick, onRouteClick]
  );

  const handleAirportClick = useCallback(
    (iata: string, lon: number, lat: number): void => {
      deckClickedRef.current = true;
      clearSelection();
      setTooltipVisible(false);
      tooltipGeoRef.current = null;
      airportGeoRef.current = [lon, lat];
      setAirportIata(iata);
      // Initial screen position
      const map = mapRef.current?.getMap();
      if (map) {
        const pt = map.project([lon, lat]);
        setAirportPos({ x: pt.x, y: pt.y });
      }
    },
    [clearSelection]
  );

  // Mirrors handleAirportClick's guard exactly: set deckClickedRef BEFORE
  // the native background-click handler runs, so a lodging pin click
  // doesn't get immediately undone by the fallback clearSelection/
  // clearCruiseSelection branch in handleNativeClick.
  const handleLodgingClick = useCallback(
    (lodgingId: string): void => {
      deckClickedRef.current = true;
      onLodgingClick?.(lodgingId);
    },
    [onLodgingClick]
  );

  // Heavy data build extracted from the layer useMemo so selection changes
  // (which only need to re-style the existing arcs) don't re-aggregate
  // flights into routes. Deps are deliberately limited to fields that
  // actually affect arc/point geometry + base color.
  const routeData = useMemo(
    () => buildRouteData(flights, minRouteCount, flightColorConfig),
    [flights, minRouteCount, flightColorConfig]
  );

  // Standalone layer set for Sonder-Flüge — rendered on top of the
  // normal route layers in "routes" mode so rundowns, eclipse chases,
  // ZeroG and rocket-launch flights get a distinct visual language
  // instead of a garbage-collapsed arc from airport to itself. Per the
  // V2 architectural call, special-flights are an overlay, NOT a new
  // MapMode.
  const specialFlightLayers = useMemo(
    () =>
      createSpecialFlightsLayers(
        (flightList ?? []).filter((f) => !!f.specialType),
        (id) => handleFlightClick(id)
      ),
    [flightList, handleFlightClick]
  );

  const layers = useMemo((): Layer[] => {
    let base: Layer[];
    switch (visMode) {
      case "routes":
        base = [
          ...createRoutesLayers(
            routeData,
            handleFlightClick,
            themeColors,
            0.3,
            selectedIds,
            handleAirportClick,
            zoom,
            {
              markerColor: markerColor ?? undefined,
              markerSizeScale: flightMarkerSize,
              arcWidthScale: flightRouteWidth,
              labelsMode,
              routeShape: flightRouteShape,
            },
            flightColorConfig
          ),
          ...specialFlightLayers,
        ];
        break;
      case "heatmap":
        base = [createHeatmapLayer(flights)];
        break;
      case "trips":
        base = [createTripsLayer(trips, currentTime)];
        break;
      default:
        // "globe" is handled by MapContainer3D (GlobeView); DeckGLMap is not
        // rendered in that mode. All other values are exhaustively covered above.
        base = [];
    }

    // Cruise arcs + ports are supplemental overlays — always on when cruise
    // data is present. Gated upstream by the cruise domain being enabled.
    // The arcs layer splines the coarse waypoints from
    // /cruises/:id/geometry into smooth curves; until the fetch resolves
    // for a given cruise, each leg falls back to a 2-vertex direct chord.
    const geometryMap: CruiseGeometryMap = cruiseGeometry;
    const cruiseArcAppearance = {
      zoom,
      arcWidthScale: cruiseRouteWidth,
      arrowSizeScale: cruiseArrowScale,
      colorConfig: cruiseColorConfig,
    };
    const arcs = createCruiseArcsLayer(
      cruises,
      geometryMap,
      selectedCruiseId,
      (cruiseId: string) => {
        const cruise = cruises.find((c) => c.id === cruiseId);
        if (cruise) setCruiseSelection(cruise);
      },
      cruiseArcAppearance
    );
    const arrows = createCruiseArrowsLayer(
      cruises,
      geometryMap,
      selectedCruiseId,
      cruiseArcAppearance
    );
    const ports = createCruisePortsLayer(cruises, zoom, {
      portColor: portColor ?? undefined,
      portSizeScale: cruiseMarkerSize,
      labelsMode,
    });

    // Split cruise visuals into a "below" group (arcs/arrows render
    // beneath flight arcs and airport markers) and an "above" group
    // (port halo/dot/label sit on top of everything). Without this
    // split cruise paths drew over airport dots at every crossing,
    // visually clipping the dots.
    const cruisePathsBelow: Layer[] = [
      ...(arcs !== null ? [arcs] : []),
      ...(arrows !== null ? [arrows] : []),
    ];
    const cruisePortsAbove: Layer[] = ports ?? [];

    // Lodging pins are flat-map only, additive on top of everything else —
    // built here (not by the caller) so the layer can read the SAME private
    // zoom/labelsMode state the cruise-port labels use, and so a pin click
    // can be wrapped with the deckClickedRef guard (see handleLodgingClick).
    const lodgingLayers: Layer[] =
      buildLodgingPins(lodgingsOverride ?? [], lodgingMarkerSize, zoom, {
        onPinClick: handleLodgingClick,
        labelsMode,
        colors: lodgingColorConfig,
      }) ?? [];

    return [
      ...cruisePathsBelow,
      ...base,
      ...cruisePortsAbove,
      ...lodgingLayers,
      ...(extraLayers ?? []),
    ];
  }, [
    visMode,
    flights,
    routeData,
    trips,
    currentTime,
    handleFlightClick,
    handleAirportClick,
    themeColors,
    selectedIds,
    selectedCruiseId,
    setCruiseSelection,
    cruises,
    cruiseGeometry,
    extraLayers,
    zoom,
    specialFlightLayers,
    markerColor,
    portColor,
    flightMarkerSize,
    cruiseMarkerSize,
    flightRouteShape,
    flightRouteWidth,
    cruiseRouteWidth,
    cruiseArrowScale,
    labelsMode,
    cruiseColorConfig,
    flightColorConfig,
    lodgingsOverride,
    lodgingMarkerSize,
    lodgingColorConfig,
    handleLodgingClick,
  ]);

  // No 3D modes remain — lighting effect is unused but kept as empty array for
  // the DeckGLOverlay API.
  const effects: LightingEffect[] = [];

  // Enriched /geo feature for the currently selected flight — its dep/arr
  // country codes feed the flags in the click tooltip (the structured Flight
  // doesn't carry a country).
  const selectedGeo = useMemo(() => {
    const id = selectedFlights[0]?.id;
    return id ? flights.find((f) => f.properties.id === id) : undefined;
  }, [selectedFlights, flights]);

  const handleTimeChange = useCallback((value: number | ((prev: number) => number)): void => {
    setCurrentTime((prev) => (typeof value === "function" ? value(prev) : value));
  }, []);

  // Native layer click handler (WebGL1 fallback)
  const handleNativeClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // If deck.gl handled this click, ignore
      if (deckClickedRef.current) {
        deckClickedRef.current = false;
        return;
      }

      const feature = e.features?.[0];
      if (feature) {
        if (feature.layer.id === NATIVE_ROUTE_LINE_ID && onRouteClick) {
          try {
            const ids = JSON.parse(feature.properties.flightIds as string) as string[];
            deckClickedRef.current = true; // prevent background clear
            onRouteClick(ids);
          } catch {
            // ignore
          }
          return;
        }
        if (feature.layer.id === NATIVE_AIRPORT_CIRCLE_ID) {
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          deckClickedRef.current = true;
          handleAirportClick(feature.properties.iata as string, coords[0], coords[1]);
          return;
        }
      }

      // Background click — clear selection
      clearSelection();
      clearCruiseSelection();
      setAirportIata(null);
      airportGeoRef.current = null;
      onResetTrip?.();
    },
    [onRouteClick, handleAirportClick, clearSelection, clearCruiseSelection, onResetTrip]
  );

  // Interactive layer IDs for native fallback (enables cursor: pointer on hover)
  const nativeInteractiveIds = !webgl2Available
    ? [NATIVE_ROUTE_LINE_ID, NATIVE_AIRPORT_CIRCLE_ID]
    : undefined;

  return (
    <div className="relative w-full h-full">
      <MapGL
        ref={mapRef}
        reuseMaps
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={resolveFlatStyle(styleId)}
        style={{ position: "absolute", inset: "0" }}
        onLoad={() => setMapLoaded(true)}
        onMove={handleMapMove}
        onClick={handleNativeClick}
        interactiveLayerIds={nativeInteractiveIds}
        cursor={isHovering || nativeInteractiveIds ? "pointer" : undefined}
      >
        {webgl2Available && mapLoaded && (
          <DeckGLOverlay
            layers={[...layers, ...pulseLayers, ...planeLayers]}
            effects={effects}
            getTooltip={getTooltip}
            onHover={onDeckHover}
          />
        )}
        {!webgl2Available && visMode === "routes" && (
          <NativeRoutesLayer
            flights={flights}
            minRouteCount={minRouteCount}
            selectedIds={selectedIds}
          />
        )}
      </MapGL>

      {/* Consolidated map control panel — same design + kit as the globe.
          Layers (place names / relief) + appearance (route + airport
          marker colour / width / size), so the port/airport look is
          adjustable from the individual tab views too. */}
      <div className="absolute bottom-4 left-4 z-20" style={{ pointerEvents: "auto" }}>
        <FlatMapControlPanel
          showPlaceLabels={showPlaceLabels}
          onShowPlaceLabelsChange={setShowPlaceLabels}
          showTerrain={showTerrain}
          onShowTerrainChange={setShowTerrain}
          labelsMode={labelsMode}
          onLabelsModeChange={setLabelsMode}
          styleOptions={FLAT_BASEMAPS}
          styleId={styleId}
          onStyleChange={(id) => setStyleId(id as FlatStyleId)}
          appearanceDomains={appearanceDomains}
          flightAppearance={{
            colorConfig: flightColorConfig,
            onColorModeChange: setFlightColorMode,
            onColorChange: setFlightColor,
            // Flat-map-only (#183) — the globe panel passes neither, so the
            // shape picker never shows up there.
            routeShape: flightRouteShape,
            onRouteShapeChange: setFlightRouteShape,
            routeWidth: flightRouteWidth,
            onRouteWidthChange: setFlightRouteWidth,
            markerColor,
            onMarkerColorChange: setMarkerColor,
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
            arrowScale: cruiseArrowScale,
            onArrowScaleChange: setCruiseArrowScale,
          }}
          lodgingAppearance={{
            markerSize: lodgingMarkerSize,
            onMarkerSizeChange: onLodgingMarkerSizeChange ?? (() => {}),
            colorConfig: lodgingColorConfig,
            onColorModeChange: setLodgingColorMode,
            onColorChange: setLodgingColor,
          }}
          placeAppearance={{
            colorConfig: placeColorConfig,
            onColorModeChange: setPlaceColorMode,
            onColorChange: setPlaceColor,
          }}
        />
      </div>

      {/* Subtle grid overlay — glassmorphism only */}
      {mapTheme === "glassmorphism" && (
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

      {tooltipVisible && highlightMode === "group" && selectedFlights.length > 1 && (
        <TripTooltip
          flights={selectedFlights}
          screenX={tooltipPos.x}
          screenY={tooltipPos.y}
          onClose={() => {
            clearSelection();
            setTooltipVisible(false);
            onResetTrip?.();
          }}
          onShowDetails={() => {
            setTooltipVisible(false);
            showDetails(selectedFlights, "route-details");
          }}
        />
      )}

      {tooltipVisible &&
        highlightMode !== "group" &&
        selectedFlights.length > 0 &&
        (selectedFlights[0].specialType ? (
          <SpecialFlightTooltip
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
        ) : (
          <MapTooltip
            flight={selectedFlights[0]}
            screenX={tooltipPos.x}
            screenY={tooltipPos.y}
            depCountry={selectedGeo?.properties.departureAirport.country}
            arrCountry={selectedGeo?.properties.arrivalAirport.country}
            onEdit={(flight) => {
              clearSelection();
              onEdit?.(flight);
            }}
            onClose={() => {
              clearSelection();
              setTooltipVisible(false);
            }}
          />
        ))}

      {airportIata && (
        <AirportTooltip
          iata={airportIata}
          screenX={airportPos.x}
          screenY={airportPos.y}
          flights={flights}
          onClose={() => {
            setAirportIata(null);
            airportGeoRef.current = null;
          }}
        />
      )}

      {selectedCruise !== null && (
        <CruiseTooltip cruise={selectedCruise} onClose={clearCruiseSelection} />
      )}

      {!webgl2Available && (
        <div
          className="absolute bottom-2 left-2 z-10 text-xs px-2 py-1 rounded-sm"
          style={{
            background: "rgba(0,0,0,0.6)",
            color: "rgba(255,200,50,0.9)",
          }}
        >
          WebGL2 unavailable — flight routes disabled
        </div>
      )}
    </div>
  );
}
