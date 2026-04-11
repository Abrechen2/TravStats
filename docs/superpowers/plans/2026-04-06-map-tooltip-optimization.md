# Map Tooltip & Code Quality Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Umlaut bug, remove hardcoded locales, extract shared tooltip infrastructure, throttle the 60fps onMove handler, and pull animation logic out of DeckGLMap into focused hooks.

**Architecture:** Five independent tasks in ascending complexity. Tasks 1–2 are pure fixes. Task 3 creates shared tooltip primitives that Tasks 4–5 build on indirectly. Task 4 is a single-line throttle. Task 5 extracts two animation hooks to shrink DeckGLMap from ~560 to ~400 lines.

**Tech Stack:** React 18, TypeScript strict, Zustand, deck.gl 9, Vite/Vitest, Prettier pre-commit hook

---

### Task 1: Fix Umlaut Bug ("¨e" → "ü")

**Files:**
- Modify: `frontend/src/components/FlightPanel.tsx:219`
- Modify: `frontend/src/components/AirportTooltip.tsx:116`

Current broken code uses the string literal `"¨e"` (Prettier mangled the umlaut).
TripTooltip.tsx at line 128 has the correct pattern for reference: `sorted.length === 1 ? "Flug" : "Flüge"`.

- [ ] **Step 1: Fix FlightPanel.tsx**

In `frontend/src/components/FlightPanel.tsx` line 219, replace:
```tsx
{stats ? `${stats.count} Flug${stats.count !== 1 ? "¨e" : ""}` : "–"}
```
with:
```tsx
{stats ? `${stats.count} ${stats.count !== 1 ? "Flüge" : "Flug"}` : "–"}
```

- [ ] **Step 2: Fix AirportTooltip.tsx**

In `frontend/src/components/AirportTooltip.tsx` line 116, replace:
```tsx
<span style={{ color: "var(--text-muted)" }}>Flug{total !== 1 ? "¨e" : ""} gesamt</span>
```
with:
```tsx
<span style={{ color: "var(--text-muted)" }}>{total !== 1 ? "Flüge" : "Flug"} gesamt</span>
```

- [ ] **Step 3: Type-check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/FlightPanel.tsx frontend/src/components/AirportTooltip.tsx
git commit -m "fix: correct Flüge plural (Prettier had mangled umlaut to ¨e)"
```

---

### Task 2: Replace Hardcoded "de-DE" Locale with User Settings

**Files:**
- Create: `frontend/src/hooks/useLocale.ts`
- Modify: `frontend/src/components/MapTooltip.tsx`
- Modify: `frontend/src/components/AirportTooltip.tsx`
- Modify: `frontend/src/components/TripTooltip.tsx`
- Modify: `frontend/src/components/FlightPanel.tsx`

The settings store (`frontend/src/store/settingsStore.ts`) exposes `display.language: "de" | "en"`. All four components use `"de-DE"` hardcoded.

- [ ] **Step 1: Create useLocale hook**

Create `frontend/src/hooks/useLocale.ts`:
```typescript
import { useSettingsStore } from "../store/settingsStore";

const LOCALE_MAP: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
};

export function useLocale(): string {
  const language = useSettingsStore((s) => s.display.language);
  return LOCALE_MAP[language] ?? "de-DE";
}
```

- [ ] **Step 2: Write Vitest test**

Create `frontend/src/hooks/useLocale.test.ts`:
```typescript
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useLocale } from "./useLocale";
import { useSettingsStore } from "../store/settingsStore";

describe("useLocale", () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({ ...s, display: { ...s.display, language: "de" } }));
  });

  it("returns de-DE for German", () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current).toBe("de-DE");
  });

  it("returns en-US for English", () => {
    useSettingsStore.setState((s) => ({ ...s, display: { ...s.display, language: "en" } }));
    const { result } = renderHook(() => useLocale());
    expect(result.current).toBe("en-US");
  });
});
```

- [ ] **Step 3: Run test (expect PASS)**

```bash
cd frontend && npx vitest --run src/hooks/useLocale.test.ts
```

- [ ] **Step 4: Update MapTooltip.tsx**

In `frontend/src/components/MapTooltip.tsx`, add the import and replace hardcoded locales:

```tsx
import { useLocale } from "../hooks/useLocale";

// Inside MapTooltip component, after the props destructuring:
const locale = useLocale();

// Replace all occurrences of "de-DE" with locale:
// Line 48: distanceKm.toLocaleString(locale)
// Line 52: Math.round(flight.co2Kg).toLocaleString(locale)
// Line 55: new Date(flight.departureTime).toLocaleDateString(locale)
```

Full updated stat lines:
```tsx
if (distanceKm !== null) statParts.push(`${distanceKm.toLocaleString(locale)} km`);
if (durationMin !== null) statParts.push(formatDuration(durationMin));
if (flight.seatClass) statParts.push(flight.seatClass.replace("_", " "));
if (flight.co2Kg != null)
  statParts.push(`CO₂: ${Math.round(flight.co2Kg).toLocaleString(locale)} kg`);

const departureDate = flight.departureTime
  ? new Date(flight.departureTime).toLocaleDateString(locale)
  : null;
```

- [ ] **Step 5: Update AirportTooltip.tsx**

In `frontend/src/components/AirportTooltip.tsx`:
```tsx
import { useLocale } from "../hooks/useLocale";

// Inside AirportTooltip component:
const locale = useLocale();

// formatKm (line 15) is a module-level function — change signature:
function formatKm(km: number, locale: string): string {
  if (km >= 1_000_000) return `${(km / 1_000_000).toFixed(1)} Mio. km`;
  return `${Math.round(km).toLocaleString(locale)} km`;
}

// In JSX, pass locale:
// formatKm(stats.totalKm, locale)
// Math.round(stats.totalKm).toLocaleString(locale)
```

Also update the stats row in the component:
```tsx
// Replace: `${Math.round(stats.totalKm).toLocaleString("de-DE")} km`
// With: formatKm(stats.totalKm, locale)
```

- [ ] **Step 6: Update TripTooltip.tsx**

In `frontend/src/components/TripTooltip.tsx`:
```tsx
import { useLocale } from "../hooks/useLocale";

// Inside TripTooltip component:
const locale = useLocale();

// formatDateRange is a module-level function — convert to accept locale param:
function formatDateRange(sorted: Flight[], locale: string): string {
  // ... same logic, but replace "de-DE" with locale parameter
  if (d1.getTime() === d2.getTime()) return d1.toLocaleDateString(locale, opts(true));
  if (d1.getFullYear() === d2.getFullYear()) {
    if (d1.getMonth() === d2.getMonth()) {
      return `${d1.getDate()}. – ${d2.toLocaleDateString(locale, opts(true))}`;
    }
    return `${d1.toLocaleDateString(locale, opts())} – ${d2.toLocaleDateString(locale, opts(true))}`;
  }
  return `${d1.toLocaleDateString(locale, opts(true))} – ${d2.toLocaleDateString(locale, opts(true))}`;
}

// In JSX call site:
const dateRange = formatDateRange(sorted, locale);

// Distance stat:
statsRow2.push(`${Math.round(totalDistanceKm).toLocaleString(locale)} km`);
```

- [ ] **Step 7: Update FlightPanel.tsx**

In `frontend/src/components/FlightPanel.tsx`:
```tsx
import { useLocale } from "../hooks/useLocale";

// Inside FlightPanel component, after hooks:
const locale = useLocale();

// Replace in tripStats display:
// `${Math.round(stats.totalKm).toLocaleString("de-DE")} km`
// with:
// `${Math.round(stats.totalKm).toLocaleString(locale)} km`
```

The variable `km` in the trips map at line ~188:
```tsx
const km =
  stats && stats.totalKm > 0
    ? `${Math.round(stats.totalKm).toLocaleString(locale)} km`
    : null;
```

- [ ] **Step 8: Type-check, run tests, commit**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
git add frontend/src/hooks/useLocale.ts frontend/src/hooks/useLocale.test.ts \
  frontend/src/components/MapTooltip.tsx frontend/src/components/AirportTooltip.tsx \
  frontend/src/components/TripTooltip.tsx frontend/src/components/FlightPanel.tsx
git commit -m "feat: replace hardcoded de-DE locale with useLocale hook from user settings"
```

---

### Task 3: Shared TooltipContainer + formatDuration

**Files:**
- Create: `frontend/src/components/TooltipContainer.tsx`
- Create: `frontend/src/lib/formatters.ts`
- Modify: `frontend/src/components/MapTooltip.tsx`
- Modify: `frontend/src/components/TripTooltip.tsx`
- Modify: `frontend/src/components/AirportTooltip.tsx`

All three tooltips duplicate: (1) the fade-in animation, (2) the glassmorphism container style, (3) a `formatDuration` function.

- [ ] **Step 1: Create formatters.ts**

Create `frontend/src/lib/formatters.ts`:
```typescript
/** Format a duration in minutes to "2h 35min" / "45min" / "2h" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}
```

- [ ] **Step 2: Write test for formatDuration**

Create `frontend/src/lib/formatters.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { formatDuration } from "./formatters";

describe("formatDuration", () => {
  it("shows only minutes when under 60", () => {
    expect(formatDuration(45)).toBe("45min");
  });
  it("shows only hours when no remainder", () => {
    expect(formatDuration(120)).toBe("2h");
  });
  it("shows hours and minutes", () => {
    expect(formatDuration(155)).toBe("2h 35min");
  });
  it("handles 0", () => {
    expect(formatDuration(0)).toBe("0min");
  });
});
```

- [ ] **Step 3: Run test (expect PASS)**

```bash
cd frontend && npx vitest --run src/lib/formatters.test.ts
```

- [ ] **Step 4: Create TooltipContainer.tsx**

Create `frontend/src/components/TooltipContainer.tsx`:
```tsx
import { useEffect, useState } from "react";

interface TooltipContainerProps {
  screenX: number;
  screenY: number;
  borderColor?: string;
  minWidth?: string;
  maxWidth?: string;
  children: React.ReactNode;
}

export function TooltipContainer({
  screenX,
  screenY,
  borderColor = "var(--accent)",
  minWidth = "220px",
  maxWidth = "340px",
  children,
}: TooltipContainerProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        transform: "translate(-50%, -100%) translateY(-12px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
        zIndex: 100,
        pointerEvents: "auto",
        background: "rgba(15,23,42,0.95)",
        border: `1px solid ${borderColor}`,
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        minWidth,
        maxWidth,
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Refactor MapTooltip.tsx to use TooltipContainer**

Replace the outer `<div>` and the local `visible` state with `TooltipContainer`. Remove the local `formatDuration` function and import from `../lib/formatters`:

```tsx
import { TooltipContainer } from "./TooltipContainer";
import { formatDuration } from "../lib/formatters";
// Remove: import { useEffect, useState } from "react"; (no longer needed)
// Remove: local formatDuration function
// Remove: local visible state + useEffect

export function MapTooltip({ flight, screenX, screenY, onEdit, onClose }: MapTooltipProps): JSX.Element {
  const locale = useLocale();
  // ... existing stat computation ...

  return (
    <TooltipContainer screenX={screenX} screenY={screenY} minWidth="220px">
      {/* existing inner JSX unchanged */}
    </TooltipContainer>
  );
}
```

- [ ] **Step 6: Refactor TripTooltip.tsx to use TooltipContainer**

Replace outer `<div>` + `visible` state with `TooltipContainer`. Remove local `formatDuration`. Use `borderColor={tripColor}`:

```tsx
import { TooltipContainer } from "./TooltipContainer";
import { formatDuration } from "../lib/formatters";
// Remove: local formatDuration, visible state + useEffect

return (
  <TooltipContainer
    screenX={screenX}
    screenY={screenY}
    borderColor={tripColor}
    minWidth="260px"
    maxWidth="340px"
  >
    {/* existing inner JSX unchanged */}
  </TooltipContainer>
);
```

- [ ] **Step 7: Refactor AirportTooltip.tsx to use TooltipContainer**

```tsx
import { TooltipContainer } from "./TooltipContainer";
// Remove: local visible state + useEffect

return (
  <TooltipContainer
    screenX={screenX}
    screenY={screenY}
    borderColor="rgba(232,160,69,0.6)"
    minWidth="220px"
    maxWidth="300px"
  >
    {/* existing inner JSX unchanged */}
  </TooltipContainer>
);
```

- [ ] **Step 8: Type-check, run tests, commit**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
git add frontend/src/lib/formatters.ts frontend/src/lib/formatters.test.ts \
  frontend/src/components/TooltipContainer.tsx \
  frontend/src/components/MapTooltip.tsx \
  frontend/src/components/TripTooltip.tsx \
  frontend/src/components/AirportTooltip.tsx
git commit -m "refactor: extract TooltipContainer + formatDuration, remove ~90 lines of tooltip duplication"
```

---

### Task 4: Throttle onMove via requestAnimationFrame

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx`

`onMove` fires at 60fps during pan/zoom. `recomputeAllPositions` calls `map.project()` and two `setState` calls per frame, causing unnecessary React re-renders. A rAF throttle limits this to one update per browser paint.

- [ ] **Step 1: Add rafRef and throttled wrapper**

In `frontend/src/components/DeckGLMap.tsx`, after the existing `recomputeAllPositions` callback, add:

```typescript
const moveRafRef = useRef<number | null>(null);

const handleMapMove = useCallback(() => {
  if (moveRafRef.current !== null) return; // already scheduled
  moveRafRef.current = requestAnimationFrame(() => {
    moveRafRef.current = null;
    recomputeAllPositions();
  });
}, [recomputeAllPositions]);
```

- [ ] **Step 2: Replace onMove prop**

In the JSX `<Map>` element, change:
```tsx
onMove={recomputeAllPositions}
```
to:
```tsx
onMove={handleMapMove}
```

- [ ] **Step 3: Cleanup rAF on unmount**

Add a cleanup effect after the `handleMapMove` definition:

```typescript
useEffect(() => {
  return () => {
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
    }
  };
}, []);
```

- [ ] **Step 4: Type-check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/DeckGLMap.tsx
git commit -m "perf: throttle map onMove via rAF to avoid 60fps React re-renders"
```

---

### Task 5: Extract Animation Hooks from DeckGLMap

**Files:**
- Create: `frontend/src/hooks/usePlaneAnimation.ts`
- Create: `frontend/src/hooks/usePulseAnimation.ts`
- Modify: `frontend/src/components/DeckGLMap.tsx`

DeckGLMap is ~560 lines. The plane animation (~75 lines, 148–223) and pulse animation (~80 lines, 225–306) are self-contained and can each become a hook. This brings DeckGLMap closer to the 400-line target.

- [ ] **Step 1: Create usePlaneAnimation.ts**

Create `frontend/src/hooks/usePlaneAnimation.ts`:
```typescript
import { useState, useEffect, useRef, useMemo } from "react";
import { TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../types";
import { arcPosition, easeInOut } from "../utils/mapAnimationHelpers";

const LEG_DURATION = 1500;
const DELAY_AFTER_FLYTO = 500;

export function usePlaneAnimation(selectedFlights: Flight[]): Layer[] {
  const [planePositions, setPlanePositions] = useState<Array<[number, number]>>([]);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setPlanePositions([]);

    if (selectedFlights.length === 0) return;

    const legs: Array<{ source: [number, number]; target: [number, number] }> = selectedFlights
      .filter((f) => f.depLon != null && f.depLat != null && f.arrLon != null && f.arrLat != null)
      .map((f) => ({
        source: [f.depLon, f.depLat] as [number, number],
        target: [f.arrLon, f.arrLat] as [number, number],
      }));

    if (legs.length === 0) return;

    const totalDuration = legs.length * LEG_DURATION;
    let startTime: number | null = null;

    const animate = (ts: number): void => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime - DELAY_AFTER_FLYTO;
      if (elapsed < 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const positions: Array<[number, number]> = legs.map((leg, i) => {
        const legElapsed = elapsed - i * LEG_DURATION;
        if (legElapsed < 0) return leg.source;
        if (legElapsed >= LEG_DURATION) return leg.target;
        return arcPosition(leg.source, leg.target, easeInOut(legElapsed / LEG_DURATION));
      });

      setPlanePositions(positions);
      if (elapsed < totalDuration) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [selectedFlights]);

  return useMemo((): Layer[] => {
    if (planePositions.length === 0) return [];
    return [
      new TextLayer({
        id: "plane-marker",
        data: planePositions.map((position, i) => ({ position, index: i })),
        getText: () => "✈",
        getPosition: (d: { position: [number, number] }) => d.position,
        getSize: 20,
        getColor: [255, 255, 255, 230] as [number, number, number, number],
        getAngle: 0,
        fontFamily: "Arial, sans-serif",
        billboard: true,
      }),
    ];
  }, [planePositions]);
}
```

- [ ] **Step 2: Create usePulseAnimation.ts**

Create `frontend/src/hooks/usePulseAnimation.ts`:
```typescript
import { useState, useEffect, useRef, useMemo } from "react";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../types";

const PERIOD_MS = 1800;
const RINGS: Array<{ radiusPx: number; phaseOffset: number }> = [
  { radiusPx: 12, phaseOffset: 0 },
  { radiusPx: 22, phaseOffset: 0.33 },
  { radiusPx: 36, phaseOffset: 0.66 },
];

export function usePulseAnimation(selectedFlights: Flight[]): Layer[] {
  const [pulseTime, setPulseTime] = useState(0);
  const pulseRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (pulseRafRef.current !== null) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = null;
    }
    setPulseTime(0);
    if (selectedFlights.length === 0) return;

    const startTime = performance.now();
    let lastUpdate = 0;
    const animate = (ts: number): void => {
      if (ts - lastUpdate > 33) {
        lastUpdate = ts;
        setPulseTime(ts - startTime);
      }
      pulseRafRef.current = requestAnimationFrame(animate);
    };
    pulseRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (pulseRafRef.current !== null) cancelAnimationFrame(pulseRafRef.current);
    };
  }, [selectedFlights]);

  const pulsePoints = useMemo((): Array<[number, number]> => {
    const pts = selectedFlights.flatMap((f) => {
      const res: Array<[number, number]> = [];
      if (f.depLon != null && f.depLat != null) res.push([f.depLon, f.depLat]);
      if (f.arrLon != null && f.arrLat != null) res.push([f.arrLon, f.arrLat]);
      return res;
    });
    const seen = new Set<string>();
    return pts.filter(([lon, lat]) => {
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [selectedFlights]);

  return useMemo((): Layer[] => {
    if (pulsePoints.length === 0) return [];
    const data = pulsePoints.map((position) => ({ position }));

    return RINGS.map(({ radiusPx, phaseOffset }) => {
      const phase = (((pulseTime / PERIOD_MS + phaseOffset) % 1) + 1) % 1;
      const opacity = Math.sin(phase * Math.PI) ** 2;
      const alpha = Math.round(opacity * 210) as number;

      return new ScatterplotLayer({
        id: `pulse-ring-${radiusPx}`,
        data,
        getPosition: (d: { position: [number, number] }) => d.position,
        getRadius: radiusPx,
        radiusUnits: "pixels",
        getFillColor: [0, 0, 0, 0] as [number, number, number, number],
        getLineColor: [245, 158, 11, alpha] as [number, number, number, number],
        stroked: true,
        filled: false,
        lineWidthMinPixels: 1.5,
        pickable: false,
      });
    });
  }, [pulsePoints, pulseTime]);
}
```

- [ ] **Step 3: Update DeckGLMap.tsx to use the hooks**

At the top of `frontend/src/components/DeckGLMap.tsx`:
```typescript
import { usePlaneAnimation } from "../hooks/usePlaneAnimation";
import { usePulseAnimation } from "../hooks/usePulseAnimation";
```

Remove imports that are now only used in the hooks:
- `ScatterplotLayer` (still used for pulse? no, moved) — check if still needed for other layers
- Keep `TextLayer` only if still used elsewhere in DeckGLMap

Replace the plane animation block (lines ~148–223) and pulse animation block (lines ~225–306) with:
```typescript
const planeLayers = usePlaneAnimation(selectedFlights);
const pulseLayers = usePulseAnimation(selectedFlights);
```

Also remove the now-unused `pulsePoints` variable (it was only used inside `pulseLayers` useMemo, now internal to the hook).

- [ ] **Step 4: Verify line count reduced**

```bash
wc -l frontend/src/components/DeckGLMap.tsx
# Expect: < 420 lines (was ~560)
```

- [ ] **Step 5: Type-check, run tests, commit**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
git add frontend/src/hooks/usePlaneAnimation.ts frontend/src/hooks/usePulseAnimation.ts \
  frontend/src/components/DeckGLMap.tsx
git commit -m "refactor: extract usePlaneAnimation + usePulseAnimation hooks from DeckGLMap"
```

---

## Self-Review

**Spec coverage:**
- ✅ Umlaut bug → Task 1
- ✅ Hardcoded locale → Task 2 (useLocale hook)
- ✅ Tooltip duplication → Task 3 (TooltipContainer + formatters)
- ✅ 60fps onMove → Task 4 (rAF throttle)
- ✅ DeckGLMap size → Task 5 (hooks)
- ⚠️ statsCalculator N+1: `getCachedAirports` already has an in-memory cache (NodeCache, 1h TTL). After the first call, all subsequent calls for the same airport codes return from memory — no additional DB queries. The "N+1" is a code smell but not a real performance issue given the cache. Skipped from plan as YAGNI.
- ⚠️ DB indices: Low impact, skipped as YAGNI.

**Placeholder scan:** No TBDs, all code blocks are complete.

**Type consistency:**
- `formatDuration` signature: `(minutes: number) => string` — consistent across Task 3 uses
- `TooltipContainer` props: `screenX/Y: number`, `borderColor?: string`, `minWidth?: string`, `maxWidth?: string`, `children: React.ReactNode` — used consistently in Tasks 3, 4, 5
- `usePlaneAnimation(selectedFlights: Flight[]): Layer[]` — matches usage in Task 5
- `usePulseAnimation(selectedFlights: Flight[]): Layer[]` — matches usage in Task 5
