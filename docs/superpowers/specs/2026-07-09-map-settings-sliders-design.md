# Map Settings: Continuous Sliders + Cruise-Arrow Slider — Design

**Date:** 2026-07-09
**Branch:** dev/v2.3 (worktree all-view-colors)
**Status:** Approved design, ready for implementation plan

## Goal

Replace the ordinal segmented controls in the map settings panel (line **Stärke**
`Dünn/Normal/Dick`, marker **Größe** `Aus/S/M/L`) with **continuous sliders**, and
add a **new slider for cruise-line direction-arrow size**. The panel controls are a
single shared component used by both the flat 2D map and the globe, so the slider
conversion applies to both surfaces.

## Decisions (from brainstorming)

1. **Continuous sliders**, not snap-to-preset. Presets are replaced by free 0→max
   values. Marker `0` = hidden.
2. **Convert:** line width (Stärke) + marker size (Größe). **Keep segmented:**
   Beschriftungen (labels `Aus/Wichtige/Alle` — a 3-way mode, not a magnitude) and
   the basemap grid.
3. **Both surfaces:** width + size sliders render on flat map **and** globe (shared
   `AppearanceSection`).
4. **New cruise-arrow slider:** flat-map dashboard, cruise section only. The globe
   does not render cruise arrows, so its panel omits the arrow props (no dead
   control).
5. **Marker "Aus":** slider `0` at far-left = hidden, readout shows "Aus". No
   separate off-toggle.
6. **Live value readout:** each slider shows its current multiplier (`1.4×`) or
   "Aus" at 0.

## Non-goals

- Beschriftungen (labels mode) and basemap stay as segmented controls.
- `CruiseRouteMap` (cruise detail) and journey-mode arrows keep the default `1.0×`
  scale — the arrow slider only drives the dashboard flat map (the surface that owns
  the settings panel). A later change can thread the persisted scale into those
  surfaces if desired.
- Flight arcs have no direction arrows; the arrow slider is cruise-only.

## Architecture

### Current state (relevant seams)

- `components/map/controlPanelKit.tsx` — shared control primitives (`SegControl`,
  `Toggle`, `ColorField`) + `AppearanceSection` (one per domain, rendered by both
  panels) + the preset enums/scales:
  - `type RouteWidth = "thin"|"normal"|"thick"`, `ROUTE_WIDTH_SCALE` = `{0.6,1,1.6}`
  - `type MarkerSize = "off"|"s"|"m"|"l"`, `MARKER_SIZE_SCALE` = `{0,0.7,1,1.45}`
- `components/map/mapAppearance.ts` — shared localStorage blob (`mapAppearance.v2`)
  storing `flightRouteWidth`/`cruiseRouteWidth: RouteWidth`,
  `flightMarkerSize`/`cruiseMarkerSize: MarkerSize`, `labelsMode`, colours, basemap.
- `components/DeckGLMap.tsx` + `components/GlobeView.tsx` — hold the four
  width/size values in `useState`, translate them through the scale maps, and pass
  them into the layers and into `AppearanceSection`.
- `components/layers/cruiseArcsLayer.ts` — `createCruiseArrowsLayer` renders an
  `IconLayer` with a **fixed** `getSize: ARROW_DISPLAY_HEIGHT` (pixels).
  `CruiseArcBuildOptions` already carries `arcColor`, `arcWidthScale`, `colorMode`.
- `components/map/FlatMapControlPanel.tsx` + `components/Globe/GlobeControlPanel.tsx`
  — compose `AppearanceSection` per enabled domain.

### Target changes

**A. `controlPanelKit.tsx`**
- Add a `Slider` component: styled `<input type="range">` + label + live value
  readout. Props: `{ label, value, min, max, step, onChange, format? }`.
  `format(value)` defaults to `` `${value.toFixed(1)}×` `` and returns the "Aus"
  string when `value === 0` (caller passes the localized "Aus" via `format`).
- `AppearanceSection`:
  - `routeWidth`/`markerSize` prop types become `number`; the two `SegControl`s are
    replaced by `Slider`s.
  - Add **optional** arrow row: props `arrowScale?: number`,
    `onArrowScaleChange?: (n: number) => void`, `arrowLabel?: string`. Rendered only
    when both `arrowScale != null` and `onArrowScaleChange` are provided.
  - `DomainAppearanceState` gains optional `arrowScale?`/`onArrowScaleChange?`.
- Keep `RouteWidth`/`MarkerSize` types + `ROUTE_WIDTH_SCALE`/`MARKER_SIZE_SCALE`
  exported **only** for the migration in `mapAppearance.ts`. Remove `ROUTE_WIDTHS`/
  `MARKER_SIZES` arrays and the width/size `SegControl` option lists.

**B. `mapAppearance.ts`**
- `MapAppearance` field types: `flightRouteWidth`, `cruiseRouteWidth`,
  `flightMarkerSize`, `cruiseMarkerSize` → `number`. Add `cruiseArrowScale?: number`.
- `normalizeAppearance(raw): MapAppearance` — coerces any legacy string enum in the
  four fields to its scale number via `ROUTE_WIDTH_SCALE`/`MARKER_SIZE_SCALE`;
  numbers pass through unchanged; missing stays undefined. Applied inside
  `loadMapAppearance()` after JSON parse and after the legacy-blob migration, so both
  old `v2` blobs (enum strings) and new writes (numbers) load correctly. No key bump.

**C. Slider ranges** (step `0.1`, default `1.0`)
| Field | min | max | 0 = |
|---|---|---|---|
| line width (Stärke) | 0.3 | 2.0 | (min visible) |
| marker size (Größe) | 0 | 1.6 | Aus (hidden) |
| cruise arrow (Pfeile) | 0 | 2.5 | Aus (arrows off) |

**D. `cruiseArcsLayer.ts`**
- `CruiseArcBuildOptions` gains `arrowSizeScale?: number` (default `1`).
- `createCruiseArrowsLayer`: `getSize: ARROW_DISPLAY_HEIGHT * (options.arrowSizeScale ?? 1)`.
- When `arrowSizeScale === 0`: return `null` (no arrow layer at all).

**E. `DeckGLMap.tsx`**
- Four `useState<RouteWidth|MarkerSize>` → `useState<number>`; defaults `1`
  (init from `loadMapAppearance()` numbers, already normalized).
- Drop `ROUTE_WIDTH_SCALE[…]` / `MARKER_SIZE_SCALE[…]` wrapping — pass numbers
  straight into `arcWidthScale` / `portSizeScale` / flight marker scale.
- Add `cruiseArrowScale` state (default `1`, persisted); pass
  `arrowSizeScale: cruiseArrowScale` into `createCruiseArrowsLayer`; pass
  `arrowScale`/`onArrowScaleChange` into the cruise `DomainAppearanceState`.

**F. `GlobeView.tsx`**
- Same four `useState<number>` change and scale-map removal (`arcWidthScale`,
  `portRadius = GLOBE_MARKER_BASE_PX * cruiseMarkerSize`, etc.). No arrow props.

**G. `FlatMapControlPanel.tsx`** — pass the new `arrowScale`/`onArrowScaleChange`/
`arrowLabel` through to the **cruise** `AppearanceSection` only.
`GlobeControlPanel.tsx` — unchanged (omits arrow props).

**H. i18n `map.json` (de + en)** — add `globe.panel.arrows` ("Pfeile"/"Arrows").
Reuse existing `globe.panel.off` ("Aus"/"Off") for the slider's 0 readout. Old
`widthThin/widthNormal/widthThick` + S/M/L labels become unused (left in place).

## Data flow

`localStorage(mapAppearance.v2)` → `loadMapAppearance()` → `normalizeAppearance()`
→ numeric width/size/arrow values → `DeckGLMap`/`GlobeView` state → (a) layer scale
props (`arcWidthScale`, `portSizeScale`, `arrowSizeScale`, globe `portRadius`), and
(b) `AppearanceSection` sliders → `onChange` → `setState` + `saveMapAppearance()`.

## Testing

- **`mapAppearance` normalization** (new/extended test): legacy enum blob
  `{cruiseRouteWidth:"thick", cruiseMarkerSize:"off"}` loads as
  `{cruiseRouteWidth:1.6, cruiseMarkerSize:0}`; numeric blob passes through;
  `cruiseArrowScale` absent → undefined (consumer default `1`).
- **`Slider`** (new test): renders `<input type=range>` with the value; `onChange`
  emits a parsed `number`; `format` shows "Aus" at 0.
- **`AppearanceSection`** (extend/new): arrow slider present only when arrow props
  passed; absent otherwise (globe path).
- **`createCruiseArrowsLayer`** (extend existing cruiseArcs tests): `getSize` equals
  `ARROW_DISPLAY_HEIGHT * scale` for scale `1` and `2`; returns `null` at scale `0`.

## Files touched

- `frontend/src/components/map/controlPanelKit.tsx`
- `frontend/src/components/map/mapAppearance.ts`
- `frontend/src/components/layers/cruiseArcsLayer.ts`
- `frontend/src/components/DeckGLMap.tsx`
- `frontend/src/components/GlobeView.tsx`
- `frontend/src/components/map/FlatMapControlPanel.tsx`
- `frontend/src/i18n/resources/{de,en}/map.json`
- Tests: `mapAppearance.test.ts` (new/extend), `controlPanelKit`/`Slider` test (new),
  `cruiseArcsLayer` arrow tests (extend)

## Risks

- **Shared component** — width/size sliders change the globe panel too (intended).
  Verify both panels after the change.
- **localStorage migration** — an existing user's saved enum look must map to the
  same visual scale. Covered by the normalization test.
- **Marker "Aus" at 0** — confirm airport/port radius 0 fully hides markers on both
  flat map and globe (matches old "off" which used scale 0).
