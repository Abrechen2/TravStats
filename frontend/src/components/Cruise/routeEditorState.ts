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
  selected: number | null;
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

export function initRouteEditor(waypoints: LonLat[]): RouteEditorState {
  return {
    waypoints: clone(waypoints),
    original: clone(waypoints),
    selected: null,
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
  if (index === null || isEndpoint(state, index)) return { ...state, selected: null };
  return { ...state, selected: index };
}

export function moveWaypoint(state: RouteEditorState, index: number, to: LonLat): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints[index] = [to[0], to[1]];
  return { ...state, waypoints, history: remember(state), selected: index, future: [] };
}

/**
 * The start of a drag gesture: remember the line once, select the handle.
 * A live drag then streams positions through `dragWaypoint`, which does NOT
 * remember — one gesture, one history entry, one undo step. `moveWaypoint`
 * stays the right call for single-shot changes (a keyboard nudge).
 */
export function beginDrag(state: RouteEditorState, index: number): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  return { ...state, history: remember(state), selected: index, future: [] };
}

/** A drag in flight: move without remembering — `beginDrag` already did. */
export function dragWaypoint(state: RouteEditorState, index: number, to: LonLat): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints[index] = [to[0], to[1]];
  return { ...state, waypoints, selected: index };
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
  return { ...state, waypoints, history: remember(state), selected: segmentIndex + 1, future: [] };
}

export function removeWaypoint(state: RouteEditorState, index: number): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints.splice(index, 1);
  return { ...state, waypoints, history: remember(state), selected: null, future: [] };
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
  return { ...state, waypoints: previous, history, future, selected: null };
}

/** Restore what undo took back. Bounded by undo itself — the future can
 *  never outgrow the history that fed it. */
export function redo(state: RouteEditorState): RouteEditorState {
  if (state.future.length === 0) return state;
  const future = [...state.future];
  const next = future.pop() as LonLat[];
  return { ...state, waypoints: next, history: remember(state), future, selected: null };
}

/** Has the line actually changed? Drives whether saving is offered at all. */
export function isDirty(state: RouteEditorState): boolean {
  return !sameLine(state.waypoints, state.original);
}
