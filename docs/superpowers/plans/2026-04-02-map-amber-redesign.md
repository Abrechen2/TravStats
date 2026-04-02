# Map Amber Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the indigo/cyan glassmorphism color scheme with TravStats amber brand colors, move the filter button to bottom-right as a FAB, and upgrade the globe to a night-earth texture with amber atmosphere.

**Architecture:** Four targeted changes — (1) amber color constants in layer types, (2) amber CSS tokens + remove map filter, (3) filter component relocated from bottom-center to bottom-right FAB slot in MapContainer3D, (4) GlobeView night texture + amber glow. No new files except two texture copies to `/public`.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, deck.gl 9, react-globe.gl, Vitest

**Branch:** `feature/map-glassmorphism`

---

### Task 1: Amber color palette

**Files:**
- Modify: `frontend/src/types/mapTheme.ts`
- Modify: `frontend/src/components/layers/layerTypes.ts`
- Test: `frontend/src/__tests__/layers/layerTypes.test.ts` (existing — must still pass)

The `glassmorphism` palette currently uses indigo/violet/emerald. Replace it with amber→orange→red. The `classic` palette stays unchanged.

- [ ] **Step 1: Update `MAP_LAYER_COLORS.glassmorphism` in `mapTheme.ts`**

Replace the entire `glassmorphism` entry (lines 13–27). The `classic` entry is untouched.

```typescript
// frontend/src/types/mapTheme.ts — full file replacement
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
    mid: [232, 160, 69],
    high: [249, 115, 22],
    peak: [239, 68, 68],
    airportDot: [232, 160, 69],
    hexRange: [
      [100, 116, 139, 190],
      [232, 160, 69, 200],
      [245, 140, 50, 210],
      [249, 115, 22, 215],
      [239, 68, 68, 220],
      [220, 38, 38, 230],
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

- [ ] **Step 2: Update `HEATMAP_COLORS` in `layerTypes.ts`**

Find lines 26–31 and replace:

```typescript
export const HEATMAP_COLORS: Record<HeatmapTier, [number, number, number]> = {
  low: [100, 116, 139], // slate-500
  medium: [232, 160, 69], // amber-400
  high: [249, 115, 22], // orange-500
  critical: [239, 68, 68], // red-500
};
```

- [ ] **Step 3: Run existing layer tests to verify no regressions**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run src/__tests__/layers/layerTypes.test.ts
```

Expected: 6 tests pass. (Tests check function logic using `HEATMAP_COLORS` constants — they pass regardless of specific color values.)

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/types/mapTheme.ts frontend/src/components/layers/layerTypes.ts
git commit -m "feat: update glassmorphism layer palette to amber"
```

---

### Task 2: CSS tokens amber + remove map filter + revert map style

**Files:**
- Modify: `frontend/src/index.css` (lines 246–279)
- Modify: `frontend/src/components/DeckGLMap.tsx` (line 130)

No new tests needed — visual changes only.

- [ ] **Step 1: Replace glassmorphism CSS token block in `index.css`**

Replace lines 246–279 (the full `[data-map-theme="glassmorphism"]` block and the CSS filter rule below it) with:

```css
[data-map-theme="glassmorphism"] {
  --map-accent: #e8a045;
  --map-fab-gradient: linear-gradient(135deg, #c8842a, #e8a045);
  --map-fab-shadow: rgba(232, 160, 69, 0.4);
  --map-fab-shadow-open: 0 4px 24px rgba(232, 160, 69, 0.6), 0 0 40px rgba(232, 160, 69, 0.2);
  --map-active-bg: rgba(232, 160, 69, 0.2);
  --map-active-border: rgba(232, 160, 69, 0.45);
  --map-active-color: #fcd99a;
  --map-active-label-bg: rgba(200, 132, 42, 0.2);
  --map-active-label-border: rgba(232, 160, 69, 0.35);
  --map-badge-bg: rgba(255, 255, 255, 0.06);
  --map-badge-border: rgba(255, 255, 255, 0.12);
  --map-badge-color: #94a3b8;
}
```

Remove the entire block that follows (lines 276–279):
```css
/* Blue tile tint — glassmorphism dark mode only (positron light style base) */
html.dark [data-map-theme="glassmorphism"] canvas.maplibregl-canvas {
  filter: sepia(1) hue-rotate(195deg) saturate(4) brightness(0.35);
}
```

The `[data-map-theme="classic"]` block (lines 261–274) is untouched.

- [ ] **Step 2: Revert map style in `DeckGLMap.tsx`**

Find line 130:
```tsx
mapStyle={isDarkMode && mapTheme !== "glassmorphism" ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
```

Replace with:
```tsx
mapStyle={isDarkMode ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/index.css frontend/src/components/DeckGLMap.tsx
git commit -m "feat: amber CSS tokens, remove map filter, revert map style"
```

---

### Task 3: Filter as FAB in bottom-right stack

**Files:**
- Modify: `frontend/src/components/MapContainer3D.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/components/Filters.tsx`

The filter moves from a bottom-center absolutely positioned container in `DashboardPage` into a `filterSlot` prop rendered above the mode-FAB in `MapContainer3D`. `Filters.tsx` trigger button gets frosted-glass FAB styling and the old `isGlass` conditional logic is removed.

- [ ] **Step 1: Add `filterSlot` prop and update bottom-right stack in `MapContainer3D.tsx`**

Add `filterSlot?: React.ReactNode` to the interface and props destructure, then replace the FAB div (lines 111–119):

```tsx
// Interface addition (after minRouteCount line):
filterSlot?: React.ReactNode;
```

Props destructure (after `minRouteCount = 1,`):
```tsx
filterSlot,
```

Replace the FAB section (was a single `<div className="absolute bottom-4 right-4 z-20">`):
```tsx
{/* Bottom-right stack: filter FAB + mode FAB */}
<div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
  {filterSlot}
  <VisModeSelector
    current={visMode}
    onChange={onVisModeChange}
    isOpen={fabOpen}
    onOpenChange={setFabOpen}
  />
</div>
```

- [ ] **Step 2: Remove bottom-center filter and pass filterSlot in `DashboardPage.tsx`**

Remove this entire block (around lines 770–782):
```tsx
{visMode !== "trips" && (
  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-3xl px-4">
    <div
      className="rounded-2xl p-2 backdrop-blur-md"
      style={
        mapTheme === "glassmorphism" && isDarkMode
          ? {
              background: "rgba(15, 10, 40, 0.6)",
              border: "1px solid rgba(99, 102, 241, 0.25)",
              boxShadow: "0 8px 32px rgba(99, 102, 241, 0.12)",
            }
          : {
              background: "rgba(22,27,34,0.85)",
              border: "1px solid var(--color-border)",
            }
      }
    >
      <Filters onFilterChange={handleFilterChange} />
    </div>
  </div>
)}
```

Add `filterSlot` prop to `<MapContainer3D>` (around line 606):
```tsx
<MapContainer3D
  flights={geoFlights}
  selectedFlightId={selectedFlightId}
  onFlightClick={setSelectedFlightId}
  visMode={visMode}
  onVisModeChange={handleVisModeChange}
  minRouteCount={filters.minRouteCount ?? 1}
  filterSlot={visMode !== "trips" ? <Filters onFilterChange={handleFilterChange} /> : undefined}
/>
```

Also remove the now-unused `mapTheme` and `isDarkMode` destructure from `useThemeStore` (line ~91):
```tsx
// Remove this line entirely:
const { mapTheme, isDarkMode } = useThemeStore();
```

And remove the `useThemeStore` import if it's no longer used anywhere else in the file. Check with: `grep -n "useThemeStore\|mapTheme\|isDarkMode" frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 3: Update `Filters.tsx` trigger button to frosted-glass FAB style**

Remove the `useThemeStore` import and the `isGlass` variable (lines 8 and 19–20 after previous edits).

Replace the trigger button style (currently conditional on `isGlass`). The button always uses frosted-glass:

```tsx
<button
  onClick={() => setShowFilters(!showFilters)}
  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
  style={{
    background: "rgba(255, 255, 255, 0.06)",
    color: "var(--text-secondary, #94a3b8)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    backdropFilter: "blur(8px)",
  }}
>
```

Also update the active-filter count badge (inside the button) to use amber accent:
```tsx
{activeFilterCount() > 0 && (
  <span
    className="text-xs rounded-full w-5 h-5 flex items-center justify-center"
    style={{ background: "var(--accent)", color: "var(--bg-base)" }}
  >
    {activeFilterCount()}
  </span>
)}
```

(The badge already uses `var(--accent)` — no change needed there.)

- [ ] **Step 4: Run all tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: 121 tests pass.

- [ ] **Step 5: TypeScript + lint check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/MapContainer3D.tsx \
        frontend/src/pages/DashboardPage.tsx \
        frontend/src/components/Filters.tsx
git commit -m "feat: move filter to bottom-right FAB slot in MapContainer3D"
```

---

### Task 4: Globe night earth texture + amber atmosphere

**Files:**
- Create: `frontend/public/earth-night.jpg` (copy from node_modules)
- Create: `frontend/public/night-sky.png` (copy from node_modules)
- Modify: `frontend/src/components/GlobeView.tsx` (lines 385–387, 414–415)

The textures already exist in the `three-globe` package (a dependency of `react-globe.gl`). Copy them to `/public` so Vite can serve them.

- [ ] **Step 1: Copy textures to public/**

```bash
cp /d/Projekte/TravStats/frontend/node_modules/three-globe/example/img/earth-night.jpg \
   /d/Projekte/TravStats/frontend/public/earth-night.jpg

cp /d/Projekte/TravStats/frontend/node_modules/three-globe/example/img/night-sky.png \
   /d/Projekte/TravStats/frontend/public/night-sky.png
```

- [ ] **Step 2: Verify files exist**

```bash
ls -lh /d/Projekte/TravStats/frontend/public/earth-night.jpg \
        /d/Projekte/TravStats/frontend/public/night-sky.png
```

Expected: both files present, each > 100KB.

- [ ] **Step 3: Update Globe props in `GlobeView.tsx`**

Find the `<Globe` block (lines 382–418) and update three props:

```tsx
// Change these three lines:
globeImageUrl="/earth-night.jpg"           // was /earth-day.jpg
backgroundImageUrl="/night-sky.png"         // was null
atmosphereColor={isDarkMode ? "#e8a045" : "#3b82f6"}  // was "#4a5568" dark / "#3b82f6" light
```

The `bumpImageUrl`, `atmosphereAltitude` (already 0.25), and all other props stay unchanged.

- [ ] **Step 4: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/public/earth-night.jpg \
        frontend/public/night-sky.png \
        frontend/src/components/GlobeView.tsx
git commit -m "feat: globe night earth texture, amber atmosphere, starfield"
```

---

### Task 5: Full build verification + push

**Files:** None modified — verification only.

- [ ] **Step 1: Run full test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: 121 tests pass (26 test files).

- [ ] **Step 2: TypeScript check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Lint**

```bash
cd /d/Projekte/TravStats/frontend && npm run lint
```

Expected: no errors, no warnings.

- [ ] **Step 4: Push branch**

```bash
cd /d/Projekte/TravStats && git push origin feature/map-glassmorphism
```

Expected: branch pushed, all 4 new commits visible on remote.

---

## Summary

| Task | Files | Complexity |
|------|-------|-----------|
| 1 — Amber palette | mapTheme.ts, layerTypes.ts | Low |
| 2 — CSS tokens + revert | index.css, DeckGLMap.tsx | Low |
| 3 — Filter FAB | MapContainer3D.tsx, DashboardPage.tsx, Filters.tsx | Medium |
| 4 — Globe night | GlobeView.tsx + 2 assets | Low |
| 5 — Verification | — | Low |
