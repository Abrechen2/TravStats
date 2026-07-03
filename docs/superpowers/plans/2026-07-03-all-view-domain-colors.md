# "Alle"-View Domain Colors + Distinct Cruises — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the multi-domain "Alle" map, color both domains two-tone by status (flights orange=past/blue=upcoming, cruises periwinkle=past/light-periwinkle=planned, no grey/red); keep the single flight view unchanged; make individual cruises distinguishable (#150) via a distinct color per cruise (derived default + optional user-set), across the flat map and the globe.

**Architecture:** A new `statusTwoTone` flag gates the flat-map flight coloring so it only changes in the "Alle" view (`routesLayer.buildArcs`); a `cruiseColorMode` ("status" | "perCruise") drives cruise arc colors from `cruise.status` / a per-cruise color. A pure `cruiseColor.ts` helper derives a stable distinct color per cruise; an optional nullable `Cruise.color` (hand-written additive migration, mirroring `Trip.color`) overrides it. Both props thread `AllTab`/`CruisesTab` → `MapContainer3D` → `DeckGLMap` → the layer builders. The globe mirrors the same scheme.

**Tech Stack:** React + Vite + TypeScript + deck.gl (`@deck.gl/layers`) + Vitest; backend Prisma + Zod.

## Global Constraints

- **Build in the worktree** `D:\TravStats_Projekt\TravStats\.claude\worktrees\all-view-colors` on branch `feat/all-view-colors` (main checkout is the owner's; do not touch it).
- **`any` FORBIDDEN** — `unknown` + guards.
- **No `console.log`** (frontend `import { logger } from "../lib/logger"`).
- **Single flight view MUST stay visually unchanged** — the two-tone change is gated to the "Alle" view via `statusTwoTone`; `FlightsTab` never sets it.
- **No `prisma migrate dev`** — the Cruise `color` column is a **hand-written additive migration** (prod drift blocks generated migrations; precedent: cruise/pairing migrations). Nullable column only.
- **Colors (tunable on DEV):** flight past = orange `[240,169,71]` (`#f0a947`); flight upcoming = existing blue `[80,200,255]` (reused so the `UpcomingArcLayer` blue tips stay consistent; supersedes the design's `#5ab0f0` for shader consistency); cruise past = periwinkle `[111,160,214]` (`#6fa0d6`); cruise planned = light periwinkle `[169,195,224]` (`#a9c3e0`), rendered at lower alpha.
- **i18n DE + EN together.** DE primary.
- **Immutability**; conventional commits, no attribution trailer.
- **Verify:** `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` (backend Zod/migration task also `cd backend && npx tsc --noEmit && npm run lint`).

## Phases

- **Phase 1 (Tasks 1–7):** flat map — flight two-tone, cruise two-tone + distinct cruises, legend, optional user color.
- **Phase 2 (Task 8):** globe mirrors the scheme.
- **Task 9:** full verification.

---

## Task 1: `cruiseColor` helper (derived distinct color)

**Files:**
- Create: `frontend/src/lib/cruiseColor.ts`
- Test: `frontend/src/lib/cruiseColor.test.ts`

**Interfaces:**
- Produces:
  - `type Rgb = [number, number, number]`
  - `deriveCruiseColor(id: string): Rgb` — stable hash of the id → one of a curated palette.
  - `resolveCruiseColor(cruise: { id: string; color?: string | null }): Rgb` — parses `cruise.color` hex if present, else `deriveCruiseColor(cruise.id)`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/cruiseColor.test.ts
import { describe, it, expect } from "vitest";
import { deriveCruiseColor, resolveCruiseColor, CRUISE_DISTINCT_PALETTE } from "./cruiseColor";

describe("deriveCruiseColor", () => {
  it("is stable for the same id", () => {
    expect(deriveCruiseColor("abc")).toEqual(deriveCruiseColor("abc"));
  });
  it("returns a palette color", () => {
    expect(CRUISE_DISTINCT_PALETTE).toContainEqual(deriveCruiseColor("abc"));
  });
  it("spreads different ids across the palette (not all identical)", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
    const distinct = new Set(ids.map((i) => deriveCruiseColor(i).join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("resolveCruiseColor", () => {
  it("uses cruise.color hex when present", () => {
    expect(resolveCruiseColor({ id: "x", color: "#ff8800" })).toEqual([255, 136, 0]);
  });
  it("falls back to derived when color is null/absent/invalid", () => {
    expect(resolveCruiseColor({ id: "x", color: null })).toEqual(deriveCruiseColor("x"));
    expect(resolveCruiseColor({ id: "x", color: "not-a-hex" })).toEqual(deriveCruiseColor("x"));
    expect(resolveCruiseColor({ id: "x" })).toEqual(deriveCruiseColor("x"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest --run src/lib/cruiseColor.test.ts`
Expected: FAIL — cannot resolve `./cruiseColor`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/cruiseColor.ts
export type Rgb = [number, number, number];

// Curated distinct hues for telling individual cruises apart (#150). Chosen to
// avoid the four status colors (flight orange/blue, cruise periwinkle/light-
// periwinkle) and the domain colors (flight #f0a947, cruise #6fa0d6, hotel
// #b072d6, poi #5ec2b2). Dark-theme legible.
export const CRUISE_DISTINCT_PALETTE: Rgb[] = [
  [232, 131, 116], // coral
  [244, 191, 79], // gold
  [126, 200, 122], // green
  [95, 194, 178], // teal-green
  [130, 170, 255], // indigo-blue
  [178, 132, 224], // violet
  [232, 138, 196], // pink
  [214, 160, 92], // ochre
  [120, 205, 214], // cyan
  [176, 196, 108], // olive
];

/** FNV-1a-ish stable string hash → non-negative int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deriveCruiseColor(id: string): Rgb {
  return CRUISE_DISTINCT_PALETTE[hashString(id) % CRUISE_DISTINCT_PALETTE.length];
}

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resolveCruiseColor(cruise: { id: string; color?: string | null }): Rgb {
  if (cruise.color) {
    const parsed = parseHex(cruise.color);
    if (parsed) return parsed;
  }
  return deriveCruiseColor(cruise.id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest --run src/lib/cruiseColor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/cruiseColor.ts frontend/src/lib/cruiseColor.test.ts
git commit -m "feat(map): add cruiseColor helper (derived distinct + hex override)"
```

---

## Task 2: Flight two-tone in `routesLayer` (gated)

**Files:**
- Modify: `frontend/src/components/layers/routesLayer.ts` (constants ~51-61; `buildArcs` ~122-197; `buildRouteData` ~257-274)
- Test: `frontend/src/components/layers/routesLayer.twoTone.test.ts`

**Interfaces:**
- Consumes: existing `RouteRecord`, `ArcDatum`.
- Produces: `buildArcs(records, minRouteCount, themeColors?, paletteOverride?, statusTwoTone?)`; `buildRouteData(flights, minRouteCount, themeColors?, paletteOverride?, statusTwoTone?)`.

- [ ] **Step 1: Write the failing test** — this drives `buildRouteData` and asserts the color per status bucket. Uses minimal GeoJSON features.

```ts
// frontend/src/components/layers/routesLayer.twoTone.test.ts
import { describe, it, expect } from "vitest";
import { buildRouteData } from "./routesLayer";
import type { GeoJSONFeature } from "../../types";

function feat(id: string, status: string, dep: [number, number], arr: [number, number]): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [dep, arr] },
    properties: {
      id, status,
      departureTime: "2024-01-01T00:00:00Z",
      departureAirport: { iata: dep.join("_"), icao: null, name: "D" },
      arrivalAirport: { iata: arr.join("_"), icao: null, name: "A" },
    },
  } as unknown as GeoJSONFeature;
}

const rgb = (c: readonly number[]) => [c[0], c[1], c[2]];

describe("buildRouteData statusTwoTone", () => {
  it("colors historical routes orange (not grey) in two-tone", () => {
    const { arcs } = buildRouteData([feat("1", "historical", [0, 0], [1, 1])], 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([240, 169, 71]);
  });
  it("colors mixed routes orange core (not red) in two-tone", () => {
    const flights = [feat("1", "flown", [0, 0], [1, 1]), feat("2", "scheduled", [0, 0], [1, 1])];
    const { arcs } = buildRouteData(flights, 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([240, 169, 71]);
  });
  it("keeps scheduled routes blue in two-tone", () => {
    const { arcs } = buildRouteData([feat("1", "scheduled", [0, 0], [1, 1])], 1, undefined, undefined, true);
    expect(rgb(arcs[0].sourceColor)).toEqual([80, 200, 255]);
  });
  it("without two-tone, historical stays grey (regression guard)", () => {
    const { arcs } = buildRouteData([feat("1", "historical", [0, 0], [1, 1])], 1);
    expect(rgb(arcs[0].sourceColor)).toEqual([150, 150, 150]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest --run src/components/layers/routesLayer.twoTone.test.ts`
Expected: FAIL — two-tone args ignored, historical still grey.

- [ ] **Step 3: Implement** — add the two-tone constant + params.

Add after the `MIXED_RED_HIGH` constant (line 61):
```ts
// Two-tone "Alle" view: past family (historical + mixed core) collapses to the
// flight domain orange; upcoming stays SCHEDULED_BLUE (+ UpcomingArcLayer tips).
const TWO_TONE_PAST: [number, number, number] = [240, 169, 71];
```

Change `buildArcs` signature (line 134 area) to add the flag, and the decision block (lines 155-179):
```ts
function buildArcs(
  records: Map<string, RouteRecord>,
  minRouteCount: number,
  themeColors?: MapLayerColors,
  paletteOverride?: [number, number, number],
  statusTwoTone?: boolean,
): ArcDatum[] {
  // ...unchanged quantile setup...
  for (const r of records.values()) {
    if (r.count < minRouteCount) continue;
    let color: [number, number, number];
    let alpha: number;

    if (r.allHistorical) {
      color = statusTwoTone ? TWO_TONE_PAST : HISTORICAL_COLOR;
      alpha = statusTwoTone ? Math.min(160 + r.count * 14, 230) : HISTORICAL_ALPHA;
    } else if (r.hasUpcoming && !r.hasPastFlown) {
      color = SCHEDULED_BLUE;
      alpha = Math.min(140 + r.count * 14, 230);
    } else if (r.hasUpcoming && r.hasPastFlown) {
      color = statusTwoTone ? TWO_TONE_PAST : (r.count <= q50 ? MIXED_RED_LOW : MIXED_RED_HIGH);
      alpha = Math.min(100 + r.count * 14, 230);
    } else {
      color = paletteOverride ?? getHeatmapColor(r.count, q25, q50, q75, themeColors);
      alpha = Math.min(160 + r.count * 14, 230);
    }
    // ...unchanged arc push...
  }
  return arcs;
}
```

Change `buildRouteData` (line 257) to accept + forward the flag:
```ts
export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  themeColors?: MapLayerColors,
  paletteOverride?: [number, number, number],
  statusTwoTone?: boolean,
): RouteData {
  const records = aggregateAllRoutes(flights);
  return {
    arcs: buildArcs(records, minRouteCount, themeColors, paletteOverride, statusTwoTone),
    points: buildAirportPoints(flights),
  };
}
```

> The mixed layer still renders through `UpcomingArcLayer` — its blue tips now fade over an orange core (instead of red), which reads exactly as "past (orange) + upcoming (blue)". `UpcomingArcLayer.ts` is unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest --run src/components/layers/routesLayer.twoTone.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/routesLayer.ts frontend/src/components/layers/routesLayer.twoTone.test.ts
git commit -m "feat(map): add gated statusTwoTone flight coloring (no grey/red)"
```

---

## Task 3: Thread `statusTwoTone` to the "Alle" view

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx` (props ~90-124; `buildRouteData` call ~405)
- Modify: `frontend/src/components/MapContainer3D.tsx` (props ~25-57; passthrough ~198/214)
- Modify: `frontend/src/components/Dashboard/tabs/AllTab.tsx` (two `MapContainer3D` render sites ~438, ~466)

**Interfaces:** Consumes `buildRouteData(..., statusTwoTone)` (Task 2). Produces a `statusTwoTone?: boolean` prop on `DeckGLMap` + `MapContainer3D`.

- [ ] **Step 1: `DeckGLMap.tsx`** — add the prop to `DeckGLMapProps` (near `flightRouteColor` at line 104), destructure it (line 118 area), and pass it into `buildRouteData` (line 405) + its memo deps (line 406):

```tsx
// in DeckGLMapProps:
  statusTwoTone?: boolean;
// in destructure:
  statusTwoTone,
// the memo:
  const routeData = useMemo(
    () => buildRouteData(flights, minRouteCount, themeColors, flightRouteColor, statusTwoTone),
    [flights, minRouteCount, themeColors, flightRouteColor, statusTwoTone]
  );
```

- [ ] **Step 2: `MapContainer3D.tsx`** — add `statusTwoTone?: boolean` to `MapContainer3DProps` (near line 57), destructure (near line 103), and pass to BOTH `<DeckGLMap ... />` usages (lines ~198 and ~214, wherever `flightRouteColor={flightRouteColor}` appears add `statusTwoTone={statusTwoTone}`).

- [ ] **Step 3: `AllTab.tsx`** — on the two `MapContainer3D` render sites that pass `flightRouteColor={FLIGHT_RGB}` (lines ~443 and ~466), add `statusTwoTone`. (The journey-mode site at ~438 uses `flights={[]}` + extraLayers, so it does not need it, but adding it is harmless; add it only to the main overview/heatmap/globe site at ~466 which passes real `flights`.)

```tsx
<MapContainer3D
  /* ...existing props... */
  flightRouteColor={FLIGHT_RGB}
  statusTwoTone
  cruisesOverride={visibleCruises}
/>
```

- [ ] **Step 4: Verify single view untouched** — `FlightsTab.tsx` does NOT pass `statusTwoTone` (defaults undefined/false), so its coloring is unchanged.

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DeckGLMap.tsx frontend/src/components/MapContainer3D.tsx frontend/src/components/Dashboard/tabs/AllTab.tsx
git commit -m "feat(map): thread statusTwoTone into the Alle view"
```

---

## Task 4: Cruise two-tone + per-cruise color in `cruiseArcsLayer`

**Files:**
- Modify: `frontend/src/components/layers/cruiseArcsLayer.ts` (ArcDatum ~8-12; `buildCruiseArcs` ~64-97; `createCruiseArcsLayer` ~99-144; `createCruiseArrowsLayer` ~155-202)
- Modify: `frontend/src/index.css` (add token near lines 40-42)
- Test: `frontend/src/components/layers/cruiseArcsLayer.color.test.ts`

**Interfaces:**
- Consumes: `resolveCruiseColor` (Task 1); `Cruise` (`status`, `id`, optional `color`).
- Produces: `type CruiseColorMode = "status" | "perCruise"`; `buildCruiseArcs(cruises, geometryByCruise?, options?)` where `options` gains `colorMode?: CruiseColorMode`; each `ArcDatum` gains `status: CruiseStatus` and `color: Rgb`. `createCruiseArcsLayer` / `createCruiseArrowsLayer` gain the same `colorMode` option and render `d.color`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/components/layers/cruiseArcsLayer.color.test.ts
import { describe, it, expect } from "vitest";
import { buildCruiseArcs } from "./cruiseArcsLayer";
import type { Cruise } from "../../types";

function cruise(id: string, status: string, color?: string): Cruise {
  return {
    id, status,
    departurePort: { id: 1, lat: 0, lon: 0, name: "A" },
    arrivalPort: { id: 2, lat: 1, lon: 1, name: "B" },
    stops: [],
    color,
  } as unknown as Cruise;
}

describe("buildCruiseArcs colorMode", () => {
  it("status mode: past cruise = periwinkle", () => {
    const arcs = buildCruiseArcs([cruise("c1", "flown")], new Map(), { colorMode: "status" });
    expect(arcs[0].color).toEqual([111, 160, 214]);
  });
  it("status mode: scheduled cruise = light periwinkle (planned)", () => {
    const arcs = buildCruiseArcs([cruise("c1", "scheduled")], new Map(), { colorMode: "status" });
    expect(arcs[0].color).toEqual([169, 195, 224]);
  });
  it("perCruise mode: distinct cruises get distinct colors", () => {
    const a = buildCruiseArcs([cruise("c1", "flown")], new Map(), { colorMode: "perCruise" });
    const b = buildCruiseArcs([cruise("c2", "flown")], new Map(), { colorMode: "perCruise" });
    // both defined, and a user-set color overrides derivation:
    const custom = buildCruiseArcs([cruise("c3", "flown", "#ff8800")], new Map(), { colorMode: "perCruise" });
    expect(custom[0].color).toEqual([255, 136, 0]);
    expect(a[0].color).toBeDefined();
    expect(b[0].color).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest --run src/components/layers/cruiseArcsLayer.color.test.ts`
Expected: FAIL — `arcs[0].color` undefined / option ignored.

- [ ] **Step 3a: Add the CSS token** — `frontend/src/index.css` after line 42:
```css
  --domain-cruise-planned: #a9c3e0;
  --domain-cruise-planned-soft: rgba(169, 195, 224, 0.1);
```

- [ ] **Step 3b: Implement in `cruiseArcsLayer.ts`** — extend `ArcDatum`, add color resolution to `buildCruiseArcs`, and read `d.color` in the layers.

```ts
// top imports:
import { resolveCruiseColor, type Rgb } from "../../lib/cruiseColor";
import type { CruiseStatus } from "../../types/cruise";

export type CruiseColorMode = "status" | "perCruise";

// status-mode colors:
const CRUISE_PAST: Rgb = [111, 160, 214];       // #6fa0d6
const CRUISE_PLANNED: Rgb = [169, 195, 224];    // #a9c3e0

function cruiseArcColor(cruise: Cruise, mode: CruiseColorMode): Rgb {
  if (mode === "perCruise") return resolveCruiseColor(cruise);
  // status mode: scheduled = planned tone, everything past = periwinkle.
  return cruise.status === "scheduled" ? CRUISE_PLANNED : CRUISE_PAST;
}
```

Extend `ArcDatum` (line 8):
```ts
interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
  status: CruiseStatus;
  color: Rgb;
  planned: boolean;
}
```

`CruiseArcBuildOptions` (line 20) gains `colorMode?: CruiseColorMode` (default `"status"`). In `buildCruiseArcs` (line 89), stamp status/color/planned onto each pushed arc:
```ts
const mode = options.colorMode ?? "status";
const color = cruiseArcColor(cruise, mode);
// ... inside the leg loop, each arcs.push:
      arcs.push({
        path: buildRenderableRoutePath(routeGeometry, options),
        cruiseId: cruise.id,
        cruiseLine: cruise.cruiseLine,
        status: cruise.status,
        color,
        planned: cruise.status === "scheduled",
      });
```

In `createCruiseArcsLayer` `getColor` (line 124), use the datum color; planned arcs get lower alpha:
```ts
const FULL_ALPHA = 220;
const PLANNED_ALPHA = 150;
const DIM_ALPHA = 90;
// ...
    getColor: (d) => {
      if (hasSelection && d.cruiseId === selectedCruiseId) return [...HIGHLIGHT_COLOR, FULL_ALPHA];
      const base = d.planned ? PLANNED_ALPHA : FULL_ALPHA;
      return [...d.color, hasSelection ? DIM_ALPHA : base];
    },
```
Do the identical swap in `createCruiseArrowsLayer` `getColor` (line 187) — but the arrow `ArrowDatum` must also carry `color`/`planned`: extend `ArrowDatum` (line 14) with `color: Rgb; planned: boolean` and copy them from the arc when building arrows (line 166: `arrows.push({ ...anchor, cruiseId: arc.cruiseId, color: arc.color, planned: arc.planned })`). `createCruiseArrowsLayer` and `createCruiseArcsLayer` both take a `colorMode` through their `options` (already forwarded to `buildCruiseArcs`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest --run src/components/layers/cruiseArcsLayer.color.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/cruiseArcsLayer.ts frontend/src/components/layers/cruiseArcsLayer.color.test.ts frontend/src/index.css
git commit -m "feat(map): cruise two-tone by status + per-cruise color mode (#150)"
```

---

## Task 5: Wire `cruiseColorMode` per view

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx` (`createCruiseArcsLayer`/`createCruiseArrowsLayer` calls ~459/469; props)
- Modify: `frontend/src/components/MapContainer3D.tsx` (prop passthrough)
- Modify: `frontend/src/components/Dashboard/tabs/AllTab.tsx` (status mode), `frontend/src/components/Dashboard/tabs/CruisesTab.tsx` (perCruise mode)
- Modify: `frontend/src/components/Cruise/CruiseRouteMap.tsx` (perCruise mode, direct call)

**Interfaces:** Consumes `CruiseColorMode` (Task 4). Produces a `cruiseColorMode?: CruiseColorMode` prop on `DeckGLMap`/`MapContainer3D` (default `"status"`).

- [ ] **Step 1:** `DeckGLMap.tsx` — add `cruiseColorMode?: CruiseColorMode` prop (default `"status"`), pass `{ zoom, colorMode: cruiseColorMode }` into `createCruiseArcsLayer` (line 459) and `createCruiseArrowsLayer` (line 469). Both currently pass `{ zoom }` as the options arg — extend it.
- [ ] **Step 2:** `MapContainer3D.tsx` — add `cruiseColorMode?: CruiseColorMode` prop, forward to both `<DeckGLMap>` sites.
- [ ] **Step 3:** `AllTab.tsx` main render site (~466) — add `cruiseColorMode="status"` (explicit; it is also the default).
- [ ] **Step 4:** `CruisesTab.tsx` — the `<MapContainer3D>` render → add `cruiseColorMode="perCruise"`.
- [ ] **Step 5:** `CruiseRouteMap.tsx` — the direct `createCruiseArcsLayer([cruise], geometryMap, null, undefined, {zoom})` call → add `colorMode: "perCruise"` to the options: `createCruiseArcsLayer([cruise], geometryMap, null, undefined, { zoom, colorMode: "perCruise" })`.
- [ ] **Step 6: Verify + commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: clean/green.

```bash
git add frontend/src/components/DeckGLMap.tsx frontend/src/components/MapContainer3D.tsx frontend/src/components/Dashboard/tabs/AllTab.tsx frontend/src/components/Dashboard/tabs/CruisesTab.tsx frontend/src/components/Cruise/CruiseRouteMap.tsx
git commit -m "feat(map): status colors in Alle, per-cruise colors in cruise views"
```

---

## Task 6: "Alle" legend + i18n

**Files:**
- Modify: `frontend/src/components/Dashboard/tabs/AllTab.tsx` (legend block ~274-350)
- Modify: `frontend/src/i18n/resources/de/*.json` + `en/*.json` (the namespace AllTab uses — locate via the existing `t("...")` keys in the legend)

**Interfaces:** none (UI).

- [ ] **Step 1:** In the AllTab legend (`toggleAndLegend`, ~277-350), replace/extend the domain swatches so the "Alle" legend shows four status swatches with the ACTUAL render colors: Flug vergangen `rgb(240,169,71)`, Flug geplant `rgb(80,200,255)`, Kreuzfahrt vergangen `rgb(111,160,214)`, Kreuzfahrt geplant `rgb(169,195,224)`. Use inline `style={{ background: "rgb(...)" }}` swatches (mirroring the existing swatch at line ~326) with `t()` labels.
- [ ] **Step 2:** Add the i18n keys to DE + EN (e.g. `dashboard.legend.flightPast` = "Flüge (geflogen)" / "Flights (flown)", `.flightUpcoming` = "Flüge (geplant)" / "Flights (upcoming)", `.cruisePast` = "Kreuzfahrten (gefahren)" / "Cruises (sailed)", `.cruisePlanned` = "Kreuzfahrten (geplant)" / "Cruises (planned)"). Match the namespace the legend already reads.
- [ ] **Step 3: Verify + commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint && node -e "require('./src/i18n/resources/de/dashboard.json'); require('./src/i18n/resources/en/dashboard.json'); console.log('ok')"` (adjust filename to the real namespace).

```bash
git add frontend/src/components/Dashboard/tabs/AllTab.tsx frontend/src/i18n/resources
git commit -m "feat(map): Alle legend shows the four status swatches (de/en)"
```

---

## Task 7: Optional user-editable cruise color

**Files:**
- Modify: `backend/prisma/schema.prisma` (Cruise model ~755)
- Create: `backend/prisma/migrations/20260703_cruise_color/migration.sql` (HAND-WRITTEN, additive)
- Modify: `backend/src/schemas/` cruise schema (add optional `color`)
- Modify: `frontend/src/types/cruise.ts` (`Cruise.color`, `CruiseInput.color`)
- Modify: `frontend/src/components/Cruise/CruiseEditModal.tsx` (color picker; mirror the Trip color field)

**Interfaces:** Produces `Cruise.color: string | null`, accepted through create/update.

- [ ] **Step 1: schema.prisma** — in the Cruise model add (mirroring `Trip.color` at line 626, but nullable):
```prisma
  color         String?
```
Do NOT run `prisma migrate dev`.

- [ ] **Step 2: Hand-written migration** — create `backend/prisma/migrations/20260703_cruise_color/migration.sql`:
```sql
-- Additive: user-selectable per-cruise map color (nullable). Hand-written
-- because the schema has pre-existing drift that blocks `prisma migrate dev`.
ALTER TABLE "cruises" ADD COLUMN "color" TEXT;
```
Then `cd backend && npx prisma generate` to refresh the client (regenerate only; no DB reset).

- [ ] **Step 3: Zod** — in the cruise create/update schema, add `color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().nullable()` (locate the schema in `backend/src/schemas/`). Write a small Jest/unit assertion if the schema file has a test; otherwise rely on tsc.

- [ ] **Step 4: Frontend types** — `frontend/src/types/cruise.ts`: add `color?: string | null;` to `Cruise` (after line 57) and `CruiseInput` (after line 97).

- [ ] **Step 5: CruiseEditModal** — add a color field mirroring the Trip color picker (find the Trip modal's color input for the exact control), bound to the cruise `color`. Sends `color` through the existing save path.

- [ ] **Step 6: Verify + commit**

Run: `cd backend && npx tsc --noEmit && npm run lint` and `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean. (Apply the migration to the dev DB: `cd backend && npx prisma migrate deploy`.)

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260703_cruise_color backend/src/schemas frontend/src/types/cruise.ts frontend/src/components/Cruise/CruiseEditModal.tsx
git commit -m "feat(cruise): optional user-selectable per-cruise map color"
```

---

## Task 8 (Phase 2): Globe mirrors the scheme

**Files:**
- Modify: `frontend/src/components/Globe/buildGlobeLayers.ts` (flight `arcColor` ~127; `CRUISE_PATH_COLOR` ~25 / apply ~238)
- Modify: `frontend/src/components/GlobeView.tsx` (flight arc color build ~677/692; cruise path build ~863)
- Modify: `frontend/src/components/Globe/globeLayerTypes.ts` (add `status`/`color` to `ArcDatum`/`CruisePathDatum`)

**Interfaces:** Consumes `deriveCruiseColor`/`resolveCruiseColor` (Task 1), the same status→color mapping (Task 2/4). The globe "Alle" mode gets flight two-tone + cruise two-tone; the Cruises globe gets per-cruise.

- [ ] **Step 1:** Thread a `statusTwoTone` + `cruiseColorMode` signal into the globe HTML/layer build the same way `flightRouteColor` reaches the globe today. Flight arcs: when `statusTwoTone`, color by status (historical/mixed/past → orange `[240,169,71]`, scheduled → blue `[80,200,255]`) instead of the count heatmap. Cruise paths: status mode → periwinkle/planned; perCruise → `resolveCruiseColor`.
- [ ] **Step 2:** Add a globe color unit test if the globe color logic is a pure function; otherwise verify via tsc + the running dev globe.
- [ ] **Step 3: Verify + commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`

```bash
git add frontend/src/components/Globe
git commit -m "feat(globe): mirror Alle status two-tone + per-cruise colors"
```

> If the globe color path is deeply entangled (WebGL/HTML string), this task may be split during execution — keep Phase 1 shippable on its own.

---

## Task 9: Full verification + manual smoke

- [ ] **Step 1:** `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run` — green.
- [ ] **Step 2:** `cd backend && npx tsc --noEmit && npm run lint` — green (migration applied on dev DB).
- [ ] **Step 3:** `gitnexus_detect_changes({repo: "TravStats", scope: "compare", base_ref: "main"})` — changed scope limited to the map layers, cruise color, and the wiring; no unexpected files.
- [ ] **Step 4: Manual smoke (owner or controller):** dev server, `/dashboard` Alle tab — flights orange(past)/blue(upcoming) no grey/red; cruises periwinkle(past)/light(planned). Single flight tab unchanged (grey/heatmap still there). Cruises tab — each cruise a distinct color. Cruise edit modal — color picker works. Tune the four hex values live if needed.

---

## Self-Review

**Spec coverage:**
- Flight two-tone in Alle, no grey/red, gated → Tasks 2 + 3. ✓
- Cruise two-tone by status + planned token → Task 4 + `--domain-cruise-planned`. ✓
- #150 distinct cruises (derived default + user override) → Task 1 + 4 (derived) + 7 (user color). ✓
- Single flight view unchanged → Task 3 gating + Task 2 regression test. ✓
- Legend + i18n → Task 6. ✓
- Globe (Phase 2) → Task 8. ✓
- Vitest for cruiseColor + routesLayer + cruiseArcsLayer → Tasks 1, 2, 4. ✓

**Deviations from design (recorded):** flight-upcoming uses the existing blue `[80,200,255]` rather than `#5ab0f0`, so the `UpcomingArcLayer` shader tips stay consistent (no shader edit). Tunable. `UpcomingArcLayer.ts` is NOT modified (the design mentioned parameterizing it; unnecessary — the core color is data-driven in `buildArcs`).

**Placeholder scan:** legend i18n namespace + CruiseEditModal color control + backend Zod schema location are "locate the real file/key" instructions with the exact change stated — not vague placeholders. No TBD/TODO.

**Type consistency:** `Rgb` defined in Task 1, reused in Tasks 4/8. `CruiseColorMode` defined in Task 4, consumed in Task 5. `statusTwoTone` signature identical across Tasks 2/3. `resolveCruiseColor` signature stable (Tasks 1/4). `Cruise.color` added in Task 7 and consumed by `resolveCruiseColor` (Task 1) — `resolveCruiseColor` tolerates absent `color`, so Tasks 1–6 work before Task 7 lands.
