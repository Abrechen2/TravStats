import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import { createMarkerTooltip } from "../map/markerTooltip";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { Cruise } from "../../types";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { createCruiseArcsLayer, createCruiseArrowsLayer } from "../layers/cruiseArcsLayer";
import { createCruisePortsLayer } from "../layers/cruisePortsLayer";
import { DEFAULT_CRUISE_COLORS, type CruiseColorConfig } from "../../lib/cruiseColor";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { RouteEditorOverlay } from "./RouteEditorOverlay";
import {
  beginDrag,
  dragWaypoint,
  initRouteEditor,
  insertWaypoint,
  nudgeWaypoint,
  removeWaypoint,
  selectWaypoint,
  undo,
  type LonLat,
  type RouteEditorState,
} from "./routeEditorState";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** The detail map shows ONE cruise — always in that cruise's own hue. */
const DETAIL_MAP_COLOR_CONFIG: CruiseColorConfig = {
  mode: "perCruise",
  colors: DEFAULT_CRUISE_COLORS,
};

const INITIAL_VIEW: MapViewState = {
  longitude: 10,
  latitude: 52,
  zoom: 3,
  pitch: 0,
  bearing: 0,
};

interface DeckOverlayProps {
  layers: Layer[];
  getTooltip: ReturnType<typeof createMarkerTooltip>;
  /**
   * Deck-level fallback click handler. deck.gl calls a picked layer's OWN
   * `onClick` first; only a pick that no layer's onClick handled (or that
   * returned falsy) reaches this root handler. The route editor's guide
   * line returns `true` on a successful insert, so it consumes its own
   * clicks — this handler only ever sees the ones nothing else claimed,
   * which is exactly the "click a leg to enter the editor" case.
   */
  onClick?: (info: PickingInfo) => void;
}

function DeckGLOverlay({ layers, getTooltip, onClick }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 5,
        getTooltip,
        onClick,
      }),
    { position: "top-left" }
  );
  overlay.setProps({ layers, pickingRadius: 5, getTooltip, onClick });
  return null;
}

interface Props {
  cruise: Cruise;
}

/** Which leg is under edit, keyed the way the server keys it. */
interface EditingLeg {
  fromPortId: number;
  toPortId: number;
}

/**
 * Mini-map for the cruise detail page — shows this one cruise's sea
 * route with port markers. Fetches the schematic waypoint FeatureCollection
 * from `/cruises/:id/geometry`; the shared cruiseArcsLayer splines the
 * waypoints into smooth continental-detour curves. Auto-fits bounds on
 * first geometry + port load, then lets the user pan/zoom freely.
 */
export function CruiseRouteMap({ cruise }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";
  const getTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const mapRef = useRef<MapRef | null>(null);
  const [geometry, setGeometry] = useState<CruiseRouteFeatureCollection | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [zoom, setZoom] = useState<number>(INITIAL_VIEW.zoom ?? 3);
  const didFit = useRef(false);
  const [editing, setEditing] = useState<EditingLeg | null>(null);
  const [editorState, setEditorState] = useState<RouteEditorState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fc = await cruiseApi.getGeometry(cruise.id);
        if (!cancelled) setGeometry(fc);
      } catch (err) {
        logger.warn("CruiseRouteMap: failed to load geometry", err);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [cruise.id]);

  /**
   * The geometry the map draws. While editing, the edited leg's coordinates
   * come from local state — otherwise the user would drag a handle and watch
   * the old server line stay put. Every other leg is untouched.
   */
  const displayGeometry = useMemo((): CruiseRouteFeatureCollection | null => {
    if (!geometry) return null;
    if (!editing || !editorState) return geometry;
    return {
      ...geometry,
      features: geometry.features.map((f) =>
        f.properties.fromPortId === editing.fromPortId &&
        f.properties.toPortId === editing.toPortId
          ? { ...f, geometry: { ...f.geometry, coordinates: editorState.waypoints } }
          : f
      ),
    };
  }, [geometry, editing, editorState]);

  const geometryMap = useMemo(
    () => (displayGeometry ? new Map([[cruise.id, displayGeometry]]) : new Map()),
    [displayGeometry, cruise.id]
  );

  /**
   * ~4 screen pixels' worth of degrees at the current zoom, so one arrow
   * press moves a similar on-screen distance at any zoom level rather than
   * a single pixel zoomed out and a continent zoomed in.
   */
  const nudgeStep = 360 / 2 ** (zoom + 6);

  /**
   * Route-editor state transitions. Every mutation goes through the pure
   * reducer in routeEditorState.ts — nothing here recomputes waypoints
   * itself, so the editor has exactly one source of truth for the line.
   */
  const onEditorDragStart = useCallback((index: number): void => {
    setEditorState((prev) => (prev ? beginDrag(prev, index) : prev));
  }, []);

  const onEditorDrag = useCallback((index: number, to: LonLat): void => {
    setEditorState((prev) => (prev ? dragWaypoint(prev, index, to) : prev));
  }, []);

  const onEditorSelect = useCallback((index: number): void => {
    setEditorState((prev) => (prev ? selectWaypoint(prev, index) : prev));
  }, []);

  const onEditorRemove = useCallback((index: number): void => {
    setEditorState((prev) => (prev ? removeWaypoint(prev, index) : prev));
  }, []);

  const onEditorNudge = useCallback((index: number, dLon: number, dLat: number): void => {
    setEditorState((prev) => (prev ? nudgeWaypoint(prev, index, dLon, dLat) : prev));
  }, []);

  const onEditorInsert = useCallback((segmentIndex: number, at: LonLat): void => {
    setEditorState((prev) => (prev ? insertWaypoint(prev, segmentIndex, at) : prev));
  }, []);

  const onEditorUndo = useCallback((): void => {
    setEditorState((prev) => (prev ? undo(prev) : prev));
  }, []);

  /**
   * MapLibre's own keyboard handler listens on the map container, and a
   * handle's keydown bubbles into it NATIVELY — before React's root-mounted
   * synthetic handler can stop anything. So while a leg is being edited the
   * map's keyboard navigation is switched off entirely; otherwise every
   * arrow-key nudge also pans the map 100px (measured in the browser).
   */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (editing) map.keyboard.disable();
    else map.keyboard.enable();
    return (): void => {
      map.keyboard.enable();
    };
  }, [editing]);

  /**
   * Entering the editor. Task 3 owns this so the editor is demonstrable on
   * its own; Task 4 adds the exit/cancel control, so `editing` simply stays
   * set once a leg is clicked. The `cruise-arcs` PathLayer is always
   * pickable (see createCruiseArcsLayer) but is not given its own onClick
   * here, so a hit on it falls through to this deck-level handler — see the
   * comment on DeckOverlayProps.onClick above for why that is safe to rely
   * on alongside the guide line's own onClick.
   */
  const handleMapClick = useCallback(
    (info: PickingInfo): void => {
      if (editing || !geometry) return;
      if (info.layer?.id !== "cruise-arcs") return;
      const clicked = info.object as { fromPortId: number; toPortId: number } | undefined;
      if (!clicked) return;
      const feature = geometry.features.find(
        (f) =>
          f.properties.fromPortId === clicked.fromPortId &&
          f.properties.toPortId === clicked.toPortId
      );
      if (!feature) return;
      setEditing({ fromPortId: clicked.fromPortId, toPortId: clicked.toPortId });
      setEditorState(initRouteEditor(feature.geometry.coordinates));
    },
    [editing, geometry]
  );

  const layers: Layer[] = useMemo(() => {
    // The cruise DETAIL map, not a dashboard view: it shows exactly one cruise,
    // so it always paints that cruise's own hue. It has no control panel and
    // deliberately does not follow the dashboard's cruise colour mode — a
    // per-cruise page showing the cruise's own colour needs no user setting.
    const arcsLayer = createCruiseArcsLayer([cruise], geometryMap, null, undefined, {
      zoom,
      colorConfig: DETAIL_MAP_COLOR_CONFIG,
    });
    const arrowsLayer = createCruiseArrowsLayer([cruise], geometryMap, null, {
      zoom,
      colorConfig: DETAIL_MAP_COLOR_CONFIG,
    });
    const portsLayers = createCruisePortsLayer([cruise], zoom);

    // The straight guide between handles, one path per segment so a click
    // resolves directly to the segment index insertWaypoint wants. The
    // drawn route is a spline THROUGH the handles and bows away from this
    // straight line — without the guide, a click on the curve could not say
    // which two handles it belongs between.
    const guideLayer =
      editing && editorState
        ? new PathLayer<{ path: LonLat[]; segment: number }>({
            id: "route-editor-guide",
            data: editorState.waypoints.slice(0, -1).map((p, i) => ({
              path: [p, editorState.waypoints[i + 1]],
              segment: i,
            })),
            getPath: (d) => d.path,
            getColor: [168, 19, 90, 140],
            getWidth: 2,
            widthUnits: "pixels",
            pickable: true,
            // One path per segment is the point: deck.gl hands back the
            // index of the datum that was clicked, which IS the segment
            // index the state reducer wants. Hit-testing a single
            // multi-segment path would not tell us which stretch was hit.
            onClick: (info: PickingInfo<{ path: LonLat[]; segment: number }>): boolean => {
              if (info.index >= 0 && info.coordinate) {
                onEditorInsert(info.index, [info.coordinate[0], info.coordinate[1]]);
                return true;
              }
              return false;
            },
          })
        : null;

    return [
      ...(arcsLayer !== null ? [arcsLayer] : []),
      ...(arrowsLayer !== null ? [arrowsLayer] : []),
      ...(portsLayers ?? []),
      ...(guideLayer !== null ? [guideLayer] : []),
    ];
  }, [cruise, geometryMap, zoom, editing, editorState, onEditorInsert]);

  const bboxPoints: Array<[number, number]> = useMemo(() => {
    const pts: Array<[number, number]> = [];
    if (cruise.departurePort) pts.push([cruise.departurePort.lon, cruise.departurePort.lat]);
    if (cruise.arrivalPort) pts.push([cruise.arrivalPort.lon, cruise.arrivalPort.lat]);
    for (const stop of cruise.stops) {
      if (stop.port) pts.push([stop.port.lon, stop.port.lat]);
    }
    if (geometry) {
      for (const feat of geometry.features) {
        for (const c of feat.geometry.coordinates) pts.push(c);
      }
    }
    return pts;
  }, [cruise.departurePort, cruise.arrivalPort, cruise.stops, geometry]);

  useEffect(() => {
    if (!mapLoaded || didFit.current) return;
    const bbox = computeBbox(bboxPoints);
    if (!bbox) return;
    const [west, south, east, north] = bbox;
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 40, duration: 0 }
    );
    didFit.current = true;
  }, [mapLoaded, bboxPoints]);

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-md border border-border">
      <MapGL
        ref={mapRef}
        reuseMaps
        initialViewState={INITIAL_VIEW}
        mapStyle={DARK_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
        onMove={(evt): void => {
          const nextZoom = Math.round(evt.viewState.zoom);
          setZoom((prev) => (prev === nextZoom ? prev : nextZoom));
        }}
      >
        {mapLoaded && (
          <DeckGLOverlay layers={layers} getTooltip={getTooltip} onClick={handleMapClick} />
        )}
        {editing && editorState && (
          <RouteEditorOverlay
            state={editorState}
            onDragStart={onEditorDragStart}
            onDrag={onEditorDrag}
            onSelect={onEditorSelect}
            onRemove={onEditorRemove}
            onNudge={onEditorNudge}
            onUndo={onEditorUndo}
            nudgeStep={nudgeStep}
            // TODO(task 4): replace with t("cruise:routeEditor.removeHandle") once the i18n keys land.
            removeLabel="Punkt entfernen"
            // TODO(task 4): replace with t("cruise:routeEditor.handle", { index }) once the i18n keys land.
            handleLabel={(index): string => `Wegpunkt ${index + 1}`}
          />
        )}
      </MapGL>
    </div>
  );
}
