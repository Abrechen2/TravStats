import { Marker } from "react-map-gl/maplibre";
import type { JSX } from "react";
import type { LonLat, RouteEditorState } from "./routeEditorState";
import { isEndpoint } from "./routeEditorState";

interface Props {
  state: RouteEditorState;
  onMove: (index: number, to: LonLat) => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onNudge: (index: number, dLon: number, dLat: number) => void;
  onUndo: () => void;
  /** Degrees moved per arrow press; a tenth of that with Shift held. */
  nudgeStep: number;
  removeLabel: string;
  handleLabel: (index: number) => string;
}

/**
 * The handles of the leg being edited. Deliberately plain react-map-gl
 * `<Marker draggable>` rather than a deck.gl layer — the same choice
 * LocationMiniMap made, and for the same reason: dragging a DOM node is
 * something the browser already does well.
 *
 * The guide line and the curve are NOT drawn here. They are deck.gl layers
 * owned by the map, because the curve has to be the very same layer that
 * renders the saved route — what the user drags must be what they get.
 */
export function RouteEditorOverlay({
  state,
  onMove,
  onSelect,
  onRemove,
  onNudge,
  onUndo,
  nudgeStep,
  removeLabel,
  handleLabel,
}: Props): JSX.Element {
  return (
    <>
      {state.waypoints.map((point, index) => {
        const endpoint = isEndpoint(state, index);
        const selected = state.selected === index;
        return (
          <Marker
            key={`${index}-${point[0]}-${point[1]}`}
            longitude={point[0]}
            latitude={point[1]}
            draggable={!endpoint}
            onDragEnd={(e): void => onMove(index, [e.lngLat.lng, e.lngLat.lat])}
          >
            <div className="relative">
              <button
                type="button"
                aria-label={handleLabel(index)}
                onClick={(): void => onSelect(index)}
                onKeyDown={(e): void => {
                  // Ctrl+Z is checked FIRST and unconditionally — undo is a
                  // session-wide action, not a per-handle one, so it must
                  // still fire when an (unfocusable-for-drag but still
                  // Tab-reachable) endpoint handle has focus.
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                    e.preventDefault();
                    onUndo();
                    return;
                  }
                  // The spec requires this editor to be usable without a
                  // mouse. Endpoint protection lives in the reducer, so these
                  // handlers can call through without re-checking it — this
                  // early return only guards against firing a call the
                  // reducer would reject anyway.
                  if (endpoint) return;
                  const step = e.shiftKey ? nudgeStep / 10 : nudgeStep;
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    onNudge(index, -step, 0);
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    onNudge(index, step, 0);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    onNudge(index, 0, step);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    onNudge(index, 0, -step);
                  } else if (e.key === "Delete" || e.key === "Backspace") {
                    e.preventDefault();
                    onRemove(index);
                  }
                }}
                className={
                  endpoint
                    ? "h-3 w-3 cursor-not-allowed rounded-full border-2 border-(--accent) bg-(--accent)"
                    : selected
                      ? "h-4 w-4 cursor-grab rounded-full border-2 border-(--accent) bg-(--accent)"
                      : "h-4 w-4 cursor-grab rounded-full border-2 border-(--accent) bg-(--bg-base)"
                }
              />
              {selected && !endpoint && (
                <button
                  type="button"
                  aria-label={removeLabel}
                  onClick={(): void => onRemove(index)}
                  className="absolute -top-3 -right-3 h-5 w-5 rounded-full bg-(--accent) text-xs leading-none text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </Marker>
        );
      })}
    </>
  );
}
