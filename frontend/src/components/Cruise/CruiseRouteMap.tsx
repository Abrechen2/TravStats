import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import { createMarkerTooltip } from "../map/markerTooltip";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { Cruise } from "../../types";
import {
  cruiseApi,
  type CruiseRouteFeatureCollection,
  type RouteOverrideKey,
} from "../../lib/api/cruise";
import { createCruiseArcsLayer, createCruiseArrowsLayer } from "../layers/cruiseArcsLayer";
import { createCruisePortsLayer } from "../layers/cruisePortsLayer";
import { DEFAULT_CRUISE_COLORS, type CruiseColorConfig } from "../../lib/cruiseColor";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import { RouteEditorOverlay } from "./RouteEditorOverlay";
import {
  beginDrag,
  dragWaypoint,
  initRouteEditor,
  insertWaypoint,
  isDirty,
  isEndpoint,
  nudgeWaypoint,
  redo,
  removeWaypoint,
  selectWaypoint,
  simplifyForEditing,
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
  // Both namespaces: the tooltip machinery speaks "map", the route editor's
  // strings live in "cruise" beside the rest of this feature's wording.
  const { t, i18n } = useTranslation(["map", "cruise"]);
  const locale = i18n.language || "de";
  const getTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const mapRef = useRef<MapRef | null>(null);
  const [geometry, setGeometry] = useState<CruiseRouteFeatureCollection | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [zoom, setZoom] = useState<number>(INITIAL_VIEW.zoom ?? 3);
  const didFit = useRef(false);
  const [editing, setEditing] = useState<EditingLeg | null>(null);
  const [editorState, setEditorState] = useState<RouteEditorState | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveError, setSaveError] = useState(false);

  /**
   * Moving the map between the page card and the editor dialog throws the old
   * maplibre instance away and builds a new one, so BOTH flags that describe
   * "the map on screen" have to be reset with it — in the same batch as the
   * switch, not in an effect afterwards.
   *
   * `mapLoaded` is the one that bites: it gates the deck.gl overlay. Left
   * true from the previous instance, the overlay attaches to a map that has
   * not loaded its style yet, every layer fails to initialise with
   * "deck.gl: assertion failed", and the dialog shows a bare basemap with no
   * route on it. `didFit` is the harmless one: a fit computed for a 410x254
   * thumbnail means nothing on a canvas ten times its area.
   */
  const switchMapSurface = useCallback((toEditor: boolean): void => {
    didFit.current = false;
    setMapLoaded(false);
    setEditMode(toEditor);
  }, []);

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
        f.properties.fromPortId === editing.fromPortId && f.properties.toPortId === editing.toPortId
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

  const onEditorRedo = useCallback((): void => {
    setEditorState((prev) => (prev ? redo(prev) : prev));
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
  }, [editing, mapLoaded]);

  /**
   * Entering the editor: while edit mode is armed and no leg is under edit
   * yet, a click on a leg opens it. The `cruise-arcs` PathLayer is always
   * pickable (see createCruiseArcsLayer) but is not given its own onClick
   * here, so a hit on it falls through to this deck-level handler — see the
   * comment on DeckOverlayProps.onClick above for why that is safe to rely
   * on alongside the guide line's own onClick.
   */
  const handleMapClick = useCallback(
    (info: PickingInfo): void => {
      if (!editMode || editing || !geometry) return;
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
      // A raw marnet leg can arrive with 178 waypoints — an unusable
      // caterpillar of handles (Nassau→Vancouver, owner decision 2026-08-21).
      // Simplify to the handle budget ON ENTRY; the stored route stays raw
      // unless the user actually edits, because an untouched simplified line
      // is the editor's `original` and therefore never dirty.
      setEditorState(initRouteEditor(simplifyForEditing(feature.geometry.coordinates)));
    },
    [editMode, editing, geometry]
  );

  /** Legs the server says carry a hand-drawn line. Drives the badge and
   *  whether "back to automatic" is offered at all — there is nothing to
   *  reset on a leg the router still owns. */
  const editedLegKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const f of geometry?.features ?? []) {
      if (f.properties.method === "manual_polyline") {
        keys.add(`${f.properties.fromPortId}:${f.properties.toPortId}`);
      }
    }
    return keys;
  }, [geometry]);

  const legKey = (leg: EditingLeg): RouteOverrideKey => ({
    fromKind: "port",
    fromRef: String(leg.fromPortId),
    toKind: "port",
    toRef: String(leg.toPortId),
  });

  const refetchGeometry = async (): Promise<void> => {
    // Re-read rather than trusting the local line: what the map shows after a
    // save must be what the server stored, not what the client hoped it did.
    setGeometry(await cruiseApi.getGeometry(cruise.id));
  };

  const closeEditor = (): void => {
    setEditing(null);
    setEditorState(null);
    setSaveError(false);
  };

  const onSave = async (): Promise<void> => {
    if (!editing || !editorState) return;
    try {
      await cruiseApi.saveRouteOverride(cruise.id, legKey(editing), editorState.waypoints);
      await refetchGeometry();
      closeEditor();
      switchMapSurface(false);
    } catch (err) {
      // Keep the editor open and the user's line intact. Discarding someone's
      // work because a request failed is the one thing this must never do.
      logger.warn("CruiseRouteMap: saving the route override failed", err);
      setSaveError(true);
    }
  };

  const onReset = async (): Promise<void> => {
    if (!editing) return;
    try {
      await cruiseApi.clearRouteOverride(cruise.id, legKey(editing));
      await refetchGeometry();
      closeEditor();
      switchMapSurface(false);
    } catch (err) {
      logger.warn("CruiseRouteMap: clearing the route override failed", err);
      setSaveError(true);
    }
  };

  /** The one exit from edit mode — dirty work is challenged, never dropped. */
  const onCancel = useCallback((): void => {
    if (
      editorState &&
      isDirty(editorState) &&
      !window.confirm(t("cruise:routeEditor.discardConfirm"))
    ) {
      return;
    }
    setEditing(null);
    setEditorState(null);
    setSaveError(false);
    switchMapSurface(false);
  }, [editorState, t, switchMapSurface]);

  // Esc still leaves the editor without saving (spec §6.1) — the dialog frame
  // owns that key now and routes it to `onClose`, which is `onCancel`. A
  // second listener here would run the same handler twice on ONE keypress,
  // and with a dirty route that means asking the discard question twice.

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
    // Detail map for ONE cruise, possibly still just booked — it must show
    // every stop as a pin regardless of status (Finding 1 of the
    // status-blind-counts review: the default "visits" scope drops every
    // stop for a scheduled/in-progress/cancelled cruise and the layer
    // returns null, leaving the itinerary preview blank).
    const portsLayers = createCruisePortsLayer([cruise], zoom, { scope: "itinerary" });

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
  }, [mapLoaded, bboxPoints, editMode]);

  const barButton =
    "rounded-md border border-border px-2 py-1 text-xs text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50";

  /**
   * The map itself, rendered EITHER in the page card as a preview OR inside
   * the editor dialog — never both at once. Two `<MapGL>` mounts mean two
   * WebGL contexts for one route, and the browser drops old contexts without
   * warning when it runs out.
   */
  const renderMap = (heightClass: string): JSX.Element => (
    <div className={`relative ${heightClass} w-full overflow-hidden rounded-md border border-border`}>
      <MapGL
        reuseMaps
        ref={mapRef}
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
            onRedo={onEditorRedo}
            nudgeStep={nudgeStep}
            removeLabel={t("cruise:routeEditor.removeHandle")}
            handleLabel={(index): string =>
              isEndpoint(editorState, index)
                ? t("cruise:routeEditor.endpoint")
                : t("cruise:routeEditor.handle", { index: index + 1 })
            }
          />
        )}
      </MapGL>
    </div>
  );

  /** The dialog's action row: what can be done to the leg under the cursor. */
  const editorActions = (
    <>
      {!editing && (
        <span className="mr-auto text-sm text-(--text-muted)">
          {t("cruise:routeEditor.pickLeg")}
        </span>
      )}
      {saveError && (
        <span className="mr-auto text-sm text-(--danger)">
          {t("cruise:routeEditor.saveFailed")}
        </span>
      )}
      {editing && editorState && (
        <>
          <button
            type="button"
            className={barButton}
            disabled={editorState.history.length === 0}
            onClick={onEditorUndo}
          >
            {t("cruise:routeEditor.undo")}
          </button>
          <button
            type="button"
            className={barButton}
            disabled={editorState.future.length === 0}
            onClick={onEditorRedo}
          >
            {t("cruise:routeEditor.redo")}
          </button>
          {editedLegKeys.has(`${editing.fromPortId}:${editing.toPortId}`) && (
            <button type="button" className={barButton} onClick={(): void => void onReset()}>
              {t("cruise:routeEditor.reset")}
            </button>
          )}
          <button
            type="button"
            className={barButton}
            disabled={!isDirty(editorState)}
            onClick={(): void => void onSave()}
          >
            {t("cruise:routeEditor.save")}
          </button>
        </>
      )}
      <button type="button" className={barButton} onClick={onCancel}>
        {t("cruise:routeEditor.cancel")}
      </button>
    </>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={barButton}
          onClick={(): void => switchMapSurface(true)}
        >
          {t("cruise:routeEditor.edit")}
        </button>
        {editedLegKeys.size > 0 && (
          <span className="text-xs text-(--text-muted)">{t("cruise:routeEditor.editedBadge")}</span>
        )}
        {saveError && !editMode && (
          <span className="text-sm text-(--danger)">{t("cruise:routeEditor.saveFailed")}</span>
        )}
      </div>
      {/* The card keeps the preview; the editor gets a dialog-sized canvas.
          A leg is a hairline: picking one out of a 410x254 thumbnail took
          three tries in the browser, which is why "Route bearbeiten" read as
          a button that does nothing. */}
      {!editMode && renderMap("h-64")}
      <Modal
        open={editMode}
        onClose={onCancel}
        title={t("cruise:routeEditor.edit")}
        widthClass="max-w-6xl"
        footer={editorActions}
        testId="cruise-route-editor"
      >
        {renderMap("h-[70vh]")}
      </Modal>
    </div>
  );
}
