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
import { RouteEditorOverlay } from "./RouteEditorOverlay";
import { MapContextMenu, type MapMenuEntry } from "./MapContextMenu";
import {
  beginDrag,
  dragWaypoint,
  initRouteEditor,
  clearSelection,
  insertWaypoint,
  isDirty,
  isEndpoint,
  nudgeWaypoint,
  redo,
  removeWaypoint,
  removeWaypoints,
  selectWaypointsIn,
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
  /** Handed the overlay so a right-click can ask deck WHAT is under the
   *  cursor. A context menu arrives as a DOM event, not a deck pick, so
   *  without this there is no way to name the leg the user aimed at. */
  onReady?: (overlay: MapboxOverlay) => void;
}

function DeckGLOverlay({ layers, getTooltip, onClick, onReady }: DeckOverlayProps): null {
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
  useEffect(() => {
    onReady?.(overlay);
  }, [overlay, onReady]);
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
  /**
   * Which gesture the left mouse button performs on empty map.
   *
   * A marquee and a map pan are the same gesture, so one of them has to be
   * chosen. The owner asked for mouse-only operation, which rules out "hold a
   * key to select" — hence a toolbar toggle rather than a modifier.
   */
  const [tool, setTool] = useState<"pan" | "select">("pan");
  /** Screen-space rectangle while dragging in select mode. Not editor state:
   *  it is pointer geometry, gone the moment the button comes up. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    title: string;
    entries: MapMenuEntry[];
  } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveError, setSaveError] = useState(false);

  /**
   * Opening the editor only changes what the map's container LOOKS like — it
   * does not move the map.
   *
   * The first version of this dialog rendered the map in a second place in the
   * tree (inside `Modal`), which is an unmount plus a mount: maplibre threw its
   * WebGL context away and deck.gl's overlay came up against the new one with
   * every layer failing to initialise ("deck.gl: assertion failed") — the
   * dialog opened onto a bare basemap with no route on it. Resetting the
   * "loaded" flag hid that in the dev server and did NOT hold in a production
   * build, which is how it reached an RC. So the map now stays exactly where it
   * is and its container is restyled to fill the screen. Nothing unmounts,
   * nothing re-initialises, and there is no flag to get wrong.
   *
   * The bounds fit is the one thing that must run again: it is computed for the
   * container size, and the container just changed by an order of magnitude.
   */
  const switchMapSurface = useCallback((toEditor: boolean): void => {
    didFit.current = false;
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

  /** Delete a whole selection in one step, one undo. */
  /** The map's own box, so a pointer position becomes a position IN the map. */
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<MapboxOverlay | null>(null);
  const keepDeck = useCallback((overlay: MapboxOverlay): void => {
    deckRef.current = overlay;
  }, []);

  const toBoxPoint = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const box = mapBoxRef.current?.getBoundingClientRect();
    if (!box) return null;
    return [clientX - box.left, clientY - box.top];
  }, []);

  /**
   * Which handle, if any, sits under a screen point.
   *
   * The handles are DOM markers rather than a deck layer, so deck's picking
   * cannot answer this — `document.elementFromPoint` can, and it answers with
   * what the user actually sees, overlaps included. That is also how this
   * project measured the invisible overlay that once ate every dialog click.
   */
  const handleIndexAt = useCallback((clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const marker = el?.closest<HTMLElement>("[data-waypoint-index]");
    if (!marker) return null;
    const index = Number(marker.dataset.waypointIndex);
    return Number.isFinite(index) ? index : null;
  }, []);

  /** Which leg's arc sits under a point already in map-box coordinates. */
  const legAtBox = useCallback(
    (x: number, y: number): { fromPortId: number; toPortId: number } | null => {
      const deck = deckRef.current;
      if (!deck) return null;
      const picked = deck.pickObject({ x, y, radius: 8, layerIds: ["cruise-arcs"] });
      const obj = picked?.object as { fromPortId?: number; toPortId?: number } | undefined;
      if (!obj || obj.fromPortId === undefined || obj.toPortId === undefined) return null;
      return { fromPortId: obj.fromPortId, toPortId: obj.toPortId };
    },
    []
  );

  /** Which leg's arc sits under a screen point, via deck's own picking. */
  const legAt = useCallback(
    (clientX: number, clientY: number): { fromPortId: number; toPortId: number } | null => {
      const point = toBoxPoint(clientX, clientY);
      return point ? legAtBox(point[0], point[1]) : null;
    },
    [toBoxPoint, legAtBox]
  );

  /**
   * Is this click aimed at a leg OTHER than the open one?
   *
   * The guide line sits on top of the whole map and deck gives it the click
   * first, so before this existed a click meant for a different leg was
   * swallowed and inserted a waypoint into the leg already open. Measured in a
   * browser: 20 of 20 handles unchanged plus one new, on a click 300 pixels
   * away from the open line. The fix to the root handler alone did nothing,
   * because the root handler never saw the click.
   */
  const clickBelongsToAnotherLeg = useCallback(
    (x: number, y: number): boolean => {
      if (!editing) return false;
      const under = legAtBox(x, y);
      if (!under) return false;
      return under.fromPortId !== editing.fromPortId || under.toPortId !== editing.toPortId;
    },
    [editing, legAtBox]
  );

  const onEditorRemoveSelected = useCallback((): void => {
    setEditorState((prev) => (prev ? removeWaypoints(prev, prev.selected) : prev));
  }, []);

  /** The budgeted Douglas-Peucker that entry already runs, offered as a
   *  command. It existed in the state module and had no button. */
  const onEditorSimplify = useCallback((): void => {
    setEditorState((prev) => {
      if (!prev) return prev;
      const simplified = simplifyForEditing(prev.waypoints);
      if (simplified.length === prev.waypoints.length) return prev;
      return {
        ...prev,
        waypoints: simplified,
        history: [...prev.history, prev.waypoints],
        future: [],
        selected: [],
      };
    });
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

  /** Open a leg, or switch to it, guarding whatever is unsaved. */
  const enterLeg = useCallback(
    (fromPortId: number, toPortId: number): void => {
      if (!geometry) return;
      if (editing && editing.fromPortId === fromPortId && editing.toPortId === toPortId) return;
      if (
        editorState &&
        isDirty(editorState) &&
        !window.confirm(t("cruise:routeEditor.discardConfirm"))
      ) {
        return;
      }
      const feature = geometry.features.find(
        (f) => f.properties.fromPortId === fromPortId && f.properties.toPortId === toPortId
      );
      if (!feature) return;
      setEditing({ fromPortId, toPortId });
      // A raw marnet leg can arrive with 178 waypoints — an unusable
      // caterpillar of handles (Nassau→Vancouver, owner decision 2026-08-21).
      // Simplify to the handle budget ON ENTRY; the stored route stays raw
      // unless the user actually edits, because an untouched simplified line
      // is the editor's `original` and therefore never dirty.
      setEditorState(initRouteEditor(simplifyForEditing(feature.geometry.coordinates)));
      setSaveError(false);
    },
    [geometry, editing, editorState, t]
  );

  /**
   * A left click on the map, with a leg open or without one.
   *
   * The rule this replaces was: while a leg is open, ignore the click. That did
   * not ignore it — the guide line's own handler took it and INSERTED a
   * waypoint, so a user reaching for a different leg silently edited the leg
   * they already had open. Reported 2026-08-29 as "you cannot select another
   * leg", which understated it.
   *
   * Now: a hit on ANOTHER leg switches to it; a hit on the open leg's own line
   * still inserts (that gesture is handled by the guide layer); a hit on
   * nothing clears the selection.
   */
  const handleMapClick = useCallback(
    (info: PickingInfo): void => {
      if (!editMode || !geometry) return;
      if (info.layer?.id !== "cruise-arcs") {
        if (editorState && editorState.selected.length > 0) {
          setEditorState(clearSelection(editorState));
        }
        return;
      }
      const clicked = info.object as { fromPortId: number; toPortId: number } | undefined;
      if (!clicked) return;
      enterLeg(clicked.fromPortId, clicked.toPortId);
    },
    [editMode, geometry, editorState, enterLeg]
  );

  /**
   * Leave the leg but stay in the editor.
   *
   * There was no such exit: Save returned to leg selection, and Cancel left
   * the editor entirely, so a user who opened the wrong leg had to leave and
   * come back. Named `closeLegOnly` to keep it apart from `closeEditor`.
   */
  const closeLegOnly = useCallback((): void => {
    setEditorState((prev) => {
      if (prev && isDirty(prev) && !window.confirm(t("cruise:routeEditor.discardConfirm"))) {
        return prev;
      }
      setEditing(null);
      setSaveError(false);
      return null;
    });
  }, [t]);

  /**
   * Right-click: a different menu for a handle, a leg, and empty water.
   *
   * The whole point of this menu is that the two commands with no mouse route
   * before it — switch to another leg, delete a selection — now have one.
   */
  const onMapContextMenu = useCallback(
    (event: React.MouseEvent): void => {
      if (!editMode) return;
      event.preventDefault();
      const { clientX, clientY } = event;

      const handleIndex = handleIndexAt(clientX, clientY);
      if (handleIndex !== null && editorState) {
        const many = editorState.selected.filter((i) => !isEndpoint(editorState, i));
        setMenu({
          x: clientX,
          y: clientY,
          title: t("cruise:routeEditor.handle", { index: handleIndex + 1 }),
          entries: [
            {
              label: t("cruise:routeEditor.menu.removeHandle"),
              disabled: isEndpoint(editorState, handleIndex),
              onSelect: () => onEditorRemove(handleIndex),
            },
            {
              label: t("cruise:routeEditor.menu.removeSelected", { count: many.length }),
              disabled: many.length < 2,
              onSelect: onEditorRemoveSelected,
            },
            { label: null },
            {
              label: t("cruise:routeEditor.menu.clearSelection"),
              disabled: editorState.selected.length === 0,
              onSelect: () => setEditorState((prev) => (prev ? clearSelection(prev) : prev)),
            },
          ],
        });
        return;
      }

      const leg = legAt(clientX, clientY);
      if (leg) {
        const isOpen =
          editing?.fromPortId === leg.fromPortId && editing?.toPortId === leg.toPortId;
        setMenu({
          x: clientX,
          y: clientY,
          title: isOpen
            ? t("cruise:routeEditor.menu.openLeg")
            : t("cruise:routeEditor.menu.otherLeg"),
          entries: isOpen
            ? [
                {
                  label: t("cruise:routeEditor.menu.simplify"),
                  disabled: !editorState || editorState.waypoints.length <= 3,
                  onSelect: onEditorSimplify,
                },
                { label: null },
                { label: t("cruise:routeEditor.menu.closeLeg"), onSelect: closeLegOnly },
              ]
            : [
                {
                  label: t("cruise:routeEditor.menu.editThisLeg"),
                  onSelect: () => enterLeg(leg.fromPortId, leg.toPortId),
                },
              ],
        });
        return;
      }

      setMenu({
        x: clientX,
        y: clientY,
        title: t("cruise:routeEditor.menu.map"),
        entries: [
          {
            label: t("cruise:routeEditor.menu.clearSelection"),
            disabled: !editorState || editorState.selected.length === 0,
            onSelect: () => setEditorState((prev) => (prev ? clearSelection(prev) : prev)),
          },
          {
            label: t("cruise:routeEditor.menu.closeLeg"),
            disabled: !editing,
            onSelect: closeLegOnly,
          },
        ],
      });
    },
    [
      editMode,
      editorState,
      editing,
      handleIndexAt,
      legAt,
      t,
      onEditorRemove,
      onEditorRemoveSelected,
      onEditorSimplify,
      enterLeg,
      closeLegOnly,
    ]
  );

  /** The marquee, in select mode only — in pan mode the drag is the map's. */
  const onMarqueeStart = useCallback(
    (event: React.PointerEvent): void => {
      if (!editMode || tool !== "select" || event.button !== 0) return;
      if (handleIndexAt(event.clientX, event.clientY) !== null) return;
      const point = toBoxPoint(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      setMarquee({ x0: point[0], y0: point[1], x1: point[0], y1: point[1] });
    },
    [editMode, tool, handleIndexAt, toBoxPoint]
  );

  const onMarqueeMove = useCallback(
    (event: React.PointerEvent): void => {
      if (!marquee) return;
      const point = toBoxPoint(event.clientX, event.clientY);
      if (!point) return;
      setMarquee((prev) => (prev ? { ...prev, x1: point[0], y1: point[1] } : prev));
    },
    [marquee, toBoxPoint]
  );

  /**
   * Release: turn the rectangle into a selection.
   *
   * The box is in SCREEN space and the waypoints are in lon/lat, so each
   * waypoint is projected rather than the box unprojected — a box unprojected
   * at low zoom is not a rectangle on the globe, and near the antimeridian it
   * is not even connected.
   */
  const onMarqueeEnd = useCallback((): void => {
    if (!marquee) return;
    const box = marquee;
    setMarquee(null);
    const map = mapRef.current?.getMap();
    if (!map || !editorState) return;
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    // A click, not a drag: treat it as "clear", not as a zero-size selection.
    if (right - left < 3 && bottom - top < 3) {
      setEditorState((prev) => (prev ? clearSelection(prev) : prev));
      return;
    }
    setEditorState((prev) =>
      prev
        ? selectWaypointsIn(prev, (point) => {
            const screen = map.project([point[0], point[1]]);
            return screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom;
          })
        : prev
    );
  }, [marquee, editorState]);


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

  /**
   * Esc leaves the editor without saving (spec §6.1), same path as Cancel, and
   * the page behind the editor must not scroll away under it.
   *
   * Both are what a dialog frame would normally provide. This editor cannot
   * use one: a frame owns its children's place in the tree, and moving the map
   * there is precisely what broke it. Exactly ONE listener — the same handler
   * bound twice would ask a dirty route's discard question twice on one key.
   */
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return (): void => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [editMode, onCancel]);

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
                // Defer when the user was aiming at a different leg: returning
                // false lets the pick fall through to the root handler, which
                // switches. Swallowing it here is what silently edited the
                // wrong leg.
                if (clickBelongsToAnotherLeg(info.x, info.y)) return false;
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
  }, [cruise, geometryMap, zoom, editing, editorState, onEditorInsert, clickBelongsToAnotherLeg]);

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
    // The container grew or shrank a frame ago; maplibre reads its own size
    // from a ResizeObserver, and the fit must not be computed against the old
    // one.
    mapRef.current?.getMap()?.resize();
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
  const mapPanel = (
    <div
      ref={mapBoxRef}
      className={`relative w-full overflow-hidden rounded-md border border-border ${
        editMode ? "min-h-0 flex-1" : "h-64"
      }`}
      onContextMenu={onMapContextMenu}
      onPointerDown={onMarqueeStart}
      onPointerMove={onMarqueeMove}
      onPointerUp={onMarqueeEnd}
    >
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
          <DeckGLOverlay
            layers={layers}
            getTooltip={getTooltip}
            onClick={handleMapClick}
            onReady={keepDeck}
          />
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
      {marquee && (
        <div
          data-testid="route-marquee"
          className="pointer-events-none absolute border border-(--accent) bg-(--accent)/15"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {menu && (
        <MapContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.title}
          entries={menu.entries}
          onClose={(): void => setMenu(null)}
        />
      )}
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
      {editMode && (
        <div className="flex" role="group" aria-label={t("cruise:routeEditor.tool")}>
          <button
            type="button"
            aria-pressed={tool === "pan"}
            className={`${barButton} rounded-r-none ${tool === "pan" ? "border-(--accent) text-(--accent)" : ""}`}
            onClick={(): void => setTool("pan")}
          >
            {t("cruise:routeEditor.toolPan")}
          </button>
          <button
            type="button"
            aria-pressed={tool === "select"}
            disabled={!editing}
            className={`${barButton} -ml-px rounded-l-none ${tool === "select" ? "border-(--accent) text-(--accent)" : ""}`}
            onClick={(): void => setTool("select")}
          >
            {t("cruise:routeEditor.toolSelect")}
          </button>
        </div>
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
            disabled={editorState.waypoints.length <= 3}
            onClick={onEditorSimplify}
          >
            {t("cruise:routeEditor.simplify")}
          </button>
          <button
            type="button"
            className={barButton}
            disabled={editorState.selected.filter((i) => !isEndpoint(editorState, i)).length === 0}
            onClick={onEditorRemoveSelected}
          >
            {t("cruise:routeEditor.removeSelected", {
              count: editorState.selected.filter((i) => !isEndpoint(editorState, i)).length,
            })}
          </button>
          <button
            type="button"
            className={barButton}
            disabled={!isDirty(editorState)}
            onClick={(): void => void onSave()}
          >
            {t("cruise:routeEditor.save")}
          </button>
          <button type="button" className={barButton} onClick={closeLegOnly}>
            {t("cruise:routeEditor.closeLeg")}
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
        <button type="button" className={barButton} onClick={(): void => switchMapSurface(true)}>
          {t("cruise:routeEditor.edit")}
        </button>
        {editedLegKeys.size > 0 && (
          <span className="text-xs text-(--text-muted)">{t("cruise:routeEditor.editedBadge")}</span>
        )}
        {saveError && !editMode && (
          <span className="text-sm text-(--danger)">{t("cruise:routeEditor.saveFailed")}</span>
        )}
      </div>

      {/*
        ONE container, two appearances. In the page it is a preview card; in
        edit mode the very same element becomes the full-screen editor. The map
        below it never changes its place in the tree — see `switchMapSurface`
        for what moving it cost.

        A leg is a hairline with a five-pixel pick radius: picking one out of
        the 410x254 preview took three clicks in the browser, two of which
        landed 13 and 20 pixels off the line and did nothing at all. That is
        why "Route bearbeiten" read as a button that does nothing.
      */}
      <div
        className={editMode ? "fixed inset-0 z-50 bg-black/70 p-4" : undefined}
        {...(editMode
          ? {
              role: "dialog" as const,
              "aria-modal": true,
              "aria-label": t("cruise:routeEditor.edit"),
            }
          : {})}
      >
        {/* The panel is ALWAYS rendered, and so are the slots inside it. A
            conditional sibling that appears BEFORE the map would shift the
            map's position among its siblings, and React reconciles children by
            position — which is the remount this whole design exists to avoid.
            `{cond && …}` keeps the slot occupied by `false`. */}
        <div
          className={
            editMode
              ? "flex h-full w-full flex-col gap-3 rounded-lg border border-border bg-(--bg-surface) p-4"
              : undefined
          }
        >
          {editMode && (
            <div className="flex shrink-0 items-center justify-between">
              <strong className="text-(--text-primary)">{t("cruise:routeEditor.edit")}</strong>
              <button
                type="button"
                className={barButton}
                onClick={onCancel}
                aria-label={t("cruise:routeEditor.cancel")}
              >
                ✕
              </button>
            </div>
          )}
          {mapPanel}
          {editMode && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{editorActions}</div>
          )}
        </div>
      </div>
    </div>
  );
}
