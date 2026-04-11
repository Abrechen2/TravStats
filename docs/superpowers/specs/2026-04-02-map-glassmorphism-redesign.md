# Map Glassmorphism Redesign

**Date:** 2026-04-02
**Status:** Approved

---

## Overview

Full visual redesign of the map view in glassmorphism style. Affects map tiles, data layer colors, airport markers, the VisModeSelector (now a FAB), and all map UI elements.

Roadmap intent: users will later (separate feature) be able to switch between Glassmorphism, Neon Cyberpunk, Dark Premium, and Sci-Fi Terminal. This spec covers only the Glassmorphism implementation as the default.

---

## Architecture

### Affected Files

| File | Change |
|---|---|
| `components/DeckGLMap.tsx` | Map tile style + CSS filter class, grid overlay |
| `components/VisModeSelector.tsx` | Fully replace with FAB component |
| `components/MapContainer3D.tsx` | FAB integration, info pill, dim overlay |
| `components/layers/layerTypes.ts` | `HEATMAP_COLORS` → indigo/cyan palette |
| `components/layers/routesLayer.ts` | Third ScatterplotLayer for the outer ring |
| `components/layers/hexagonLayer.ts` | Tune `colorRange` to the new palette |
| `components/layers/heatmapLayer.ts` | Adjust color intensities (colorRange) |
| `components/layers/columnsLayer.ts` | colorRange to the new palette |
| `i18n/resources/de/map.json` | Add `visMode.contour` key |
| `i18n/resources/en/map.json` | Add `visMode.contour` key |

---

## Components

### 1. Map Tile Blue Tint

**Approach:** CSS filter on the MapLibre canvas element. The deck.gl canvas sits on a separate layer above and is unaffected.

```css
/* Nur auf MapLibre-Canvas anwenden */
.maplibre-blue-tint canvas.maplibregl-canvas {
  filter: hue-rotate(200deg) saturate(1.8) brightness(0.75);
}
```

The `maplibre-blue-tint` class is set on the `Map` wrapper div. Active in dark mode only — light mode keeps the `positron` style unchanged.

### 2. Subtle Grid Overlay

SVG pattern as an absolute `<div>` over the map, `pointer-events: none`, `opacity: 0.06`. Only visible in dark mode.

```
Grid: 40×40px, Stroke #818cf8 (indigo), Stärke 0.5px
```

### 3. Color Palette (layerTypes.ts)

Amber/orange/red → indigo/violet/cyan:

```
low:      [100, 116, 139]  → slate-500 (unverändert)
medium:   [232, 160,  69]  → [99, 102, 241]   indigo-500
high:     [249, 115,  22]  → [139, 92, 246]   violet-500
critical: [239,  68,  68]  → [34, 211, 153]   emerald-400 (Akzent)
```

Arc colors in `routesLayer.ts` use `getHeatmapColor` — they update automatically.

### 4. Airport Markers (routesLayer.ts)

Three concentric ScatterplotLayers (static):

| Layer | Radius | Color | Opacity |
|---|---|---|---|
| `routes-dot` | 2200m | `#93c5fd` (per route color) | 220 |
| `routes-ring-inner` | dynamic (3–10km) | same color | 90 |
| `routes-ring-outer` | `inner × 1.8` | same color | 35 |

> Animated pulse (rings with opacity oscillation via `useInterval`) is planned as a **follow-up**, not part of this spec.

### 5. VisModeSelector → FAB Component

`VisModeSelector.tsx` is rewritten from scratch. The interface stays identical (`current`, `onChange` props).

**Collapsed state:**
- 44×44px gradient button (`indigo-600 → indigo-400`), `border-radius: 14px`
- Icon: current mode as SVG
- Positioning: `absolute bottom-4 right-4` (changed from `top-16 right-3`)
- Badge to its left: name of the active mode (e.g. "Routen ◀"), frosted glass

**Expanded state:**
- FAB icon switches to `×` (with framer-motion rotate animation)
- List unfolds upward (`AnimatePresence` + `motion.div` with `y` animation)
- Per mode: icon button (36×36px, frosted glass) + label pill on the left
- Active mode: indigo background + glow shadow + checkmark in the label
- Click on a mode: set the mode and close

**Backdrop:**
- Absolute `div` in `MapContainer3D`, `opacity: 0` → `opacity: 1` when the FAB is open
- `background: rgba(10, 8, 30, 0.45)`, `backdrop-filter: blur(1px)`
- Click on the backdrop closes the FAB

**Keyboard:** `Escape` closes the FAB.

### 6. Info Pill (MapContainer3D.tsx)

Frosted-glass pill in the top left, showing flight count + route count:

```
[247 Flüge · 89 Routen]
```

- Only visible in `routes` mode (other modes have no route semantics)
- Flight count: `flights.length`
- Route count: from `buildRouteData(flights, minRouteCount).arcs.length`

---

## Data Flow

```
DashboardPage
  └── MapContainer3D (visMode, flights, ...)
        ├── Info pill (flights.length, route count) — routes mode only
        ├── Grid overlay (dark mode only)
        ├── DeckGLMap
        │     ├── Map (maplibre, blue-tint CSS class)
        │     └── DeckGLOverlay → Layer with new colour palette
        ├── GlobeView (unchanged)
        ├── FAB (VisModeSelector, current, onChange)
        └── Backdrop overlay (isOpen state)
```

The FAB's `isOpen` state lives in `MapContainer3D` so the backdrop above it can be controlled.

---

## i18n

Missing key in `de/map.json` and `en/map.json`:

```json
"visMode": {
  ...
  "contour": "Isolinien"   // DE
  "contour": "Contour"     // EN
}
```

---

## What Does NOT Change

- All 7 vis modes (routes, globe, heatmap, hexagon, columns, trips, contour) remain
- The GlobeView component is unchanged
- TimeSlider stays functional (visual restyling optional, not in this spec)
- Light mode: no changes (only dark mode is affected)
- Backend, API, routing: no changes

---

## Out of Scope (Roadmap)

- Animated pulse rings on airport markers
- Theme switcher (Neon Cyberpunk / Dark Premium / Sci-Fi Terminal)
- TimeSlider visual redesign
- GlobeView glassmorphism adaptation
