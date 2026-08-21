import { describe, expect, it } from "vitest";
import {
  beginDrag,
  dragWaypoint,
  initRouteEditor,
  insertWaypoint,
  isDirty,
  isEndpoint,
  moveWaypoint,
  nudgeWaypoint,
  redo,
  removeWaypoint,
  selectWaypoint,
  undo,
  type LonLat,
} from "../../../components/Cruise/routeEditorState";

const LINE: LonLat[] = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
];

describe("routeEditorState", () => {
  it("starts clean, with nothing selected", () => {
    const s = initRouteEditor(LINE);
    expect(isDirty(s)).toBe(false);
    expect(s.selected).toBeNull();
    expect(s.waypoints).toEqual(LINE);
  });

  it("treats the first and last points as endpoints", () => {
    const s = initRouteEditor(LINE);
    expect(isEndpoint(s, 0)).toBe(true);
    expect(isEndpoint(s, 3)).toBe(true);
    expect(isEndpoint(s, 1)).toBe(false);
    expect(isEndpoint(s, 2)).toBe(false);
  });

  it("refuses to move an endpoint", () => {
    const s = initRouteEditor(LINE);
    const after = moveWaypoint(s, 0, [9, 9]);
    // A leg begins and ends at its ports. The map must not offer this, and
    // the state must not perform it even if the map asks.
    expect(after.waypoints).toEqual(LINE);
    expect(isDirty(after)).toBe(false);
  });

  it("refuses to remove an endpoint", () => {
    const s = initRouteEditor(LINE);
    expect(removeWaypoint(s, 3).waypoints).toEqual(LINE);
  });

  it("moves an interior point and becomes dirty", () => {
    const s = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    expect(s.waypoints[1]).toEqual([5, 5]);
    expect(s.waypoints).toHaveLength(4);
    expect(isDirty(s)).toBe(true);
  });

  it("inserts into the clicked segment, not next to it", () => {
    // Segment 0 is the stretch between waypoint 0 and waypoint 1, so the new
    // point must land at index 1 and push the rest along. Off-by-one here is
    // the whole reason this function exists.
    const s = insertWaypoint(initRouteEditor(LINE), 0, [0.5, 0.5]);
    expect(s.waypoints).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("inserts into the last segment before the end point", () => {
    const s = insertWaypoint(initRouteEditor(LINE), 2, [2.5, 2.5]);
    expect(s.waypoints[3]).toEqual([2.5, 2.5]);
    expect(s.waypoints[4]).toEqual([3, 3]);
  });

  it("removes an interior point", () => {
    const s = removeWaypoint(initRouteEditor(LINE), 1);
    expect(s.waypoints).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
    expect(isDirty(s)).toBe(true);
  });

  it("clears the selection when the selected point is removed", () => {
    let s = selectWaypoint(initRouteEditor(LINE), 1);
    s = removeWaypoint(s, 1);
    expect(s.selected).toBeNull();
  });

  it("undoes a move exactly, and reports clean again", () => {
    const start = initRouteEditor(LINE);
    const moved = moveWaypoint(start, 1, [5, 5]);
    const back = undo(moved);
    expect(back.waypoints).toEqual(LINE);
    // Not merely "some earlier state" — the same line we began with, so the
    // save button must go quiet again.
    expect(isDirty(back)).toBe(false);
  });

  it("undoes step by step, not all the way at once", () => {
    let s = initRouteEditor(LINE);
    s = moveWaypoint(s, 1, [5, 5]);
    s = moveWaypoint(s, 2, [6, 6]);
    s = undo(s);
    expect(s.waypoints[1]).toEqual([5, 5]);
    expect(s.waypoints[2]).toEqual([2, 2]);
  });

  it("does nothing when there is nothing to undo", () => {
    const s = initRouteEditor(LINE);
    expect(undo(s)).toEqual(s);
  });

  it("never selects an endpoint", () => {
    const s = selectWaypoint(initRouteEditor(LINE), 0);
    expect(s.selected).toBeNull();
  });

  it("does not mutate the state it was given", () => {
    const s = initRouteEditor(LINE);
    const before = JSON.stringify(s);
    moveWaypoint(s, 1, [7, 7]);
    insertWaypoint(s, 0, [8, 8]);
    removeWaypoint(s, 1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("bounds the history so a long session cannot grow without limit", () => {
    let s = initRouteEditor(LINE);
    for (let i = 0; i < 200; i++) s = moveWaypoint(s, 1, [i, i]);
    expect(s.history.length).toBeLessThanOrEqual(50);
  });

  it("nudges an interior point by the given delta", () => {
    const s = nudgeWaypoint(initRouteEditor(LINE), 1, 0.5, -0.25);
    expect(s.waypoints[1]).toEqual([1.5, 0.75]);
    expect(isDirty(s)).toBe(true);
  });

  it("refuses to nudge an endpoint, exactly as dragging one is refused", () => {
    // The keyboard path must not be a way around a protection the mouse path
    // enforces.
    const s = initRouteEditor(LINE);
    expect(nudgeWaypoint(s, 0, 1, 1).waypoints).toEqual(LINE);
    expect(nudgeWaypoint(s, 3, 1, 1).waypoints).toEqual(LINE);
  });

  it("undoes a nudge like any other change", () => {
    const s = undo(nudgeWaypoint(initRouteEditor(LINE), 2, 1, 1));
    expect(s.waypoints).toEqual(LINE);
    expect(isDirty(s)).toBe(false);
  });

  it("records one history entry per drag gesture, not one per drag event", () => {
    // A live drag fires dozens of intermediate positions. Only beginDrag
    // remembers; the moves themselves must not, or a single gesture floods
    // the bounded history and undo stops meaning "one gesture back".
    let s = beginDrag(initRouteEditor(LINE), 1);
    expect(s.history).toHaveLength(1);
    expect(s.selected).toBe(1);
    s = dragWaypoint(s, 1, [1.1, 1.1]);
    s = dragWaypoint(s, 1, [1.5, 1.4]);
    s = dragWaypoint(s, 1, [2.2, 0.9]);
    expect(s.history).toHaveLength(1);
    expect(s.waypoints[1]).toEqual([2.2, 0.9]);
    expect(isDirty(s)).toBe(true);
  });

  it("undoes a whole drag gesture in one step, back to where it began", () => {
    let s = beginDrag(initRouteEditor(LINE), 2);
    s = dragWaypoint(s, 2, [5, 5]);
    s = dragWaypoint(s, 2, [6, 6]);
    const back = undo(s);
    expect(back.waypoints).toEqual(LINE);
    expect(isDirty(back)).toBe(false);
  });

  it("refuses to begin or continue a drag on an endpoint", () => {
    const s = initRouteEditor(LINE);
    expect(beginDrag(s, 0)).toEqual(s);
    expect(beginDrag(s, 3)).toEqual(s);
    expect(dragWaypoint(s, 0, [9, 9]).waypoints).toEqual(LINE);
    expect(dragWaypoint(s, 3, [9, 9]).waypoints).toEqual(LINE);
  });

  it("does not mutate the given state while dragging", () => {
    const s = beginDrag(initRouteEditor(LINE), 1);
    const before = JSON.stringify(s);
    dragWaypoint(s, 1, [7, 7]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("redoes what undo took back, step by step", () => {
    let s = initRouteEditor(LINE);
    s = moveWaypoint(s, 1, [5, 5]);
    s = moveWaypoint(s, 2, [6, 6]);
    s = undo(s);
    s = undo(s);
    expect(s.waypoints).toEqual(LINE);
    s = redo(s);
    expect(s.waypoints[1]).toEqual([5, 5]);
    expect(s.waypoints[2]).toEqual([2, 2]);
    s = redo(s);
    expect(s.waypoints[2]).toEqual([6, 6]);
    expect(isDirty(s)).toBe(true);
  });

  it("redo after undo restores dirty and clean states faithfully", () => {
    const moved = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    const back = undo(moved);
    expect(isDirty(back)).toBe(false);
    const again = redo(back);
    expect(again.waypoints[1]).toEqual([5, 5]);
    expect(isDirty(again)).toBe(true);
  });

  it("a new change discards the redo future", () => {
    // The universal editor convention: undo, then do something ELSE — the
    // abandoned branch is gone. A redo that resurrected it would splice a
    // stale line over the user's newer work.
    let s = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    s = undo(s);
    s = moveWaypoint(s, 2, [7, 7]);
    const after = redo(s);
    expect(after.waypoints).toEqual(s.waypoints);
  });

  it("a drag gesture also discards the redo future", () => {
    let s = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    s = undo(s);
    s = beginDrag(s, 2);
    s = dragWaypoint(s, 2, [8, 8]);
    const after = redo(s);
    expect(after.waypoints).toEqual(s.waypoints);
  });

  it("an insert also discards the redo future", () => {
    // Every mutating entry point must clear it, not just move — a redo that
    // resurrects the abandoned branch over an inserted point splices a stale
    // line over newer work.
    let s = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    s = undo(s);
    s = insertWaypoint(s, 0, [0.5, 0.5]);
    const after = redo(s);
    expect(after.waypoints).toEqual(s.waypoints);
  });

  it("a removal also discards the redo future", () => {
    let s = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    s = undo(s);
    s = removeWaypoint(s, 2);
    const after = redo(s);
    expect(after.waypoints).toEqual(s.waypoints);
  });

  it("does nothing when there is nothing to redo", () => {
    const s = initRouteEditor(LINE);
    // Identity, not just equality: a no-op that returned a fresh object
    // would re-render the whole overlay for nothing.
    expect(redo(s)).toBe(s);
  });

  it("survives an undo/redo/undo round trip", () => {
    const moved = moveWaypoint(initRouteEditor(LINE), 1, [5, 5]);
    const s = undo(redo(undo(moved)));
    expect(s.waypoints).toEqual(LINE);
    expect(isDirty(s)).toBe(false);
  });
});
