import { Marker } from "react-map-gl/maplibre";
import type { JSX } from "react";
import type { LonLat, RouteEditorState } from "./routeEditorState";
import { isEndpoint } from "./routeEditorState";

interface Props {
  state: RouteEditorState;
  /** Fired once when a handle's drag begins — the gesture's one undo point. */
  onDragStart: (index: number) => void;
  /** Fired continuously while dragging AND once more on release. */
  onDrag: (index: number, to: LonLat) => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onNudge: (index: number, dLon: number, dLat: number) => void;
  onUndo: () => void;
  onRedo: () => void;
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
  onDragStart,
  onDrag,
  onSelect,
  onRemove,
  onNudge,
  onUndo,
  onRedo,
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
            // The index alone — a key that carried the coordinates would
            // remount the marker on every move and throw away keyboard
            // focus, killing the arrow keys after their first press
            // (measured in the browser, not hypothetical).
            key={index}
            longitude={point[0]}
            latitude={point[1]}
            draggable={!endpoint}
            onDragStart={(): void => onDragStart(index)}
            onDrag={(e): void => onDrag(index, [e.lngLat.lng, e.lngLat.lat])}
            onDragEnd={(e): void => onDrag(index, [e.lngLat.lng, e.lngLat.lat])}
          >
            <div className="group relative">
              <button
                type="button"
                aria-label={handleLabel(index)}
                onClick={(): void => onSelect(index)}
                onKeyDown={(e): void => {
                  // Ctrl+Z / Ctrl+Y are checked FIRST and unconditionally —
                  // undo and redo are session-wide actions, not per-handle
                  // ones, so they must still fire when an
                  // (unfocusable-for-drag but still Tab-reachable) endpoint
                  // handle has focus.
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                    e.preventDefault();
                    onUndo();
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
                    e.preventDefault();
                    onRedo();
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
              {/* Spec §6.1: the ✕ appears on HOVER (review finding M1 — it
                  was select-only first). It stays in the DOM for every
                  removable handle and is revealed by CSS, so a mouse user
                  skips the select click; a selected handle keeps it visible
                  for keyboard users. pointer-events gate along with opacity —
                  an invisible button must not swallow the handle's clicks. */}
              {!endpoint && (
                <button
                  type="button"
                  aria-label={removeLabel}
                  onClick={(): void => onRemove(index)}
                  className={
                    "absolute -top-3 -right-3 h-5 w-5 rounded-full bg-(--accent) text-xs leading-none text-white" +
                    (selected
                      ? ""
                      : " pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100")
                  }
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
