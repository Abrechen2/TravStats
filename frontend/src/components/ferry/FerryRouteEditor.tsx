import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import MapGL from "react-map-gl/maplibre";
import { PathLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { DeckGLOverlay } from "../map/DeckGLOverlay";
import { useBasemapStyle } from "../map/useBasemapStyle";
import { RouteEditorOverlay } from "../Cruise/RouteEditorOverlay";
import { BAR_BUTTON } from "../Cruise/RouteEditorActions";
import {
  initRouteEditor,
  insertWaypoint,
  isDirty,
  redo,
  removeWaypoint,
  beginDrag,
  dragWaypoint,
  nudgeWaypoint,
  selectWaypoint,
  simplifyForEditing,
  undo,
  type LonLat,
  type RouteEditorState,
} from "../Cruise/routeEditorState";
import { railBounds } from "../rail/RailRouteMap";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";
import { ferryApi } from "../../lib/api/ferry";
import { apiErrorMachineCode } from "../../lib/apiError";
import { reuseMapsEnabled } from "../../lib/mapReuse";
import type { FerryJourney } from "../../types/ferry";

/** The server error codes this editor has copy for; anything else gets the generic sentence. */
const KNOWN_ERRORS = new Set([
  "FERRY_ROUTE_INVALID",
  "FERRY_ROUTE_NOT_ANCHORED",
  "VERSION_CONFLICT",
]);

/** Degrees per arrow press — about 1 km; a tenth of that with Shift held. */
const NUDGE_STEP_DEG = 0.01;

/** The line the editor starts from: the stored one, else the chord between the terminals. */
export function editorStartLine(ride: FerryJourney): LonLat[] {
  const ends: LonLat[] = [
    [ride.depLon, ride.depLat],
    [ride.arrLon, ride.arrLat],
  ];
  const stored = ride.geometry;
  if (
    (ride.geometrySource === "manual" || ride.geometrySource === "sea_route") &&
    stored &&
    stored.length >= 3
  )
    return simplifyForEditing(stored.map(([lon, lat]) => [lon, lat] as LonLat));
  return ends;
}

interface Props {
  ride: FerryJourney;
  /** The saved crossing, as the server now holds it. */
  onSaved: (ride: FerryJourney) => void;
  onClose: () => void;
}

/**
 * Draw a crossing's route by hand (forgejo#431): the cruise leg editor's state
 * reducer and handles, on the crossing's own map. The terminals are the line's
 * fixed ends; click the line to add a via point, drag one to move it, remove it
 * with its ✕ or the Delete key. Saving sends the whole line; Cancel drops it.
 */
export function FerryRouteEditor({ ride, onSaved, onClose }: Props): JSX.Element {
  const mapStyle = useBasemapStyle();
  const { t } = useTranslation(["ferry", "common"]);
  const { colorOf } = useDomainColors();
  const { confirm: askConfirm, confirmDialog } = useConfirmDialog();
  const [mapLoaded, setMapLoaded] = useState(false);
  const [state, setState] = useState<RouteEditorState>(() =>
    initRouteEditor(editorStartLine(ride))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, g, b] = useMemo(() => hexToRgb(colorOf("ferry")), [colorOf]);

  const insert = useCallback((segment: number, at: LonLat): void => {
    setState((prev) => insertWaypoint(prev, segment, at));
  }, []);
  const layers = useMemo<Layer[]>(
    () => [
      new PathLayer<{ path: LonLat[]; segment: number }>({
        id: "ferry-route-editor-line",
        // One path per segment: the picked datum's index is the segment index
        // `insertWaypoint` wants.
        data: state.waypoints
          .slice(0, -1)
          .map((p, i) => ({ path: [p, state.waypoints[i + 1]], segment: i })),
        getPath: (d) => d.path,
        getColor: [r, g, b, 230],
        getWidth: 4,
        widthUnits: "pixels",
        pickable: true,
        onClick: (info: PickingInfo<{ path: LonLat[]; segment: number }>): boolean => {
          if (info.index < 0 || !info.coordinate) return false;
          insert(info.index, [info.coordinate[0], info.coordinate[1]]);
          return true;
        },
      }),
    ],
    [state.waypoints, r, g, b, insert]
  );

  const close = async (): Promise<void> => {
    if (isDirty(state) && !(await askConfirm({ message: t("ferry:routeEditor.discardConfirm") })))
      return;
    onClose();
  };
  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await ferryApi.setManualRoute(ride.id, state.waypoints));
    } catch (err) {
      const code = apiErrorMachineCode(err);
      setError(
        code && KNOWN_ERRORS.has(code)
          ? t(`ferry:routeEditor.errors.${code}`)
          : t("ferry:routeEditor.failed")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="ferry-route-editor">
      <div
        className="relative h-80 w-full overflow-hidden rounded-md border border-[var(--color-border)]"
        data-testid="ferry-route-editor-map"
      >
        <MapGL
          reuseMaps={reuseMapsEnabled()}
          initialViewState={{
            bounds: railBounds(state.original.map(([lon, lat]) => [lon, lat])),
            fitBoundsOptions: { padding: 40 },
          }}
          mapStyle={mapStyle}
          style={{ position: "absolute", inset: "0" }}
          onLoad={(): void => setMapLoaded(true)}
        >
          {mapLoaded && <DeckGLOverlay layers={layers} />}
          <RouteEditorOverlay
            state={state}
            onDragStart={(i): void => setState((p) => beginDrag(p, i))}
            onDrag={(i, to): void => setState((p) => dragWaypoint(p, i, to))}
            onSelect={(i): void => setState((p) => selectWaypoint(p, i))}
            onRemove={(i): void => setState((p) => removeWaypoint(p, i))}
            onNudge={(i, dLon, dLat): void => setState((p) => nudgeWaypoint(p, i, dLon, dLat))}
            onUndo={(): void => setState((p) => undo(p))}
            onRedo={(): void => setState((p) => redo(p))}
            nudgeStep={NUDGE_STEP_DEG}
            removeLabel={t("ferry:routeEditor.removePoint")}
            handleLabel={(i): string =>
              i === 0 || i === state.waypoints.length - 1
                ? t("ferry:routeEditor.terminal", { index: i === 0 ? 1 : 2 })
                : t("ferry:routeEditor.point", { index: i })
            }
          />
        </MapGL>
      </div>
      <p className="t-caption">{t("ferry:routeEditor.hint")}</p>
      {error && (
        <p role="alert" className="text-sm text-(--danger)" data-testid="ferry-route-editor-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BAR_BUTTON}
          disabled={state.history.length === 0}
          onClick={(): void => setState((p) => undo(p))}
        >
          {t("ferry:routeEditor.undo")}
        </button>
        <button
          type="button"
          className={BAR_BUTTON}
          disabled={state.future.length === 0}
          onClick={(): void => setState((p) => redo(p))}
        >
          {t("ferry:routeEditor.redo")}
        </button>
        <button
          type="button"
          className={BAR_BUTTON}
          data-testid="ferry-route-editor-save"
          disabled={!isDirty(state) || state.waypoints.length < 3 || saving}
          onClick={(): void => void save()}
        >
          {t(saving ? "ferry:routeEditor.saving" : "ferry:routeEditor.save")}
        </button>
        <button type="button" className={BAR_BUTTON} onClick={(): void => void close()}>
          {t("ferry:routeEditor.cancel")}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}

function hexToRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [37, 99, 235];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
