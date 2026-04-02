# Map Glassmorphism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the map visualization with a Glassmorphism theme using CSS token architecture, enabling future theme switching (Classic/Neon/etc.) without code changes.

**Architecture:** A `data-map-theme` attribute on the MapContainer div drives CSS variables for all non-WebGL elements (FAB, overlays). A `MAP_LAYER_COLORS` TypeScript record drives deck.gl layer colors per theme. `themeStore` persists the active `MapTheme`. Glassmorphism is the new default.

**Tech Stack:** React 18, TypeScript strict, deck.gl 9, MapLibre GL 5, framer-motion 12, Zustand, Vitest + Testing Library

---

## File Map

| Action | File |
|--------|------|
| Create | `frontend/src/types/mapTheme.ts` |
| Modify | `frontend/src/index.css` |
| Modify | `frontend/src/store/themeStore.ts` |
| Modify | `frontend/src/components/layers/layerTypes.ts` |
| Modify | `frontend/src/components/layers/routesLayer.ts` |
| Modify | `frontend/src/components/layers/hexagonLayer.ts` |
| Modify | `frontend/src/components/layers/columnsLayer.ts` |
| Modify | `frontend/src/components/DeckGLMap.tsx` |
| Rewrite | `frontend/src/components/VisModeSelector.tsx` |
| Modify | `frontend/src/components/MapContainer3D.tsx` |
| Modify | `frontend/src/i18n/resources/de/map.json` |
| Modify | `frontend/src/i18n/resources/en/map.json` |
| Modify | `frontend/src/__tests__/components/VisModeSelector.test.tsx` |
| Modify | `frontend/src/__tests__/layers/layerTypes.test.ts` (minimal — existing tests still pass) |

---

### Task 1: Feature Branch

**Files:** none

- [ ] **Step 1: Create and switch to feature branch**

```bash
cd /d/Projekte/TravStats
git checkout -b feature/map-glassmorphism
```

Expected: `Switched to a new branch 'feature/map-glassmorphism'`

---

### Task 2: Map Theme Types + CSS Tokens

**Files:**
- Create: `frontend/src/types/mapTheme.ts`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Create mapTheme.ts**

```typescript
// frontend/src/types/mapTheme.ts

export type MapTheme = "glassmorphism" | "classic";

export interface MapLayerColors {
  low: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
  peak: [number, number, number];
  airportDot: [number, number, number];
  hexRange: [number, number, number, number][];
}

export const MAP_LAYER_COLORS: Record<MapTheme, MapLayerColors> = {
  glassmorphism: {
    low: [100, 116, 139],
    mid: [99, 102, 241],
    high: [139, 92, 246],
    peak: [34, 211, 153],
    airportDot: [147, 197, 253],
    hexRange: [
      [100, 116, 139, 190],
      [79, 70, 229, 200],
      [99, 102, 241, 210],
      [139, 92, 246, 215],
      [52, 211, 153, 220],
      [167, 139, 250, 230],
    ],
  },
  classic: {
    low: [100, 116, 139],
    mid: [232, 160, 69],
    high: [249, 115, 22],
    peak: [239, 68, 68],
    airportDot: [232, 160, 69],
    hexRange: [
      [100, 116, 139, 190],
      [99, 102, 241, 200],
      [139, 92, 246, 210],
      [232, 160, 69, 215],
      [249, 115, 22, 220],
      [239, 68, 68, 230],
    ],
  },
};
```

- [ ] **Step 2: Add theme tokens to index.css**

Append after the existing CSS variable blocks (after the closing brace of `html.dark { ... }`):

```css
/* ─── Map Theme Tokens ───────────────────────────────────── */

[data-map-theme="glassmorphism"] {
  --map-accent: #818cf8;
  --map-fab-gradient: linear-gradient(135deg, #4f46e5, #818cf8);
  --map-fab-shadow: rgba(99, 102, 241, 0.55);
  --map-fab-shadow-open: 0 4px 24px rgba(99, 102, 241, 0.7), 0 0 40px rgba(99, 102, 241, 0.3);
  --map-active-bg: rgba(99, 102, 241, 0.25);
  --map-active-border: rgba(99, 102, 241, 0.5);
  --map-active-color: #a5b4fc;
  --map-active-label-bg: rgba(79, 70, 229, 0.25);
  --map-active-label-border: rgba(99, 102, 241, 0.35);
  --map-badge-bg: rgba(79, 70, 229, 0.2);
  --map-badge-border: rgba(99, 102, 241, 0.3);
  --map-badge-color: #a5b4fc;
}

[data-map-theme="classic"] {
  --map-accent: #e8a045;
  --map-fab-gradient: linear-gradient(135deg, #c8842a, #e8a045);
  --map-fab-shadow: rgba(232, 160, 69, 0.4);
  --map-fab-shadow-open: 0 4px 24px rgba(232, 160, 69, 0.6);
  --map-active-bg: rgba(232, 160, 69, 0.15);
  --map-active-border: rgba(232, 160, 69, 0.4);
  --map-active-color: #e8a045;
  --map-active-label-bg: rgba(232, 160, 69, 0.1);
  --map-active-label-border: rgba(232, 160, 69, 0.3);
  --map-badge-bg: rgba(232, 160, 69, 0.1);
  --map-badge-border: rgba(232, 160, 69, 0.25);
  --map-badge-color: #e8a045;
}

/* Blue tile tint — glassmorphism dark mode only */
html.dark [data-map-theme="glassmorphism"] canvas.maplibregl-canvas {
  filter: hue-rotate(200deg) saturate(1.8) brightness(0.75);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/mapTheme.ts frontend/src/index.css
git commit -m "feat: add map theme types and CSS tokens"
```

---

### Task 3: Extend themeStore with mapTheme

**Files:**
- Modify: `frontend/src/store/themeStore.ts`

- [ ] **Step 1: Add MapTheme import and extend interface**

At the top of `themeStore.ts`, add the import:
```typescript
import type { MapTheme } from "../types/mapTheme";
```

Replace the `ThemeState` interface:
```typescript
interface ThemeState {
  isDarkMode: boolean;
  mapTheme: MapTheme;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
  setMapTheme: (theme: MapTheme) => void;
}
```

- [ ] **Step 2: Add mapTheme to the store**

Inside the `create<ThemeState>()(persist((set) => { ... }))` factory, add `mapTheme` to the returned initial state and add `setMapTheme`:

```typescript
return {
  isDarkMode: initialTheme,
  mapTheme: "glassmorphism" as MapTheme,
  toggleDarkMode: () =>
    set((state) => {
      const newMode = !state.isDarkMode;
      updateDarkMode(newMode);
      return { isDarkMode: newMode };
    }),
  setDarkMode: (isDark) => {
    updateDarkMode(isDark);
    set({ isDarkMode: isDark });
  },
  setMapTheme: (theme) => set({ mapTheme: theme }),
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/themeStore.ts
git commit -m "feat: extend themeStore with mapTheme"
```

---

### Task 4: Update Layer Color Palette (TDD)

**Files:**
- Modify: `frontend/src/components/layers/layerTypes.ts`
- Modify: `frontend/src/__tests__/layers/layerTypes.test.ts`

The existing `layerTypes.test.ts` tests use `HEATMAP_COLORS.medium` etc. as expected values — those tests import the constant directly, so they remain valid regardless of color values. No test changes needed here. We only update the constant values and add a `themeColors` parameter to `getHeatmapColor`.

- [ ] **Step 1: Update HEATMAP_COLORS to glassmorphism palette**

In `layerTypes.ts`, replace `HEATMAP_COLORS`:

```typescript
export const HEATMAP_COLORS: Record<HeatmapTier, [number, number, number]> = {
  low: [100, 116, 139],      // slate-500 — unchanged
  medium: [99, 102, 241],    // indigo-500
  high: [139, 92, 246],      // violet-500
  critical: [34, 211, 153],  // emerald-400
};
```

- [ ] **Step 2: Add optional themeColors param to getHeatmapColor**

Replace the existing `getHeatmapColor` function:

```typescript
import type { MapLayerColors } from "../../types/mapTheme";

export function getHeatmapColor(
  count: number,
  q25: number,
  q50: number,
  q75: number,
  themeColors?: Pick<MapLayerColors, "low" | "mid" | "high" | "peak">
): [number, number, number] {
  const c = themeColors ?? {
    low: HEATMAP_COLORS.low,
    mid: HEATMAP_COLORS.medium,
    high: HEATMAP_COLORS.high,
    peak: HEATMAP_COLORS.critical,
  };
  if (count <= q25) return c.low;
  if (count <= q50) return c.mid;
  if (count <= q75) return c.high;
  return c.peak;
}
```

- [ ] **Step 3: Run layerTypes tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/layers/layerTypes.test.ts
```

Expected: all 4 tests PASS (they compare against the exported constant, not hardcoded values)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layers/layerTypes.ts
git commit -m "feat: update layer color palette to glassmorphism, add themeColors param"
```

---

### Task 5: Thread Theme Colors Through Layer Factories

**Files:**
- Modify: `frontend/src/components/layers/routesLayer.ts`
- Modify: `frontend/src/components/layers/hexagonLayer.ts`
- Modify: `frontend/src/components/layers/columnsLayer.ts`
- Modify: `frontend/src/components/DeckGLMap.tsx`

- [ ] **Step 1: Update routesLayer.ts — add themeColors param**

Add import at top:
```typescript
import type { MapLayerColors } from "../../types/mapTheme";
```

Update `buildRouteData` signature:
```typescript
export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  themeColors?: MapLayerColors
): { arcs: ArcDatum[]; points: PointDatum[] }
```

Inside `buildRouteData`, update the `getHeatmapColor` call (pass `themeColors`):
```typescript
const color = getHeatmapColor(count, q25, q50, q75, themeColors);
```

Update airport ring/dot colors to use `themeColors?.airportDot`:
```typescript
// In the ringLayer and dotLayer data (used in createRoutesLayers):
// These colors come from the PointDatum, so pass them through ArcDatum or handle in createRoutesLayers
```

Update `createRoutesLayers` signature:
```typescript
export function createRoutesLayers(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  onFlightClick?: (flightId: string) => void,
  themeColors?: MapLayerColors
): Layer[]
```

Inside `createRoutesLayers`, pass `themeColors` to `buildRouteData`:
```typescript
const { arcs, points } = buildRouteData(flights, minRouteCount, themeColors);
```

Update `ringLayer` and `dotLayer` colors to use theme:
```typescript
const dotRgb = themeColors?.airportDot ?? [232, 160, 69];

const ringLayer = new ScatterplotLayer<PointDatum>({
  id: "routes-ring",
  // ...
  getLineColor: [...dotRgb, 180] as [number, number, number, number],
  // ...
});

const dotLayer = new ScatterplotLayer<PointDatum>({
  id: "routes-dot",
  // ...
  getFillColor: [...dotRgb, 220] as [number, number, number, number],
  // ...
});
```

- [ ] **Step 2: Update hexagonLayer.ts — use theme colorRange**

Add import:
```typescript
import type { MapLayerColors } from "../../types/mapTheme";
import { MAP_LAYER_COLORS } from "../../types/mapTheme";
```

Update signature:
```typescript
export function createHexagonLayer(
  flights: GeoJSONFeature[],
  themeColors?: MapLayerColors
): HexagonLayer<HexDatum>
```

Replace hardcoded `colorRange`:
```typescript
colorRange: (themeColors?.hexRange ?? MAP_LAYER_COLORS.glassmorphism.hexRange) as [
  number,
  number,
  number,
  number,
][],
```

- [ ] **Step 3: Update columnsLayer.ts — pass themeColors**

Add import:
```typescript
import type { MapLayerColors } from "../../types/mapTheme";
```

Update `buildColumnData` and `createColumnsLayer` signatures:
```typescript
export function buildColumnData(
  flights: GeoJSONFeature[],
  themeColors?: MapLayerColors
): ColumnDatum[]
```

Pass `themeColors` to `getHeatmapColor` call inside `buildColumnData`:
```typescript
color: [...getHeatmapColor(p.count, q25, q50, q75, themeColors), 220] as [
  number,
  number,
  number,
  number,
],
```

Update `createColumnsLayer`:
```typescript
export function createColumnsLayer(
  flights: GeoJSONFeature[],
  themeColors?: MapLayerColors
): ColumnLayer<ColumnDatum> {
  const data = buildColumnData(flights, themeColors);
  // ...
}
```

- [ ] **Step 4: Update DeckGLMap.tsx to pass theme colors**

Add imports:
```typescript
import { MAP_LAYER_COLORS } from "../types/mapTheme";
import type { MapTheme } from "../types/mapTheme";
```

Read mapTheme from store:
```typescript
const mapTheme = useThemeStore((state) => state.mapTheme);
```

Derive colors:
```typescript
const themeColors = MAP_LAYER_COLORS[mapTheme];
```

Update the layers `useMemo` to pass `themeColors`:
```typescript
const layers = useMemo((): Layer[] => {
  switch (visMode) {
    case "routes":
      return createRoutesLayers(flights, minRouteCount, onFlightClick, themeColors);
    case "heatmap":
      return [createHeatmapLayer(flights)];
    case "hexagon":
      return [createHexagonLayer(flights, themeColors)];
    case "columns":
      return [createColumnsLayer(flights, themeColors)];
    case "trips":
      return [createTripsLayer(trips, currentTime)];
    case "contour":
      return [createContourLayer(flights)];
    default:
      return [];
  }
}, [visMode, flights, minRouteCount, trips, currentTime, onFlightClick, themeColors]);
```

- [ ] **Step 5: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run routes layer tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/layers/routesLayer.test.ts
```

Expected: all tests PASS (tests only check `buildRouteData` output structure, not colors)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/layers/routesLayer.ts \
        frontend/src/components/layers/hexagonLayer.ts \
        frontend/src/components/layers/columnsLayer.ts \
        frontend/src/components/DeckGLMap.tsx
git commit -m "feat: thread theme colors through all layer factories"
```

---

### Task 6: Airport Triple Ring Markers (TDD)

**Files:**
- Modify: `frontend/src/components/layers/routesLayer.ts`
- Modify: `frontend/src/__tests__/layers/routesLayer.test.ts`

- [ ] **Step 1: Write failing test for triple rings**

Add to `routesLayer.test.ts`:

```typescript
import { createRoutesLayers } from "../../components/layers/routesLayer";

describe("createRoutesLayers", () => {
  it("returns 5 layers: arc, dot, ring-inner, ring-outer, labels", () => {
    const layers = createRoutesLayers([mockFlight], 1);
    expect(layers).toHaveLength(5);
  });

  it("layer ids include routes-ring-inner and routes-ring-outer", () => {
    const layers = createRoutesLayers([mockFlight], 1);
    const ids = layers.map((l) => l.id);
    expect(ids).toContain("routes-ring-inner");
    expect(ids).toContain("routes-ring-outer");
    expect(ids).toContain("routes-dot");
    expect(ids).toContain("routes-arc");
    expect(ids).toContain("routes-labels");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/layers/routesLayer.test.ts
```

Expected: FAIL — `Expected 5, received 4`

- [ ] **Step 3: Add outer ring layer to createRoutesLayers**

In `routesLayer.ts`, replace the existing `ringLayer` with two rings and rename to `routes-ring-inner`:

```typescript
// Inner ring — hollow circle, close to dot
const ringInnerLayer = new ScatterplotLayer<PointDatum>({
  id: "routes-ring-inner",
  data: points,
  getPosition: (d) => d.position,
  getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1000,
  getFillColor: [0, 0, 0, 0],
  getLineColor: [...dotRgb, 180] as [number, number, number, number],
  stroked: true,
  filled: false,
  lineWidthMinPixels: 1.2,
  pickable: false,
});

// Outer ring — faint halo
const ringOuterLayer = new ScatterplotLayer<PointDatum>({
  id: "routes-ring-outer",
  data: points,
  getPosition: (d) => d.position,
  getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1800,
  getFillColor: [0, 0, 0, 0],
  getLineColor: [...dotRgb, 60] as [number, number, number, number],
  stroked: true,
  filled: false,
  lineWidthMinPixels: 0.8,
  pickable: false,
});
```

Update the return statement:
```typescript
return [arcLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/layers/routesLayer.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/routesLayer.ts \
        frontend/src/__tests__/layers/routesLayer.test.ts
git commit -m "feat: add triple ring airport markers"
```

---

### Task 7: Map CSS Filter + Grid Overlay (DeckGLMap.tsx)

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx`

The CSS filter is already in `index.css` (Task 2). This task applies the `data-map-theme` class to the Map wrapper and adds the grid overlay div.

- [ ] **Step 1: Wrap Map in a themed div and add grid overlay**

In `DeckGLMap.tsx`, replace the outermost return div:

```tsx
return (
  <div className="relative w-full h-full">
    <Map
      ref={mapRef}
      initialViewState={INITIAL_VIEW_STATE}
      mapStyle={isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
      style={{ position: "absolute", inset: "0" }}
    >
      <DeckGLOverlay layers={layers} effects={effects} />
    </Map>

    {/* Subtle grid overlay — glassmorphism dark mode only */}
    {isDarkMode && mapTheme === "glassmorphism" && (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M 40 0 L 0 0 0 40' fill='none' stroke='%23818cf8' stroke-width='0.5'/%3E%3C/svg%3E")`,
          opacity: 0.06,
        }}
      />
    )}

    {/* Time slider — bottom center, trips mode only */}
    {visMode === "trips" && (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <TimeSlider
          min={timeRange.min}
          max={timeRange.max}
          current={currentTime}
          onChange={handleTimeChange}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
        />
      </div>
    )}
  </div>
);
```

Note: The `data-map-theme` attribute is applied in `MapContainer3D` (Task 9), not here — the CSS selector `[data-map-theme="glassmorphism"] canvas.maplibregl-canvas` already targets the canvas inside the Map from the parent.

- [ ] **Step 2: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DeckGLMap.tsx
git commit -m "feat: add glassmorphism grid overlay to map"
```

---

### Task 8: New FAB VisModeSelector (TDD)

**Files:**
- Rewrite: `frontend/src/components/VisModeSelector.tsx`
- Modify: `frontend/src/__tests__/components/VisModeSelector.test.tsx`

- [ ] **Step 1: Rewrite the test file first**

```typescript
// frontend/src/__tests__/components/VisModeSelector.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VisModeSelector } from "../../components/VisModeSelector";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const defaultProps = {
  current: "routes" as const,
  onChange: vi.fn(),
  isOpen: false,
  onOpenChange: vi.fn(),
};

describe("VisModeSelector FAB", () => {
  it("renders the FAB toggle button", () => {
    render(<VisModeSelector {...defaultProps} />);
    expect(screen.getByRole("button", { name: "map:visMode.label" })).toBeInTheDocument();
  });

  it("does not show mode list when closed", () => {
    render(<VisModeSelector {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("button", { name: "map:visMode.heatmap" })).not.toBeInTheDocument();
  });

  it("shows all 7 mode buttons when open", () => {
    render(<VisModeSelector {...defaultProps} isOpen={true} />);
    expect(screen.getByRole("button", { name: "map:visMode.routes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.globe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.heatmap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.hexagon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.columns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.trips" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "map:visMode.contour" })).toBeInTheDocument();
  });

  it("calls onOpenChange(true) when FAB is clicked while closed", () => {
    const onOpenChange = vi.fn();
    render(<VisModeSelector {...defaultProps} isOpen={false} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "map:visMode.label" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("calls onOpenChange(false) when FAB is clicked while open", () => {
    const onOpenChange = vi.fn();
    render(<VisModeSelector {...defaultProps} isOpen={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "map:visMode.label" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onChange and onOpenChange(false) when a mode is selected", () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <VisModeSelector
        {...defaultProps}
        isOpen={true}
        onChange={onChange}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "map:visMode.heatmap" }));
    expect(onChange).toHaveBeenCalledWith("heatmap");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the active mode with aria-pressed=true", () => {
    render(<VisModeSelector {...defaultProps} isOpen={true} current="heatmap" />);
    expect(
      screen.getByRole("button", { name: "map:visMode.heatmap" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("marks inactive modes with aria-pressed=false", () => {
    render(<VisModeSelector {...defaultProps} isOpen={true} current="routes" />);
    expect(
      screen.getByRole("button", { name: "map:visMode.heatmap" })
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onOpenChange(false) on Escape key when open", () => {
    const onOpenChange = vi.fn();
    render(<VisModeSelector {...defaultProps} isOpen={true} onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/VisModeSelector.test.tsx
```

Expected: FAIL — interface mismatch (missing `isOpen`/`onOpenChange`)

- [ ] **Step 3: Rewrite VisModeSelector.tsx**

```typescript
// frontend/src/components/VisModeSelector.tsx
import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";

function RoutesIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 12 C5 2, 11 2, 14 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="2" cy="12" r="1.5" fill="currentColor" />
      <circle cx="14" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GlobeIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" strokeWidth="1" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function HeatmapIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

function HexagonIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2 L13.2 5 L13.2 11 L8 14 L2.8 11 L2.8 5 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ColumnsIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="9" width="3.5" height="5.5" rx="0.5" opacity="0.5" />
      <rect x="6.25" y="5.5" width="3.5" height="9" rx="0.5" opacity="0.75" />
      <rect x="11" y="2" width="3.5" height="12.5" rx="0.5" />
    </svg>
  );
}

function TripsIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 8 Q5 3 8 8 Q11 13 14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="14" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

function ContourIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="9" rx="6" ry="3.5" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <ellipse cx="8" cy="8.5" rx="4" ry="2.2" stroke="currentColor" strokeWidth="1.1" opacity="0.6" />
      <ellipse cx="8" cy="8" rx="2.2" ry="1.2" stroke="currentColor" strokeWidth="1.2" opacity="0.85" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const MODE_ICONS: Record<VisMode, () => JSX.Element> = {
  routes: RoutesIcon,
  globe: GlobeIcon,
  heatmap: HeatmapIcon,
  hexagon: HexagonIcon,
  columns: ColumnsIcon,
  trips: TripsIcon,
  contour: ContourIcon,
};

const MODES: { mode: VisMode; labelKey: string }[] = [
  { mode: "routes", labelKey: "map:visMode.routes" },
  { mode: "globe", labelKey: "map:visMode.globe" },
  { mode: "heatmap", labelKey: "map:visMode.heatmap" },
  { mode: "hexagon", labelKey: "map:visMode.hexagon" },
  { mode: "columns", labelKey: "map:visMode.columns" },
  { mode: "trips", labelKey: "map:visMode.trips" },
  { mode: "contour", labelKey: "map:visMode.contour" },
];

interface VisModeSeelctorProps {
  current: VisMode;
  onChange: (mode: VisMode) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VisModeSelector({
  current,
  onChange,
  isOpen,
  onOpenChange,
}: VisModeSeelctorProps): JSX.Element {
  const { t } = useTranslation("map");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onOpenChange(false);
    },
    [isOpen, onOpenChange]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleModeClick = useCallback(
    (mode: VisMode) => {
      onChange(mode);
      onOpenChange(false);
    },
    [onChange, onOpenChange]
  );

  const ActiveIcon = MODE_ICONS[current];

  return (
    <div className="relative flex flex-col items-end gap-1.5">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-end gap-1.5"
          >
            {[...MODES].reverse().map(({ mode, labelKey }) => {
              const active = current === mode;
              const Icon = MODE_ICONS[mode];
              return (
                <button
                  key={mode}
                  aria-label={t(labelKey)}
                  aria-pressed={active}
                  onClick={() => handleModeClick(mode)}
                  className="flex items-center gap-2 cursor-pointer border-none p-0 bg-transparent"
                >
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      fontSize: "9px",
                      fontFamily: "'Inter', sans-serif",
                      fontWeight: active ? 600 : 400,
                      color: active
                        ? "var(--map-active-color)"
                        : "rgba(148,163,184,0.7)",
                      background: active
                        ? "var(--map-active-label-bg)"
                        : "rgba(15,12,41,0.7)",
                      border: active
                        ? "1px solid var(--map-active-label-border)"
                        : "1px solid transparent",
                      backdropFilter: "blur(8px)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t(labelKey)}
                    {active ? " ✓" : ""}
                  </span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "11px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: active ? "var(--map-active-bg)" : "rgba(255,255,255,0.06)",
                      border: active
                        ? "1px solid var(--map-active-border)"
                        : "1px solid rgba(255,255,255,0.1)",
                      backdropFilter: "blur(12px)",
                      boxShadow: active ? "0 0 12px var(--map-fab-shadow)" : "none",
                      color: active ? "var(--map-active-color)" : "rgba(148,163,184,0.6)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon />
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Current mode badge — shown when FAB is closed */}
      {!isOpen && (
        <div
          className="absolute right-12 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            background: "var(--map-badge-bg)",
            backdropFilter: "blur(8px)",
            border: "1px solid var(--map-badge-border)",
            borderRadius: "6px",
            padding: "3px 8px",
            fontSize: "9px",
            color: "var(--map-badge-color)",
            fontFamily: "'Inter', sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          {t(`map:visMode.${current}`)} ◀
        </div>
      )}

      {/* FAB button */}
      <motion.button
        onClick={() => onOpenChange(!isOpen)}
        aria-label={t("map:visMode.label")}
        aria-expanded={isOpen}
        whileTap={{ scale: 0.92 }}
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "14px",
          background: "var(--map-fab-gradient)",
          border: "1px solid rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: isOpen
            ? "var(--map-fab-shadow-open)"
            : `0 4px 24px var(--map-fab-shadow)`,
          color: "white",
          flexShrink: 0,
        }}
      >
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2 }}
        >
          {isOpen ? <PlusIcon /> : <ActiveIcon />}
        </motion.div>
      </motion.button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/components/VisModeSelector.test.tsx
```

Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/VisModeSelector.tsx \
        frontend/src/__tests__/components/VisModeSelector.test.tsx
git commit -m "feat: replace VisModeSelector with FAB + expand component"
```

---

### Task 9: MapContainer3D Wiring

**Files:**
- Modify: `frontend/src/components/MapContainer3D.tsx`

- [ ] **Step 1: Rewrite MapContainer3D.tsx**

```tsx
import { lazy, Suspense, useState, useMemo } from "react";
import { DeckGLMap } from "./DeckGLMap";
import { VisModeSelector } from "./VisModeSelector";
import type { GeoJSONFeature } from "../types";
import type { VisMode } from "../types/visMode";
import { useTranslation } from "../hooks/useTranslation";
import { useThemeStore } from "../store/themeStore";
import { buildRouteData } from "./layers/routesLayer";

const GlobeView = lazy(() => import("./GlobeView"));

interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  visMode: VisMode;
  onVisModeChange: (mode: VisMode) => void;
  minRouteCount?: number;
}

export default function MapContainer3D({
  flights,
  selectedFlightId,
  onFlightClick,
  visMode,
  onVisModeChange,
  minRouteCount = 1,
}: MapContainer3DProps): JSX.Element {
  const { t } = useTranslation(["common", "map"]);
  const mapTheme = useThemeStore((s) => s.mapTheme);
  const [fabOpen, setFabOpen] = useState(false);

  const routeCount = useMemo(() => {
    if (visMode !== "routes") return null;
    const seen = new Set<string>();
    for (const f of flights) {
      const dep = f.properties.departureAirport?.iata;
      const arr = f.properties.arrivalAirport?.iata;
      if (dep && arr) seen.add([dep, arr].sort().join("-"));
    }
    return seen.size;
  }, [flights, visMode]);

  return (
    <div
      data-map-theme={mapTheme}
      className="relative h-full w-full rounded-lg shadow overflow-hidden bg-[var(--bg-surface)] flex items-center justify-center"
      style={{ touchAction: "pan-x pan-y pinch-zoom" }}
    >
      <div
        className="h-full w-full max-w-[1200px] flex items-center justify-center px-4"
        style={{ touchAction: "pan-x pan-y pinch-zoom" }}
      >
        {visMode === "globe" ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[var(--map-accent)] mx-auto mb-2" />
                  <p className="text-[var(--text-muted)] text-sm">{t("map:loading3DGlobe")}</p>
                </div>
              </div>
            }
          >
            <GlobeView
              flights={flights}
              selectedFlightId={selectedFlightId}
              onFlightClick={onFlightClick}
              minRouteCount={minRouteCount}
            />
          </Suspense>
        ) : (
          <DeckGLMap
            flights={flights}
            selectedFlightId={selectedFlightId}
            onFlightClick={onFlightClick}
            visMode={visMode}
            minRouteCount={minRouteCount}
          />
        )}
      </div>

      {/* Backdrop — dims map when FAB is open, click to close */}
      {fabOpen && (
        <div
          className="absolute inset-0 z-10"
          style={{ background: "rgba(10, 8, 30, 0.45)", backdropFilter: "blur(1px)" }}
          onClick={() => setFabOpen(false)}
        />
      )}

      {/* Info pill — flights + routes count, routes mode only */}
      {visMode === "routes" && routeCount !== null && (
        <div
          className="absolute top-3 left-3 z-10"
          style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "5px 10px",
            fontSize: "9px",
            color: "rgba(148,163,184,0.8)",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <span style={{ color: "var(--map-accent)", fontWeight: 600 }}>
            {flights.length}
          </span>
          {" "}{t("common:flights")}{" · "}
          <span style={{ color: "var(--map-accent)", fontWeight: 600 }}>
            {routeCount}
          </span>
          {" "}{t("map:visMode.routes").toLowerCase()}
        </div>
      )}

      {/* FAB — bottom right, always on top */}
      <div className="absolute bottom-4 right-4 z-20">
        <VisModeSelector
          current={visMode}
          onChange={onVisModeChange}
          isOpen={fabOpen}
          onOpenChange={setFabOpen}
        />
      </div>
    </div>
  );
}
```

Note: `t("common:flights")` requires a `flights` key in `common.json`. Check if it exists — if not, use a hardcoded string or add the key. Run `grep -r '"flights"' frontend/src/i18n/resources/de/common.json` to verify.

- [ ] **Step 2: Verify "flights" i18n key exists**

```bash
grep -r "flights" /d/Projekte/TravStats/frontend/src/i18n/resources/de/common.json | head -5
```

If not found, replace `t("common:flights")` in the info pill with the literal string `"Flüge"` (de) — but since this component renders for all languages, use a new i18n key. If the key is missing, add it in Task 10 along with the contour key.

- [ ] **Step 3: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MapContainer3D.tsx
git commit -m "feat: wire FAB, backdrop, info pill in MapContainer3D"
```

---

### Task 10: i18n — Add Missing Keys

**Files:**
- Modify: `frontend/src/i18n/resources/de/map.json`
- Modify: `frontend/src/i18n/resources/en/map.json`
- Possibly modify: `frontend/src/i18n/resources/de/common.json` and `en/common.json`

- [ ] **Step 1: Add contour key to de/map.json**

In the `visMode` object, add after `"trips"`:
```json
"contour": "Isolinien"
```

- [ ] **Step 2: Add contour key to en/map.json**

In the `visMode` object, add after `"trips"`:
```json
"contour": "Contour"
```

- [ ] **Step 3: Check and add flights key if needed**

```bash
grep -n "flights" /d/Projekte/TravStats/frontend/src/i18n/resources/de/common.json
```

If `"flights"` key is absent, add it to `de/common.json`:
```json
"flights": "Flüge"
```
And to `en/common.json`:
```json
"flights": "Flights"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/resources/
git commit -m "feat: add contour and flights i18n keys"
```

---

### Task 11: Full Build + Test Verification

- [ ] **Step 1: Run all frontend tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: all tests pass (63+ tests)

- [ ] **Step 2: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Lint**

```bash
cd /d/Projekte/TravStats/frontend && npm run lint
```

Expected: no errors

- [ ] **Step 4: Push branch**

```bash
git push -u origin feature/map-glassmorphism
```
