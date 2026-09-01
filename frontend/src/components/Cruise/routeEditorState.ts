/**
 * The route editor's state, with no React and no map in it.
 *
 * Everything that can be logically wrong about dragging a route lives here —
 * which index an inserted point lands at, whether the leg's endpoints are
 * protected, whether undo really restores — so it is all reachable by plain
 * unit tests rather than through a rendered map.
 *
 * Coordinates are [lon, lat], GeoJSON order, the same as the geometry
 * endpoint and the stored waypoints. `react-map-gl` speaks {lng, lat}; that
 * conversion belongs at the component boundary, never in here.
 */

export type LonLat = [number, number];

export interface RouteEditorState {
  waypoints: LonLat[];
  original: LonLat[];
  /**
   * The selected handles, ascending, never containing an endpoint.
   *
   * A SET rather than one index because a marquee selects many at once. The
   * endpoint rule has to hold here rather than at the delete: a rectangle
   * dragged over the whole leg contains the two ports as surely as it contains
   * the handles, and a port the user can select is a delete they will try.
   */
  selected: number[];
  history: LonLat[][];
  /** Lines undo took back, newest last — what redo restores. Any NEW
   *  change discards it: redoing an abandoned branch over newer work is
   *  the one thing redo must never do. */
  future: LonLat[][];
}

/** Enough to undo a session's worth of nudges without growing forever. */
const HISTORY_LIMIT = 50;

const clone = (points: LonLat[]): LonLat[] => points.map(([lon, lat]) => [lon, lat] as LonLat);

const sameLine = (a: LonLat[], b: LonLat[]): boolean =>
  a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/** Push the current line onto the history, keeping it bounded. */
const remember = (state: RouteEditorState): LonLat[][] => {
  const next = [...state.history, clone(state.waypoints)];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
};

/** Perpendicular distance from `p` to the segment `a`–`b`, in degrees.
 *  Planar approximation — fine for ranking which handle carries shape. */
const perpendicularDistance = (p: LonLat, a: LonLat, b: LonLat): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** How many handles an entered leg may present at most (owner decision
 *  2026-08-21 — a raw marnet leg arrived with 178). */
export const EDITOR_HANDLE_BUDGET = 25;

/**
 * Douglas-Peucker, budgeted: keep the endpoints plus the most
 * shape-carrying points until the budget is spent. Points come out in their
 * original order and are always members of the input — nothing is invented.
 *
 * Applied on EDITOR ENTRY only. The stored route stays raw until the user
 * actually edits and saves; an entered-but-untouched leg is not dirty, so
 * simplification alone never writes anything.
 */
export function simplifyForEditing(
  points: LonLat[],
  maxHandles: number = EDITOR_HANDLE_BUDGET
): LonLat[] {
  if (points.length <= maxHandles) return points;

  interface Segment {
    start: number;
    end: number;
    farthest: number;
    distance: number;
  }
  const measure = (start: number, end: number): Segment => {
    let farthest = -1;
    let distance = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    return { start, end, farthest, distance };
  };

  const keep = new Set<number>([0, points.length - 1]);
  const segments: Segment[] = [measure(0, points.length - 1)];
  while (keep.size < maxHandles) {
    let bestIdx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].farthest < 0) continue;
      if (bestIdx < 0 || segments[i].distance > segments[bestIdx].distance) bestIdx = i;
    }
    if (bestIdx < 0) break; // every remaining point is on a kept segment
    const seg = segments.splice(bestIdx, 1)[0];
    keep.add(seg.farthest);
    if (seg.farthest - seg.start > 1) segments.push(measure(seg.start, seg.farthest));
    if (seg.end - seg.farthest > 1) segments.push(measure(seg.farthest, seg.end));
  }

  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

export function initRouteEditor(waypoints: LonLat[]): RouteEditorState {
  return {
    waypoints: clone(waypoints),
    original: clone(waypoints),
    selected: [],
    history: [],
    future: [],
  };
}

/**
 * The first and last points are the leg's two places. A leg begins and ends
 * where it begins and ends; moving those would be re-routing, not correcting.
 */
export function isEndpoint(state: RouteEditorState, index: number): boolean {
  return index <= 0 || index >= state.waypoints.length - 1;
}

export function selectWaypoint(state: RouteEditorState, index: number | null): RouteEditorState {
  if (index === null || isEndpoint(state, index)) return { ...state, selected: [] };
  return { ...state, selected: [index] };
}

/** Everything the predicate accepts, ports excluded whatever it says. */
export function selectWaypointsIn(
  state: RouteEditorState,
  contains: (point: LonLat, index: number) => boolean
): RouteEditorState {
  const selected = state.waypoints.reduce<number[]>((acc, point, index) => {
    if (!isEndpoint(state, index) && contains(point, index)) acc.push(index);
    return acc;
  }, []);
  return { ...state, selected };
}

export function clearSelection(state: RouteEditorState): RouteEditorState {
  return state.selected.length === 0 ? state : { ...state, selected: [] };
}

export function moveWaypoint(state: RouteEditorState, index: number, to: LonLat): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints[index] = [to[0], to[1]];
  return { ...state, waypoints, history: remember(state), selected: [index], future: [] };
}

/**
 * The start of a drag gesture: remember the line once, select the handle.
 * A live drag then streams positions through `dragWaypoint`, which does NOT
 * remember — one gesture, one history entry, one undo step. `moveWaypoint`
 * stays the right call for single-shot changes (a keyboard nudge).
 */
export function beginDrag(state: RouteEditorState, index: number): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  return { ...state, history: remember(state), selected: [index], future: [] };
}

/** A drag in flight: move without remembering — `beginDrag` already did. */
export function dragWaypoint(state: RouteEditorState, index: number, to: LonLat): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints[index] = [to[0], to[1]];
  return { ...state, waypoints, selected: [index] };
}

/**
 * Insert into the segment the user clicked. Segment `i` is the stretch
 * between waypoint `i` and waypoint `i + 1`, so the new point lands at
 * `i + 1` — the off-by-one this function exists to get right once.
 */
export function insertWaypoint(
  state: RouteEditorState,
  segmentIndex: number,
  at: LonLat
): RouteEditorState {
  if (segmentIndex < 0 || segmentIndex >= state.waypoints.length - 1) return state;
  const waypoints = clone(state.waypoints);
  waypoints.splice(segmentIndex + 1, 0, [at[0], at[1]]);
  return {
    ...state,
    waypoints,
    history: remember(state),
    selected: [segmentIndex + 1],
    future: [],
  };
}

export function removeWaypoint(state: RouteEditorState, index: number): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints.splice(index, 1);
  return { ...state, waypoints, history: remember(state), selected: [], future: [] };
}

/**
 * Delete a whole selection in one step.
 *
 * Back to front, because deleting front to back shifts every later index by one
 * and takes out the wrong points -- so the caller's ordering must not matter.
 * One history entry, because a marquee delete is one decision and has to be one
 * undo. Ports are dropped from the request rather than refused: a rectangle
 * that happened to cover one should still delete the handles beside it.
 */
export function removeWaypoints(state: RouteEditorState, indices: number[]): RouteEditorState {
  const removable = [...new Set(indices)]
    .filter((index) => !isEndpoint(state, index))
    .sort((a, b) => b - a);
  if (removable.length === 0) return state;
  const waypoints = clone(state.waypoints);
  for (const index of removable) waypoints.splice(index, 1);
  return { ...state, waypoints, history: remember(state), selected: [], future: [] };
}

/**
 * Arrow-key movement. Goes through the same endpoint protection as dragging —
 * a keyboard path that skipped it would be a way around a rule the mouse path
 * enforces.
 */
export function nudgeWaypoint(
  state: RouteEditorState,
  index: number,
  dLon: number,
  dLat: number
): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const [lon, lat] = state.waypoints[index];
  return moveWaypoint(state, index, [lon + dLon, lat + dLat]);
}

export function undo(state: RouteEditorState): RouteEditorState {
  if (state.history.length === 0) return state;
  const history = [...state.history];
  const previous = history.pop() as LonLat[];
  const future = [...state.future, clone(state.waypoints)];
  return { ...state, waypoints: previous, history, future, selected: [] };
}

/** Restore what undo took back. Bounded by undo itself — the future can
 *  never outgrow the history that fed it. */
export function redo(state: RouteEditorState): RouteEditorState {
  if (state.future.length === 0) return state;
  const future = [...state.future];
  const next = future.pop() as LonLat[];
  return { ...state, waypoints: next, history: remember(state), future, selected: [] };
}

/** Has the line actually changed? Drives whether saving is offered at all. */
export function isDirty(state: RouteEditorState): boolean {
  return !sameLine(state.waypoints, state.original);
}
