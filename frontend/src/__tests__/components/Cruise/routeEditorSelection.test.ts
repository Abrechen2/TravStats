import { describe, expect, it } from "vitest";
import {
  initRouteEditor,
  selectWaypoint,
  selectWaypointsIn,
  clearSelection,
  removeWaypoints,
  isEndpoint,
  type LonLat,
} from "../../../components/Cruise/routeEditorState";

/**
 * Selection became a SET rather than one index.
 *
 * The owner asked for a marquee that deletes several waypoints at once, and the
 * old shape (`selected: number | null`) could not express it — this is the
 * change everything else in that rework hangs off. Endpoint protection has to
 * survive the widening: a rectangle dragged over the whole leg contains the two
 * ports as surely as it contains the handles, and they are not the user's to
 * delete.
 */
const LINE: LonLat[] = [
  [0, 0], // port
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4], // port
];

describe("selection", () => {
  it("starts empty", () => {
    expect(initRouteEditor(LINE).selected).toEqual([]);
  });

  it("selects one handle, replacing what was selected before", () => {
    const s = selectWaypoint(initRouteEditor(LINE), 2);
    expect(s.selected).toEqual([2]);
    expect(selectWaypoint(s, 3).selected).toEqual([3]);
  });

  it("refuses to select a port", () => {
    // A port is where the leg begins and ends. Selecting it would offer a
    // delete that must never happen.
    const s = initRouteEditor(LINE);
    expect(selectWaypoint(s, 0).selected).toEqual([]);
    expect(selectWaypoint(s, 4).selected).toEqual([]);
  });

  it("selects everything inside a rectangle", () => {
    const s = selectWaypointsIn(
      initRouteEditor(LINE),
      ([lon, lat]) => lon >= 1 && lon <= 3 && lat >= 1 && lat <= 3
    );
    expect(s.selected).toEqual([1, 2, 3]);
  });

  it("leaves the ports out of a rectangle that covers them", () => {
    // The decisive case: drag a box over the entire leg.
    const s = selectWaypointsIn(initRouteEditor(LINE), () => true);
    expect(s.selected).toEqual([1, 2, 3]);
    expect(s.selected.some((i) => isEndpoint(s, i))).toBe(false);
  });

  it("clears", () => {
    const s = selectWaypointsIn(initRouteEditor(LINE), () => true);
    expect(clearSelection(s).selected).toEqual([]);
  });
});

describe("removeWaypoints", () => {
  it("deletes several at once and leaves the line in order", () => {
    const s = removeWaypoints(initRouteEditor(LINE), [1, 3]);
    expect(s.waypoints).toEqual([
      [0, 0],
      [2, 2],
      [4, 4],
    ]);
  });

  it("deletes back to front regardless of the order it is given", () => {
    // Deleting front to back shifts every later index by one — the classic way
    // a bulk delete removes the wrong points. The order of the argument must
    // not matter.
    const a = removeWaypoints(initRouteEditor(LINE), [1, 2, 3]);
    const b = removeWaypoints(initRouteEditor(LINE), [3, 1, 2]);
    expect(a.waypoints).toEqual([
      [0, 0],
      [4, 4],
    ]);
    expect(b.waypoints).toEqual(a.waypoints);
  });

  it("never deletes a port, even when asked", () => {
    const s = removeWaypoints(initRouteEditor(LINE), [0, 2, 4]);
    expect(s.waypoints).toEqual([
      [0, 0],
      [1, 1],
      [3, 3],
      [4, 4],
    ]);
  });

  it("is one undo step, not one per waypoint", () => {
    // A marquee delete is a single decision and has to be a single undo.
    const s = removeWaypoints(initRouteEditor(LINE), [1, 2, 3]);
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toEqual(LINE);
  });

  it("does nothing at all when only ports were asked for", () => {
    const before = initRouteEditor(LINE);
    const after = removeWaypoints(before, [0, 4]);
    expect(after.waypoints).toEqual(LINE);
    expect(after.history).toHaveLength(0);
  });

  it("empties the selection, because the indices it named are gone", () => {
    const picked = selectWaypointsIn(initRouteEditor(LINE), () => true);
    expect(removeWaypoints(picked, picked.selected).selected).toEqual([]);
  });
});
