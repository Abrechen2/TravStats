import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The overlay renders react-map-gl Markers; outside a real map they become
// plain wrappers so the handle buttons underneath stay testable.
vi.mock("react-map-gl/maplibre", () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import { RouteEditorOverlay } from "../../../components/Cruise/RouteEditorOverlay";
import { initRouteEditor, type LonLat } from "../../../components/Cruise/routeEditorState";

const line: LonLat[] = [
  [0, 0],
  [1, 1],
  [2, 0],
  [3, 1],
];

const noop = (): void => {};

function renderOverlay(selected: number[] = []): { onRemove: ReturnType<typeof vi.fn> } {
  const onRemove = vi.fn();
  const state = { ...initRouteEditor(line), selected };
  render(
    <RouteEditorOverlay
      state={state}
      onDragStart={noop}
      onDrag={noop}
      onSelect={noop}
      onRemove={onRemove}
      onNudge={noop}
      onUndo={noop}
      onRedo={noop}
      nudgeStep={0.05}
      removeLabel="remove"
      handleLabel={(i) => `handle ${i}`}
    />
  );
  return { onRemove };
}

/**
 * Spec §6.1: the ✕ appears on HOVER, not only after selecting the handle
 * (review finding M1 — built as select-only first). The button is in the DOM
 * for every removable handle and revealed by CSS on hover or selection, so a
 * mouse user never needs the extra select click.
 */
describe("RouteEditorOverlay — remove button reveal", () => {
  it("renders a remove button for every non-endpoint handle, selected or not", () => {
    renderOverlay([]);
    // 4 points, 2 protected endpoints → 2 removable handles.
    expect(screen.getAllByLabelText("remove")).toHaveLength(2);
  });

  it("renders no remove button for the endpoints", () => {
    renderOverlay([]);
    expect(screen.getAllByLabelText(/^handle/)).toHaveLength(4);
    expect(screen.getAllByLabelText("remove")).toHaveLength(2);
  });

  it("reveals via CSS hover: unselected buttons are hidden-until-hover, a selected one is visible", () => {
    renderOverlay([2]);
    const buttons = screen.getAllByLabelText("remove");
    const hidden = buttons.filter((b) => b.className.includes("group-hover"));
    const alwaysVisible = buttons.filter((b) => !b.className.includes("group-hover"));
    expect(hidden).toHaveLength(1);
    expect(alwaysVisible).toHaveLength(1);
  });

  it("clicking the revealed button removes that waypoint", () => {
    const { onRemove } = renderOverlay([]);
    fireEvent.click(screen.getAllByLabelText("remove")[0]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});

/**
 * Ctrl+Shift+Z is redo on Windows and Linux, and this editor undid instead.
 *
 * Measured in a browser on 2026-08-29 with both directions available, so the
 * outcome could not be mistaken for "nothing left to undo": undo became
 * unavailable and redo stayed, which is undo running twice.
 */
describe("RouteEditorOverlay — undo and redo shortcuts", () => {
  function keys(): { onUndo: ReturnType<typeof vi.fn>; onRedo: ReturnType<typeof vi.fn> } {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <RouteEditorOverlay
        state={{ ...initRouteEditor(line), selected: [] }}
        onDragStart={noop}
        onDrag={noop}
        onSelect={noop}
        onRemove={noop}
        onNudge={noop}
        onUndo={onUndo}
        onRedo={onRedo}
        nudgeStep={0.05}
        removeLabel="entfernen"
        handleLabel={(i): string => `Griff ${i + 1}`}
      />
    );
    return { onUndo, onRedo };
  }

  it("redoes on Ctrl+Shift+Z, and does not undo", () => {
    const { onUndo, onRedo } = keys();
    fireEvent.keyDown(screen.getByLabelText("Griff 2"), { key: "z", ctrlKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("still undoes on plain Ctrl+Z", () => {
    const { onUndo, onRedo } = keys();
    fireEvent.keyDown(screen.getByLabelText("Griff 2"), { key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("redoes on Ctrl+Y as before", () => {
    const { onUndo, onRedo } = keys();
    fireEvent.keyDown(screen.getByLabelText("Griff 2"), { key: "y", ctrlKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });
});
