# Map Settings Sliders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the map panel's line-width and marker-size segmented presets with continuous sliders on both the flat map and the globe, and add a new slider for cruise-line direction-arrow size on the flat map.

**Architecture:** Add a shared `Slider` primitive to `controlPanelKit.tsx`. Change the four width/size fields in the `mapAppearance` localStorage model from enum strings to numbers (the scale value itself), with a load-time migration that coerces any legacy enum string to its old scale number. The shared `AppearanceSection` renders sliders for width/size and an optional arrow slider. The two consumers (`DeckGLMap`, `GlobeView`) hold these values as numbers and pass them straight into the deck.gl layers (no more preset→scale lookup). The cruise arrow layer gains an `arrowSizeScale` option.

**Tech Stack:** React, TypeScript (strict), deck.gl, Vitest + @testing-library/react.

## Global Constraints

- TypeScript `strict: true` — no `any` (use `unknown` + type guards).
- Double-quoted strings, Prettier printWidth 100 (existing file convention).
- Frontend user-facing copy: German primary + English mirror, updated together.
- Immutable updates — spread, no in-place mutation.
- Spec: `docs/superpowers/specs/2026-07-09-map-settings-sliders-design.md`.
- Slider ranges (step `0.1`, default `1.0`): line width min `0.3` max `2.0`; marker size min `0` max `1.6` (`0` = hidden); cruise arrow min `0` max `2.5` (`0` = arrows off).

---

### Task 1: `Slider` primitive

**Files:**
- Modify: `frontend/src/components/map/controlPanelKit.tsx`
- Test: `frontend/src/components/map/controlPanelKit.test.tsx` (new)

**Interfaces:**
- Produces: `Slider({ label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, format?: (v: number) => string }): JSX.Element` — consumed by Task 3's `AppearanceSection`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/map/controlPanelKit.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Slider } from "./controlPanelKit";

describe("Slider", () => {
  it("renders a range input with the value and formatted readout", () => {
    render(<Slider label="Stärke" value={1.4} min={0.3} max={2} step={0.1} onChange={() => {}} />);
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.value).toBe("1.4");
    expect(screen.getByText("1.4×")).toBeTruthy();
  });

  it("emits a parsed number on change", () => {
    const onChange = vi.fn();
    render(<Slider label="x" value={1} min={0} max={2} step={0.1} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("shows a custom readout via format (e.g. off at 0)", () => {
    render(
      <Slider
        label="Größe"
        value={0}
        min={0}
        max={1.6}
        step={0.1}
        onChange={() => {}}
        format={(v) => (v <= 0 ? "Aus" : `${v.toFixed(1)}×`)}
      />
    );
    expect(screen.getByText("Aus")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/controlPanelKit.test.tsx
```

Expected: FAIL — `Slider` is not exported from `controlPanelKit`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/map/controlPanelKit.tsx`, add the `Slider` component right after the `SegControl` function (after its closing brace, around line 196):

```tsx
/** A continuous range slider with a live value readout on the right.
 *  Replaces the ordinal SegControls for line width + marker/arrow size —
 *  `format` renders the readout (default "1.4×"; pass a custom one to show
 *  "Aus" at 0). */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}): JSX.Element {
  const readout = (format ?? ((v: number) => `${v.toFixed(1)}×`))(value);
  return (
    <div className="mt-1.5">
      <div
        className="mb-1 flex items-center justify-between text-[11px]"
        style={{ color: "rgba(241,245,249,0.7)" }}
      >
        <span>{label}</span>
        <span style={{ color: `rgb(${ACCENT})`, fontVariantNumeric: "tabular-nums" }}>
          {readout}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: `rgb(${ACCENT})` }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/controlPanelKit.test.tsx
```

Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/controlPanelKit.tsx frontend/src/components/map/controlPanelKit.test.tsx
git commit -m "feat(map): add Slider primitive for the control panel"
```

---

### Task 2: Cruise arrow size scaling

**Files:**
- Modify: `frontend/src/components/layers/cruiseArcsLayer.ts` (`CruiseArcBuildOptions` around line 47-52; `createCruiseArrowsLayer` around line 210-239)
- Test: `frontend/src/components/layers/cruiseArcsLayer.test.ts` (extend)

**Interfaces:**
- Produces: `CruiseArcBuildOptions.arrowSizeScale?: number` (default `1`; `0` → no arrow layer). `createCruiseArrowsLayer` now sizes arrows by `ARROW_DISPLAY_HEIGHT * arrowSizeScale`. Consumed by Task 3's `DeckGLMap` wiring.

- [ ] **Step 1: Write the failing test**

Add to the existing top-level `describe(...)` block in `frontend/src/components/layers/cruiseArcsLayer.test.ts` (append before the block's closing `});`). It reuses the file's existing `makeCruise` / `makeStop` helpers:

```ts
  it("scales the arrow size by arrowSizeScale", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArrowsLayer([cruise], new Map(), null, { arrowSizeScale: 2 });
    expect((layer as { props: { getSize: number } }).props.getSize).toBe(20);
  });

  it("defaults arrow size to the base height when no scale is given", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArrowsLayer([cruise]);
    expect((layer as { props: { getSize: number } }).props.getSize).toBe(10);
  });

  it("returns null when arrowSizeScale is 0 (arrows off)", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    expect(createCruiseArrowsLayer([cruise], new Map(), null, { arrowSizeScale: 0 })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/layers/cruiseArcsLayer.test.ts -t "arrowSizeScale"
```

Expected: FAIL — `getSize` is currently the constant `10` regardless of options, and scale `0` still returns a layer.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/layers/cruiseArcsLayer.ts`, add the option to `CruiseArcBuildOptions` (right after `arcWidthScale?: number;`, around line 49):

```ts
  /** User multiplier on cruise-arc line width (1 = default). */
  arcWidthScale?: number;
  /** User multiplier on the directional arrow size (1 = default). 0 hides arrows. */
  arrowSizeScale?: number;
```

Then in `createCruiseArrowsLayer`, replace the `if (arrows.length === 0) return null;` guard (around line 210) with a guard that also honours a zeroed scale:

```ts
  const arrowSizeScale = options.arrowSizeScale ?? 1;
  if (arrows.length === 0 || arrowSizeScale <= 0) return null;
```

And replace `getSize: ARROW_DISPLAY_HEIGHT,` (around line 233) with:

```ts
    getSize: ARROW_DISPLAY_HEIGHT * arrowSizeScale,
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/layers/cruiseArcsLayer.test.ts
```

Expected: PASS — all tests in the file, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/cruiseArcsLayer.ts frontend/src/components/layers/cruiseArcsLayer.test.ts
git commit -m "feat(map): scale cruise direction arrows by an arrowSizeScale option"
```

---

### Task 3: Continuous width/size/arrow — model, section, consumers, i18n

This task is one atomic change: the `MapAppearance` type flip from enums to numbers forces `AppearanceSection` and both consumers to change together to keep the build green, so they land in a single commit.

**Files:**
- Modify: `frontend/src/components/map/mapAppearance.ts`
- Modify: `frontend/src/components/map/controlPanelKit.tsx` (`AppearanceSection`, `DomainAppearanceState`, `AppearanceSectionProps`)
- Modify: `frontend/src/components/DeckGLMap.tsx`
- Modify: `frontend/src/components/GlobeView.tsx`
- Modify: `frontend/src/components/map/FlatMapControlPanel.tsx`
- Modify: `frontend/src/i18n/resources/de/map.json`, `frontend/src/i18n/resources/en/map.json`
- Test: `frontend/src/components/map/mapAppearance.test.ts` (new)
- Test: `frontend/src/components/map/controlPanelKit.test.tsx` (extend)

**Interfaces:**
- Consumes: `Slider` (Task 1), `CruiseArcBuildOptions.arrowSizeScale` (Task 2).
- Produces:
  - `MapAppearance.flightRouteWidth?: number`, `cruiseRouteWidth?: number`, `flightMarkerSize?: number`, `cruiseMarkerSize?: number`, `cruiseArrowScale?: number`.
  - `normalizeAppearance(raw: Record<string, unknown>): MapAppearance`.
  - `DomainAppearanceState` gains `arrowScale?: number`, `onArrowScaleChange?: (n: number) => void`.
  - `AppearanceSection` props: `routeWidth: number`, `onRouteWidthChange: (n: number) => void`, `markerSize: number`, `onMarkerSizeChange: (n: number) => void`, optional `arrowScale?: number`, `onArrowScaleChange?: (n: number) => void`, `arrowLabel?: string`.

- [ ] **Step 1: Write the failing migration test**

Create `frontend/src/components/map/mapAppearance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeAppearance } from "./mapAppearance";

describe("normalizeAppearance", () => {
  it("coerces legacy width/size enum strings to their scale numbers", () => {
    const out = normalizeAppearance({
      cruiseRouteWidth: "thick",
      flightRouteWidth: "thin",
      cruiseMarkerSize: "off",
      flightMarkerSize: "l",
    });
    expect(out.cruiseRouteWidth).toBe(1.6);
    expect(out.flightRouteWidth).toBe(0.6);
    expect(out.cruiseMarkerSize).toBe(0);
    expect(out.flightMarkerSize).toBe(1.45);
  });

  it("passes numeric values through unchanged", () => {
    const out = normalizeAppearance({ cruiseRouteWidth: 1.3, cruiseMarkerSize: 0, cruiseArrowScale: 2 });
    expect(out.cruiseRouteWidth).toBe(1.3);
    expect(out.cruiseMarkerSize).toBe(0);
    expect(out.cruiseArrowScale).toBe(2);
  });

  it("drops unrecognised width/size values (falls back to consumer default)", () => {
    const out = normalizeAppearance({ cruiseRouteWidth: "bogus" });
    expect(out.cruiseRouteWidth).toBeUndefined();
  });

  it("preserves unrelated fields", () => {
    const out = normalizeAppearance({ styleId: "dark", portColor: [1, 2, 3] });
    expect(out.styleId).toBe("dark");
    expect(out.portColor).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/mapAppearance.test.ts
```

Expected: FAIL — `normalizeAppearance` is not exported.

- [ ] **Step 3: Update the appearance model**

In `frontend/src/components/map/mapAppearance.ts`:

Remove the now-unused enum-type import (line 12 `import type { RouteWidth, MarkerSize } from "./controlPanelKit";`) entirely.

Replace the width/size fields + add the arrow field in the `MapAppearance` interface (lines 18-34 region) so the domain blocks read:

```ts
export interface MapAppearance {
  styleId?: BasemapId;
  // Flight domain
  routeColor?: [number, number, number] | null;
  flightRouteWidth?: number;
  airportColor?: [number, number, number] | null;
  flightMarkerSize?: number;
  // Cruise domain
  cruiseRouteColor?: [number, number, number] | null;
  cruiseRouteWidth?: number;
  portColor?: [number, number, number] | null;
  cruiseMarkerSize?: number;
  /** Multiplier on cruise direction-arrow size (1 = default, 0 = arrows off). */
  cruiseArrowScale?: number;
  // Layers
  showTerrain?: boolean;
  showPlaceLabels?: boolean;
  labelsMode?: LabelsMode;
}
```

Add the coercion helpers + `normalizeAppearance` just above `loadMapAppearance` (before line 64):

```ts
// Legacy blobs stored width/size as enum strings ("thin"/"m"/…). Coerce them
// to the numeric scale they used to map to, so an existing user's saved look
// survives the switch to continuous sliders. New writes are already numbers.
function widthScale(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "thin") return 0.6;
  if (v === "normal") return 1;
  if (v === "thick") return 1.6;
  return undefined;
}
function sizeScale(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "off") return 0;
  if (v === "s") return 0.7;
  if (v === "m") return 1;
  if (v === "l") return 1.45;
  return undefined;
}

/** Coerce legacy enum width/size values to numbers; leave everything else as-is. */
export function normalizeAppearance(raw: Record<string, unknown>): MapAppearance {
  const out: MapAppearance = { ...(raw as MapAppearance) };
  const fw = widthScale(raw.flightRouteWidth);
  const cw = widthScale(raw.cruiseRouteWidth);
  const fm = sizeScale(raw.flightMarkerSize);
  const cm = sizeScale(raw.cruiseMarkerSize);
  if (fw === undefined) delete out.flightRouteWidth;
  else out.flightRouteWidth = fw;
  if (cw === undefined) delete out.cruiseRouteWidth;
  else out.cruiseRouteWidth = cw;
  if (fm === undefined) delete out.flightMarkerSize;
  else out.flightMarkerSize = fm;
  if (cm === undefined) delete out.cruiseMarkerSize;
  else out.cruiseMarkerSize = cm;
  return out;
}
```

Wrap the two return sites in `loadMapAppearance` with `normalizeAppearance`. Replace the parsed-return (lines 72-78 region):

```ts
  if (raw) {
    try {
      return normalizeAppearance(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return {};
    }
  }
```

and the legacy-migration return (around line 88) — change `return migrated;` to:

```ts
  return normalizeAppearance(migrated as Record<string, unknown>);
```

- [ ] **Step 4: Run the migration test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/mapAppearance.test.ts
```

Expected: PASS — all 4 tests.

- [ ] **Step 5: Write the failing AppearanceSection test**

Add a second `describe` block to `frontend/src/components/map/controlPanelKit.test.tsx`:

```tsx
import { AppearanceSection } from "./controlPanelKit";

const baseSectionProps = {
  title: "Kreuzfahrten",
  routeLabel: "Routen",
  routeColor: null,
  routeDefault: [111, 160, 214] as [number, number, number],
  onRouteColorChange: () => {},
  routeAutoLabel: "Standard",
  widthLabel: "Stärke",
  routeWidth: 1,
  onRouteWidthChange: () => {},
  markerLabel: "Häfen",
  markerColor: null,
  markerDefault: [111, 160, 214] as [number, number, number],
  onMarkerColorChange: () => {},
  markerAutoLabel: "Auto",
  sizeLabel: "Größe",
  markerSize: 1,
  onMarkerSizeChange: () => {},
};

describe("AppearanceSection arrow slider", () => {
  it("renders the arrow slider only when arrow props are provided", () => {
    const { rerender } = render(<AppearanceSection {...baseSectionProps} />);
    expect(screen.queryByText("Pfeile")).toBeNull();

    rerender(
      <AppearanceSection
        {...baseSectionProps}
        arrowLabel="Pfeile"
        arrowScale={1}
        onArrowScaleChange={() => {}}
      />
    );
    expect(screen.getByText("Pfeile")).toBeTruthy();
  });

  it("renders width + size as sliders (range inputs)", () => {
    render(<AppearanceSection {...baseSectionProps} />);
    expect(screen.getAllByRole("slider").length).toBe(2);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/controlPanelKit.test.tsx -t "arrow slider"
```

Expected: FAIL — `AppearanceSection` still renders `SegControl`s (no `slider` role) and rejects the number-typed `routeWidth`/`markerSize` + unknown arrow props.

- [ ] **Step 7: Convert AppearanceSection to sliders + optional arrow row**

In `frontend/src/components/map/controlPanelKit.tsx`:

In `DomainAppearanceState` (around line 232-241), change the width/size field types to `number` and add the optional arrow fields:

```ts
export interface DomainAppearanceState {
  routeColor: [number, number, number] | null;
  onRouteColorChange: (c: [number, number, number] | null) => void;
  routeWidth: number;
  onRouteWidthChange: (w: number) => void;
  markerColor: [number, number, number] | null;
  onMarkerColorChange: (c: [number, number, number] | null) => void;
  markerSize: number;
  onMarkerSizeChange: (s: number) => void;
  /** Cruise-only: direction-arrow size multiplier + setter (flat map). */
  arrowScale?: number;
  onArrowScaleChange?: (n: number) => void;
}
```

In `AppearanceSectionProps` (around line 243-267), change the two width/size prop types to `number` and add the arrow props:

```ts
  widthLabel: string;
  routeWidth: number;
  onRouteWidthChange: (w: number) => void;
```

```ts
  sizeLabel: string;
  markerSize: number;
  onMarkerSizeChange: (s: number) => void;
  /** Cruise-only arrow slider — rendered only when all three are provided. */
  arrowLabel?: string;
  arrowScale?: number;
  onArrowScaleChange?: (n: number) => void;
}
```

Add the two new params to the function signature destructuring (after `onMarkerSizeChange,`):

```ts
  markerSize,
  onMarkerSizeChange,
  arrowLabel,
  arrowScale,
  onArrowScaleChange,
}: AppearanceSectionProps): JSX.Element {
```

Replace the "Route width preset" block (the `<div className="mt-1.5">…<SegControl<RouteWidth>…/></div>`, around lines 318-332) with:

```tsx
      {/* Route width slider */}
      <Slider
        label={widthLabel}
        value={routeWidth}
        min={0.3}
        max={2}
        step={0.1}
        onChange={onRouteWidthChange}
      />
```

Replace the "Marker size preset (Aus / S / M / L)" block (the `<div className="mt-1">…<SegControl<MarkerSize>…/></div>`, around lines 348-363) with the size slider plus the optional arrow slider:

```tsx
      {/* Marker size slider (0 = hidden) */}
      <div className="mt-1">
        <Slider
          label={sizeLabel}
          value={markerSize}
          min={0}
          max={1.6}
          step={0.1}
          onChange={onMarkerSizeChange}
          format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
        />
      </div>

      {/* Cruise-only: direction-arrow size slider */}
      {arrowScale != null && onArrowScaleChange && (
        <Slider
          label={arrowLabel ?? ""}
          value={arrowScale}
          min={0}
          max={2.5}
          step={0.1}
          onChange={onArrowScaleChange}
          format={(v) => (v <= 0 ? t("map:globe.panel.off") : `${v.toFixed(1)}×`)}
        />
      )}
```

- [ ] **Step 8: Run the AppearanceSection test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/controlPanelKit.test.tsx
```

Expected: PASS — Slider tests + both AppearanceSection tests.

- [ ] **Step 9: Add the `arrows` i18n key**

In `frontend/src/i18n/resources/de/map.json`, add to the `globe.panel` object (after `"widthThick": "Dick"`, keeping valid JSON):

```json
    "arrows": "Pfeile"
```

In `frontend/src/i18n/resources/en/map.json`, add to `globe.panel`:

```json
    "arrows": "Arrows"
```

- [ ] **Step 10: Update DeckGLMap consumer**

In `frontend/src/components/DeckGLMap.tsx`:

Remove `ROUTE_WIDTH_SCALE,`, `MARKER_SIZE_SCALE,`, `type RouteWidth,` and `type MarkerSize,` from the `./map/controlPanelKit` import (lines 10-14). Keep the other imports from that module.

Change the four state hooks to numbers (lines 169-190 region):

```ts
  const [flightRouteWidth, setFlightRouteWidth] = useState<number>(
    () => loadMapAppearance().flightRouteWidth ?? 1
  );
```
```ts
  const [flightMarkerSize, setFlightMarkerSize] = useState<number>(
    () => loadMapAppearance().flightMarkerSize ?? 1
  );
```
```ts
  const [cruiseRouteWidth, setCruiseRouteWidth] = useState<number>(
    () => loadMapAppearance().cruiseRouteWidth ?? 1
  );
```
```ts
  const [cruiseMarkerSize, setCruiseMarkerSize] = useState<number>(
    () => loadMapAppearance().cruiseMarkerSize ?? 1
  );
```

Add the arrow state right after `cruiseMarkerSize` (after line 190):

```ts
  const [cruiseArrowScale, setCruiseArrowScale] = useState<number>(
    () => loadMapAppearance().cruiseArrowScale ?? 1
  );
```

Add `cruiseArrowScale` to the `saveMapAppearance({...})` object (after `cruiseMarkerSize,` around line 210) and to its dependency array (after `cruiseMarkerSize,` around line 224):

```ts
      cruiseMarkerSize,
      cruiseArrowScale,
```
```ts
    cruiseMarkerSize,
    cruiseArrowScale,
```

Pass the flight scales straight through (lines 576-577):

```ts
              markerSizeScale: flightMarkerSize,
              arcWidthScale: flightRouteWidth,
```

Update `cruiseArcAppearance` (lines 603-608) to pass the cruise width + arrow scale:

```ts
    const cruiseArcAppearance = {
      zoom,
      arcColor: cruiseRouteColor ?? undefined,
      arcWidthScale: cruiseRouteWidth,
      arrowSizeScale: cruiseArrowScale,
      colorMode: cruiseColorMode,
    };
```

Pass the port size straight through (line 627):

```ts
      portSizeScale: cruiseMarkerSize,
```

Add the arrow slider props to the cruise appearance object passed to the panel (lines 788-797), right after `onMarkerSizeChange: setCruiseMarkerSize,`:

```ts
            markerSize: cruiseMarkerSize,
            onMarkerSizeChange: setCruiseMarkerSize,
            arrowScale: cruiseArrowScale,
            onArrowScaleChange: setCruiseArrowScale,
```

- [ ] **Step 11: Wire the arrow slider label through FlatMapControlPanel**

In `frontend/src/components/map/FlatMapControlPanel.tsx`, add the three arrow props to the **cruise** `AppearanceSection` only (after `onMarkerSizeChange={cruiseAppearance.onMarkerSizeChange}`, around line 208):

```tsx
              markerSize={cruiseAppearance.markerSize}
              onMarkerSizeChange={cruiseAppearance.onMarkerSizeChange}
              arrowLabel={t("map:globe.panel.arrows")}
              arrowScale={cruiseAppearance.arrowScale}
              onArrowScaleChange={cruiseAppearance.onArrowScaleChange}
```

(The flight `AppearanceSection` gets no arrow props, so it renders no arrow slider.)

- [ ] **Step 12: Update GlobeView consumer**

In `frontend/src/components/GlobeView.tsx`:

Remove `ROUTE_WIDTH_SCALE,`, `MARKER_SIZE_SCALE,`, `type RouteWidth,`, `type MarkerSize,` from the `./map/controlPanelKit` import (lines 29-33). Keep the rest.

Change the four state hooks to numbers (lines 366-389 region), matching DeckGLMap's pattern:

```ts
  const [flightRouteWidth, setFlightRouteWidth] = useState<number>(
    () => loadMapAppearance().flightRouteWidth ?? 1
  );
```
```ts
  const [flightMarkerSize, setFlightMarkerSize] = useState<number>(
    () => loadMapAppearance().flightMarkerSize ?? 1
  );
```
```ts
  const [cruiseRouteWidth, setCruiseRouteWidth] = useState<number>(
    () => loadMapAppearance().cruiseRouteWidth ?? 1
  );
```
```ts
  const [cruiseMarkerSize, setCruiseMarkerSize] = useState<number>(
    () => loadMapAppearance().cruiseMarkerSize ?? 1
  );
```

Pass the scales straight through in the layer builder (lines 1397-1402):

```ts
        arcWidthScale: flightRouteWidth,
        cruiseArcWidthScale: cruiseRouteWidth,
        airportColor: airportColor ?? DEFAULT_AIRPORT_COLOR,
        portColor: portColor ?? DEFAULT_PORT_COLOR,
        airportRadius: GLOBE_MARKER_BASE_PX * flightMarkerSize,
        portRadius: GLOBE_MARKER_BASE_PX * cruiseMarkerSize,
```

(The globe passes no arrow props to `AppearanceSection`, so it shows no arrow slider — the globe does not render cruise arrows.)

- [ ] **Step 13: Verify the whole frontend compiles, lints, and tests green**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: no `tsc`/`lint` output; all vitest files pass, including `controlPanelKit.test.tsx`, `mapAppearance.test.ts`, and `cruiseArcsLayer.test.ts`.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/components/map/mapAppearance.ts frontend/src/components/map/mapAppearance.test.ts frontend/src/components/map/controlPanelKit.tsx frontend/src/components/map/controlPanelKit.test.tsx frontend/src/components/DeckGLMap.tsx frontend/src/components/GlobeView.tsx frontend/src/components/map/FlatMapControlPanel.tsx frontend/src/i18n/resources/de/map.json frontend/src/i18n/resources/en/map.json
git commit -m "feat(map): continuous width/size sliders + cruise-arrow slider"
```

---

### Task 4: Verification and browser smoke

**Files:** none (verification only).

**Interfaces:** none — terminal task.

- [ ] **Step 1: Full frontend build checks**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: clean `tsc`/`lint`; all vitest files pass.

- [ ] **Step 2: Manual smoke on the dev server**

With the worktree dev servers running (backend `8000`, frontend `3000`; `admin`/`admin123`), open the dashboard flat map ("Übersicht") and the panel's **Kreuzfahrten** section. Confirm:
- **Stärke** and **Größe** are now sliders with a live `1.4×` / `Aus` readout; dragging changes cruise line width / port size live.
- A new **Pfeile** slider appears in the Kreuzfahrten section; dragging it resizes the cruise direction arrows, and `0` (Aus) removes them.
- Switch to the **Globus** mode: **Stärke** / **Größe** are sliders there too, and there is **no** Pfeile slider.
- Reload the page: the slider positions persist (localStorage).

- [ ] **Step 3: Push the branch**

```bash
git push origin dev/v2.3
```

## Self-review notes

- Spec coverage: Slider (T1), arrow scaling (T2), model+migration+section+consumers+i18n (T3), verification+smoke (T4). All spec sections mapped.
- The `MapAppearance` enum→number flip and its dependents (`AppearanceSection`, `DeckGLMap`, `GlobeView`, `FlatMapControlPanel`) are intentionally one commit (Task 3) because a partial change breaks `tsc`.
- `RouteWidth`/`MarkerSize` types + `ROUTE_WIDTH_SCALE`/`MARKER_SIZE_SCALE`/`ROUTE_WIDTHS`/`MARKER_SIZES` in `controlPanelKit.tsx` become unused after Task 3 but are exported, so eslint won't flag them; leaving them is harmless (legacy reference). Removing them is optional and out of scope.
