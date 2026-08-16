# Cruise Stage 2b — The Route Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag the waypoints of a cruise leg into the shape the ship actually sailed, on the map, and save that line.

**Architecture:** Stage 2a built the server half — a stored line per leg, honoured by both the geometry endpoint and the distance recompute. This stage adds the half the user touches: an editing mode on the existing cruise detail map, with draggable handles, insert-on-click, delete, undo, and a save that calls the endpoints 2a shipped. The editing state is a **pure reducer** with no React and no map in it, so the part that can be wrong is the part that is tested.

**Tech Stack:** React 19, TypeScript strict, Vite, Vitest, react-map-gl/maplibre + deck.gl `MapboxOverlay`, react-i18next (German primary, English mirror), axios.

**Spec:** `docs/superpowers/specs/2026-08-16-cruise-route-editing-and-excursions-design.md` — §6.1 is the interaction contract this stage implements, almost line for line.

**What already exists and must be reused, not rebuilt:**

- `PUT`/`DELETE /api/v1/cruises/:id/route-override` (stage 2a) — write and clear one leg's line, keyed by the leg's two endpoints.
- `GET /api/v1/cruises/:id/geometry` returns the stored line when there is one, with `properties.method === "manual_polyline"`. The frontend type in `frontend/src/lib/api/cruise.ts` already includes that value.
- `createCruiseArcsLayer` (`frontend/src/components/layers/cruiseArcsLayer.ts`) already splines a leg's waypoints into the displayed curve. **The editor does not draw its own curve** — it feeds edited waypoints into this same layer, so what the user drags is what they will see afterwards.
- `frontend/src/components/location/LocationMiniMap.tsx` is this project's established draggable-pin pattern (plain `react-map-gl` `<Marker draggable>`). Read it before writing task 3.

## Global Constraints

- `any` is **forbidden**. Use `unknown` plus type guards. Only `.d.ts` files are exempt.
- `useTranslation` comes from the project wrapper `../../hooks/useTranslation`, never from `react-i18next`.
- Every user-facing string goes into **both** `frontend/src/i18n/resources/de/cruise.json` and `.../en/cruise.json` in the same change. German is the primary copy; i18next plurals use `_one` / `_other`.
- deck.gl is used through `MapboxOverlay` + `useControl`, never the `<DeckGL>` React component — that combination breaks WebGL against MapLibre 5.
- Coordinates are `[lon, lat]` (GeoJSON order) everywhere. `react-map-gl` hands you `{ lng, lat }`; convert at the boundary and never carry the other order inward.
- Immutability: every reducer function returns a new object; never mutate state in place.
- Files: 200–400 lines ideal, **800 hard maximum**.
- Conventional commits, English.
- Do **not** touch `backend/VERSION` or `CHANGELOG.md`. Branch `dev/cruise-extension`; do not merge, do not push.

## Gate commands

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Backend is untouched by this stage. Do not run its suite.

---

### Task 1: The two API calls

**Files:**
- Modify: `frontend/src/lib/api/cruise.ts`
- Test: `frontend/src/lib/api/__tests__/cruise.api.test.ts` (exists — read it and follow its mocking convention exactly)

**Interfaces:**
- Consumes: the stage-2a HTTP contract.
- Produces: `RouteOverrideKey` and two methods on `cruiseApi`:

```ts
export interface RouteOverrideKey {
  fromKind: "port";
  fromRef: string;
  toKind: "port";
  toRef: string;
}
```

`cruiseApi.saveRouteOverride(cruiseId: string, key: RouteOverrideKey, waypoints: Array<[number, number]>): Promise<void>`
`cruiseApi.clearRouteOverride(cruiseId: string, key: RouteOverrideKey): Promise<void>`

- [ ] **Step 1: Write the failing test**

Read `frontend/src/lib/api/__tests__/cruise.api.test.ts` first and copy how it mocks the axios client — do not invent a second mocking style. Then add:

```ts
describe("route override", () => {
  it("PUTs the waypoints for one leg", async () => {
    // assert: url `/cruises/c1/route-override`, method PUT,
    // body { fromKind: "port", fromRef: "10", toKind: "port", toRef: "11",
    //        waypoints: [[9.99, 53.55], [-9.14, 38.72]] }
  });

  it("DELETEs with the key as query parameters, not a body", async () => {
    // The server reads the key from req.query on DELETE. Sending it as a body
    // would 400 — and would do so only against the real server, never against
    // a mock that ignores the shape.
  });
});
```

Fill both cases in fully against the mocking convention you found.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/lib/api/__tests__/cruise.api.test.ts`
Expected: FAIL — `saveRouteOverride` / `clearRouteOverride` are not functions.

- [ ] **Step 3: Implement**

In `frontend/src/lib/api/cruise.ts`, above `cruiseApi`:

```ts
/**
 * Identifies one leg by its two endpoints — the same key the server stores
 * under. Deliberately not the leg's position: inserting a port would shift
 * every stored line onto the wrong leg (see the spec, §4.3).
 */
export interface RouteOverrideKey {
  fromKind: "port";
  fromRef: string;
  toKind: "port";
  toRef: string;
}
```

and inside `cruiseApi`:

```ts
  /** Store this leg's hand-corrected line. Replaces any previous one. */
  saveRouteOverride: async (
    cruiseId: string,
    key: RouteOverrideKey,
    waypoints: Array<[number, number]>,
  ): Promise<void> => {
    await api.put(`/cruises/${cruiseId}/route-override`, { ...key, waypoints });
  },
  /**
   * Back to the router's line. The key travels as query parameters because
   * that is where the server reads it on DELETE.
   */
  clearRouteOverride: async (cruiseId: string, key: RouteOverrideKey): Promise<void> => {
    await api.delete(`/cruises/${cruiseId}/route-override`, { params: { ...key } });
  },
```

- [ ] **Step 4: Run it and watch it pass**

Same command as step 2. Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

```bash
git add frontend/src/lib/api/cruise.ts frontend/src/lib/api/__tests__/cruise.api.test.ts
git commit -m "feat(cruise): api calls to save and clear a hand-corrected route"
```

---

### Task 2: The editor's state, as a pure reducer

Everything that can be logically wrong about this editor lives here: which index an inserted point lands at, whether the endpoints are protected, whether undo really restores. None of it needs React or a map, so none of it gets tested through one.

**Files:**
- Create: `frontend/src/components/Cruise/routeEditorState.ts`
- Create: `frontend/src/__tests__/components/Cruise/routeEditorState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `routeEditorState.ts`:

```ts
export type LonLat = [number, number];

export interface RouteEditorState {
  /** Current line, [lon, lat]. First and last are the leg's endpoints. */
  waypoints: LonLat[];
  /** What the line looked like when editing began — the dirty comparison. */
  original: LonLat[];
  /** Index of the selected handle, or null. Never an endpoint. */
  selected: number | null;
  /** Previous states, newest last. Bounded. */
  history: LonLat[][];
}

export function initRouteEditor(waypoints: LonLat[]): RouteEditorState;
export function isEndpoint(state: RouteEditorState, index: number): boolean;
export function selectWaypoint(state: RouteEditorState, index: number | null): RouteEditorState;
export function moveWaypoint(state: RouteEditorState, index: number, to: LonLat): RouteEditorState;
export function insertWaypoint(state: RouteEditorState, segmentIndex: number, at: LonLat): RouteEditorState;
export function removeWaypoint(state: RouteEditorState, index: number): RouteEditorState;
export function nudgeWaypoint(state: RouteEditorState, index: number, dLon: number, dLat: number): RouteEditorState;
export function undo(state: RouteEditorState): RouteEditorState;
export function isDirty(state: RouteEditorState): boolean;
```

`nudgeWaypoint` is what the arrow keys call. The spec requires this editor to be
usable without a mouse (§6.1: *"A map editor that only answers to a mouse is
unusable for anyone who cannot use one, and this one is small enough that there
is no excuse."*), and a keyboard move has to go through the same protections a
dragged one does.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/components/Cruise/routeEditorState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  initRouteEditor,
  insertWaypoint,
  isDirty,
  isEndpoint,
  moveWaypoint,
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
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/__tests__/components/Cruise/routeEditorState.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/components/Cruise/routeEditorState.ts`:

```ts
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
  return { ...state, waypoints, history: remember(state), selected: index };
}

/**
 * Insert into the segment the user clicked. Segment `i` is the stretch
 * between waypoint `i` and waypoint `i + 1`, so the new point lands at
 * `i + 1` — the off-by-one this function exists to get right once.
 */
export function insertWaypoint(
  state: RouteEditorState,
  segmentIndex: number,
  at: LonLat,
): RouteEditorState {
  if (segmentIndex < 0 || segmentIndex >= state.waypoints.length - 1) return state;
  const waypoints = clone(state.waypoints);
  waypoints.splice(segmentIndex + 1, 0, [at[0], at[1]]);
  return { ...state, waypoints, history: remember(state), selected: segmentIndex + 1 };
}

export function removeWaypoint(state: RouteEditorState, index: number): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const waypoints = clone(state.waypoints);
  waypoints.splice(index, 1);
  return { ...state, waypoints, history: remember(state), selected: null };
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
  dLat: number,
): RouteEditorState {
  if (isEndpoint(state, index)) return state;
  const [lon, lat] = state.waypoints[index];
  return moveWaypoint(state, index, [lon + dLon, lat + dLat]);
}

export function undo(state: RouteEditorState): RouteEditorState {
  if (state.history.length === 0) return state;
  const history = [...state.history];
  const previous = history.pop() as LonLat[];
  return { ...state, waypoints: previous, history, selected: null };
}

/** Has the line actually changed? Drives whether saving is offered at all. */
export function isDirty(state: RouteEditorState): boolean {
  return !sameLine(state.waypoints, state.original);
}
```

- [ ] **Step 4: Run it and watch it pass**

Same command as step 2. Expected: PASS, every case.

- [ ] **Step 5: Gate and commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

```bash
git add frontend/src/components/Cruise/routeEditorState.ts \
        frontend/src/__tests__/components/Cruise/routeEditorState.test.ts
git commit -m "feat(cruise): the route editor's state, with no map in it"
```

---

### Task 3: The editor on the map

**Files:**
- Create: `frontend/src/components/Cruise/RouteEditorOverlay.tsx`
- Modify: `frontend/src/components/Cruise/CruiseRouteMap.tsx`

**Interfaces:**
- Consumes: task 2's reducer, plus `createCruiseArcsLayer` from `../layers/cruiseArcsLayer`. Task 1's API calls are **not** used yet — saving is task 4.
- Produces: `RouteEditorOverlay` (the handles), and in `CruiseRouteMap` the editing state this stage's remaining work builds on:

```tsx
/** Which leg is under edit, keyed the way the server keys it. */
interface EditingLeg {
  fromPortId: number;
  toPortId: number;
}

const [editing, setEditing] = useState<EditingLeg | null>(null);
const [editorState, setEditorState] = useState<RouteEditorState | null>(null);
```

**This task owns entering the editor**, so that it is demonstrable on its own:
while `editing === null`, make the arcs layer `pickable` and let a click on a
leg set both pieces of state — `setEditing({ fromPortId, toPortId })` from the
clicked feature's properties, and `setEditorState(initRouteEditor(feature.geometry.coordinates))`.
Task 4 adds the button, the buttons bar, saving and the badge; it does not
re-introduce the state.

Read `frontend/src/components/location/LocationMiniMap.tsx` before starting. It is this project's established draggable-pin pattern and the handles here work the same way.

- [ ] **Step 1: Build the overlay**

Create `frontend/src/components/Cruise/RouteEditorOverlay.tsx`:

```tsx
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
                  // The spec requires this editor to be usable without a
                  // mouse. Endpoint protection lives in the reducer, so these
                  // handlers can call through without re-checking it.
                  if (endpoint) return;
                  const step = e.shiftKey ? nudgeStep / 10 : nudgeStep;
                  if (e.key === "ArrowLeft") { e.preventDefault(); onNudge(index, -step, 0); }
                  else if (e.key === "ArrowRight") { e.preventDefault(); onNudge(index, step, 0); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); onNudge(index, 0, step); }
                  else if (e.key === "ArrowDown") { e.preventDefault(); onNudge(index, 0, -step); }
                  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(index); }
                  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); onUndo(); }
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
```

- [ ] **Step 2: Feed the edited line into the existing curve**

In `CruiseRouteMap.tsx`, the layers memo currently passes `geometryMap` straight to `createCruiseArcsLayer`. While a leg is being edited, that map must carry the **local** waypoints for that leg instead of the server's, so the curve the user sees is the curve they are making.

Add, before the layers memo:

```tsx
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
        f.properties.fromPortId === editing.fromPortId &&
        f.properties.toPortId === editing.toPortId
          ? { ...f, geometry: { ...f.geometry, coordinates: editorState.waypoints } }
          : f,
      ),
    };
  }, [geometry, editing, editorState]);
```

and use `displayGeometry` where `geometry` fed `geometryMap`.

- [ ] **Step 3: Draw the guide line, and make it clickable**

Add a deck.gl `PathLayer` with **one path per segment**, so a click gives the segment index directly. Add to the layers memo, only while editing:

```tsx
import { PathLayer } from "@deck.gl/layers";

// … inside the layers memo, when editing:
    const guide = new PathLayer<{ path: LonLat[]; segment: number }>({
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
      // One path per segment is the point: deck.gl hands back the index of the
      // datum that was clicked, which IS the segment index the state reducer
      // wants. Hit-testing a single multi-segment path would not tell us which
      // stretch was hit.
      onClick: (info) => {
        if (info.index >= 0 && info.coordinate) {
          onInsert(info.index, [info.coordinate[0], info.coordinate[1]]);
          return true;
        }
        return false;
      },
    });
```

The straight guide is not decoration: the drawn route is a spline **through** the handles, so it bows away from the straight line between them. Without the guide, a click on the curve could not say which two handles it belongs between. This is stated in the spec, §6.1.

- [ ] **Step 4: Verify in the browser, because no test here can**

There is no meaningful unit test for drag-and-drop over a WebGL map, and pretending otherwise would be worse than admitting it. Stand up the dev stack and check by hand:

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" PORT=8001 FRONTEND_URL=http://127.0.0.1:3001 NODE_ENV=development COOKIE_SECURE=false npx tsx src/index.ts
cd frontend && VITE_API_URL=http://127.0.0.1:8001 npx vite --port 3001 --host 127.0.0.1
```

`VITE_API_URL` must be set **in the shell**: `vite.config.ts` reads the proxy target from `process.env`, while the axios client reads `import.meta.env`. Put it only in `.env.local` and the two talk to different backends.

Pass `nudgeStep` from the map's current zoom rather than a constant, so one
arrow press always moves roughly the same distance on screen instead of a
pixel at world scale and a continent when zoomed in:

```tsx
// ~4 screen pixels' worth of degrees at the current zoom.
const nudgeStep = 360 / 2 ** (zoom + 6);
```

Confirm, and write what you saw into your report:

- a handle drags, and the curve follows during the drag, not on release;
- clicking the dashed guide inserts a point between exactly the two handles whose stretch was clicked;
- the ✕ removes the selected handle;
- the endpoints do not drag;
- **Tab reaches the handles, the arrow keys move the focused one, Shift makes the step finer, `Delete` removes it, and `Ctrl+Z` undoes** — the whole editor is operable without touching the mouse;
- no console errors, and no WebGL warnings that were not there before.

- [ ] **Step 5: Gate and commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

```bash
git add frontend/src/components/Cruise/RouteEditorOverlay.tsx \
        frontend/src/components/Cruise/CruiseRouteMap.tsx
git commit -m "feat(cruise): drag the waypoints of a leg on the map"
```

---

### Task 4: Entering, leaving, saving

**Files:**
- Modify: `frontend/src/components/Cruise/CruiseRouteMap.tsx`
- Modify: `frontend/src/i18n/resources/de/cruise.json`
- Modify: `frontend/src/i18n/resources/en/cruise.json`
- Test: `frontend/src/__tests__/components/Cruise/routeEditorState.test.ts` (extend if you add state functions)

- [ ] **Step 1: Add the strings, both languages together**

In `de/cruise.json`, inside the object that already holds the map-related keys (find where `CruiseRouteMap`'s existing keys live; if it has none, add a `routeEditor` object at the same level as `list` and `field`):

```json
    "routeEditor": {
      "edit": "Route bearbeiten",
      "pickLeg": "Etappe auf der Karte antippen",
      "save": "Speichern",
      "cancel": "Abbrechen",
      "reset": "Wieder automatisch",
      "undo": "Rückgängig",
      "handle": "Wegpunkt {{index}}",
      "endpoint": "Endpunkt der Etappe — nicht verschiebbar",
      "removeHandle": "Wegpunkt entfernen",
      "editedBadge": "von Hand korrigiert",
      "saveFailed": "Speichern fehlgeschlagen. Die Linie auf der Karte ist noch deine — noch einmal versuchen?",
      "discardConfirm": "Änderungen an dieser Etappe verwerfen?"
    }
```

and the mirror in `en/cruise.json`:

```json
    "routeEditor": {
      "edit": "Edit route",
      "pickLeg": "Tap a leg on the map",
      "save": "Save",
      "cancel": "Cancel",
      "reset": "Back to automatic",
      "undo": "Undo",
      "handle": "Waypoint {{index}}",
      "endpoint": "Leg endpoint — cannot be moved",
      "removeHandle": "Remove waypoint",
      "editedBadge": "corrected by hand",
      "saveFailed": "Could not save. The line on the map is still yours — try again?",
      "discardConfirm": "Discard the changes to this leg?"
    }
```

- [ ] **Step 2: Wire the chrome**

Task 3 already introduced `editing`, `editorState` and entry-by-clicking-a-leg.
This step adds the bar above the map and the persistence behind it.

```tsx
  const [editMode, setEditMode] = useState(false);
  const [saveError, setSaveError] = useState(false);

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
    } catch (err) {
      logger.warn("CruiseRouteMap: clearing the route override failed", err);
      setSaveError(true);
    }
  };

  const onCancel = (): void => {
    if (editorState && isDirty(editorState) && !window.confirm(t("routeEditor.discardConfirm"))) {
      return;
    }
    closeEditor();
  };
```

and the bar itself, rendered above the map container:

```tsx
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {!editMode && (
          <button type="button" onClick={(): void => setEditMode(true)}>
            {t("routeEditor.edit")}
          </button>
        )}
        {editMode && !editing && (
          <span className="text-sm text-(--text-muted)">{t("routeEditor.pickLeg")}</span>
        )}
        {editing && editorState && (
          <>
            <button
              type="button"
              disabled={editorState.history.length === 0}
              onClick={(): void => setEditorState(undo(editorState))}
            >
              {t("routeEditor.undo")}
            </button>
            <button type="button" disabled={!isDirty(editorState)} onClick={(): void => void onSave()}>
              {t("routeEditor.save")}
            </button>
            <button type="button" onClick={onCancel}>
              {t("routeEditor.cancel")}
            </button>
            {editedLegKeys.has(`${editing.fromPortId}:${editing.toPortId}`) && (
              <button type="button" onClick={(): void => void onReset()}>
                {t("routeEditor.reset")}
              </button>
            )}
          </>
        )}
        {saveError && (
          <span className="text-sm text-(--danger)">{t("routeEditor.saveFailed")}</span>
        )}
      </div>
```

where `editedLegKeys` is derived from the fetched geometry:

```tsx
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
```

Show `routeEditor.editedBadge` beside the map whenever `editedLegKeys` is not
empty, so a corrected route is visible without entering the editor.

Leaving edit mode entirely (`setEditMode(false)`) must go through `onCancel`
so unsaved work is never dropped silently.

- [ ] **Step 3: Check the file size**

`CruiseRouteMap.tsx` starts at 162 lines and this task adds a good deal. If it approaches 800, stop and report it rather than splitting on your own — but note that the natural split, if needed, is to lift the control bar into its own component, not to break up the map.

- [ ] **Step 4: Verify in the browser**

Same stack as task 3. Confirm and write down:

- the button enters editing; a leg can be picked by clicking it;
- saving persists — reload the page and the corrected line is still there, and the leg now shows the badge;
- **the kilometres on the detail page change to match the new line** (this is stage 2a's invariant, seen for the first time from the outside);
- "Wieder automatisch" restores the router's line and the badge disappears;
- a failed save (stop the backend, then save) leaves your line on screen and shows the message;
- German and English both read correctly.

- [ ] **Step 5: Gate and commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

```bash
git add frontend/src/components/Cruise/CruiseRouteMap.tsx \
        frontend/src/i18n/resources/de/cruise.json \
        frontend/src/i18n/resources/en/cruise.json
git commit -m "feat(cruise): a button to correct a route, and a line that survives a reload"
```

---

## Done when

- [ ] The cruise detail map has a **Route bearbeiten** button, and a leg can be chosen by clicking it.
- [ ] A handle drags and the curve follows live; clicking the guide inserts into the clicked stretch; ✕ removes; endpoints refuse to move.
- [ ] Undo steps back one gesture at a time and goes quiet when there is nothing left.
- [ ] Saving persists across a page reload, the leg shows the "von Hand korrigiert" badge, and the cruise's kilometres change to match the drawn line.
- [ ] "Wieder automatisch" restores the router's line and removes the badge.
- [ ] A failed save keeps the user's line on screen and says so.
- [ ] Both languages read correctly, checked in the browser.
- [ ] `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` clean.

## Not in this plan

Excursions, `CruisePlace`, the fourth stop state and the generic leg endpoints are stages 3 to 5. Nothing in this stage may add a landing, a name on a waypoint, or a second endpoint kind — a waypoint here shapes the line and nothing else.
