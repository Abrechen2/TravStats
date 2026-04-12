# Route/Trip Info Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the map route/trip popup as a two-stage system — compact popup on the map with full airport names and stats, plus a "Details" button that opens a rich sidebar view replacing the flight list.

**Architecture:** The existing `TripTooltip` component gets redesigned with full airport names, aggregated stats, and a details button. Two new sidebar components (`RouteDetailsSidebar` and `TripDetailsSidebar`) render inside `FlightPanel` via a new `detailView` state. The `FlightPanel` tab type is extended with `"route-details" | "trip-details"` to switch content.

**Tech Stack:** React, TypeScript, Zustand (flightSelectionStore), Framer Motion (FlightPanel animations), existing TravStats design system (CSS vars)

---

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/TripTooltip.tsx` | Modify | Compact popup with full names, stats, details button |
| `frontend/src/components/DeckGLMap.tsx` | Modify | Pass `onShowDetails` callback to TripTooltip |
| `frontend/src/components/FlightPanel.tsx` | Modify | Add `detailView` state, render detail sidebars |
| `frontend/src/components/FlightPanel/RouteDetailsSidebar.tsx` | Create | Route statistics + chronological flight list |
| `frontend/src/components/FlightPanel/TripDetailsSidebar.tsx` | Create | Trip overview + numbered legs |
| `frontend/src/store/flightSelectionStore.ts` | Modify | Add `detailMode` field |
| `frontend/src/components/MapContainer3D.tsx` | Modify | Wire `onShowDetails` from DeckGLMap to FlightPanel |

---

### Task 1: Extend FlightSelectionStore with Detail Mode

**Files:**
- Modify: `frontend/src/store/flightSelectionStore.ts`

- [ ] **Step 1: Add detailMode to the store**

```typescript
// frontend/src/store/flightSelectionStore.ts
import { create } from "zustand";
import type { Flight } from "../types";

type DetailMode = "route-details" | "trip-details" | null;

interface FlightSelectionState {
  selectedIds: string[];
  selectedFlights: Flight[];
  highlightMode: "single" | "group" | null;
  detailMode: DetailMode;
  setSelection: (flights: Flight[]) => void;
  showDetails: (flights: Flight[], mode: "route-details" | "trip-details") => void;
  clearSelection: () => void;
}

export const useFlightSelectionStore = create<FlightSelectionState>()((set) => ({
  selectedIds: [],
  selectedFlights: [],
  highlightMode: null,
  detailMode: null,
  setSelection: (flights) =>
    set({
      selectedFlights: flights,
      selectedIds: flights.map((f) => f.id),
      highlightMode: flights.length === 0 ? null : flights.length === 1 ? "single" : "group",
      detailMode: null,
    }),
  showDetails: (flights, mode) =>
    set({
      selectedFlights: flights,
      selectedIds: flights.map((f) => f.id),
      highlightMode: "group",
      detailMode: mode,
    }),
  clearSelection: () =>
    set({ selectedIds: [], selectedFlights: [], highlightMode: null, detailMode: null }),
}));
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/flightSelectionStore.ts
git commit -m "feat(map): add detailMode to flight selection store"
```

---

### Task 2: Redesign TripTooltip Compact Popup

**Files:**
- Modify: `frontend/src/components/TripTooltip.tsx`

- [ ] **Step 1: Rewrite TripTooltip with full airport names and details button**

```tsx
// frontend/src/components/TripTooltip.tsx
import { calculateDistance } from "../lib/geo";
import { useLocale } from "../hooks/useLocale";
import { formatDuration } from "../lib/formatters";
import { useTranslation } from "../hooks/useTranslation";
import { TooltipContainer } from "./TooltipContainer";
import type { Flight } from "../types";

interface TripTooltipProps {
  flights: Flight[];
  screenX: number;
  screenY: number;
  onClose: () => void;
  onShowDetails?: () => void;
  mode?: "routes" | "trip-routes";
}

function getRouteEndpoints(sorted: Flight[]): { depName: string; depIata: string; arrName: string; arrIata: string } {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    depName: first?.depName ?? first?.depIata ?? "?",
    depIata: first?.depIata ?? "?",
    arrName: last?.arrName ?? last?.arrIata ?? "?",
    arrIata: last?.arrIata ?? "?",
  };
}

function buildTripChain(sorted: Flight[]): string {
  const names: string[] = [];
  for (const f of sorted) {
    const dep = f.depName?.split(" ")[0] ?? f.depIata ?? "?";
    const arr = f.arrName?.split(" ")[0] ?? f.arrIata ?? "?";
    if (names.length === 0 || names[names.length - 1] !== dep) names.push(dep);
    if (names[names.length - 1] !== arr) names.push(arr);
  }
  return names.join(" → ");
}

function formatDateRange(sorted: Flight[], locale: string): string {
  const times = sorted
    .map((f) => (f.departureTime ? new Date(f.departureTime).getTime() : NaN))
    .filter((t) => !isNaN(t));
  if (times.length === 0) return "";
  const d1 = new Date(Math.min(...times));
  const d2 = new Date(Math.max(...times));
  const opts = (year?: boolean): Intl.DateTimeFormatOptions => ({
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
  });
  if (d1.getTime() === d2.getTime()) return d1.toLocaleDateString(locale, opts(true));
  if (d1.getFullYear() === d2.getFullYear()) {
    if (d1.getMonth() === d2.getMonth()) {
      return `${d1.getDate()}. – ${d2.toLocaleDateString(locale, opts(true))}`;
    }
    return `${d1.toLocaleDateString(locale, opts())} – ${d2.toLocaleDateString(locale, opts(true))}`;
  }
  return `${d1.toLocaleDateString(locale, opts(true))} – ${d2.toLocaleDateString(locale, opts(true))}`;
}

export function TripTooltip({
  flights,
  screenX,
  screenY,
  onClose,
  onShowDetails,
  mode = "routes",
}: TripTooltipProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard"]);

  const sorted = [...flights].sort(
    (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime(),
  );

  const tripName = sorted[0]?.trip?.name;
  const tripColor = sorted[0]?.trip?.color ?? "#f59e0b";
  const dateRange = formatDateRange(sorted, locale);

  const totalDistanceKm = sorted.reduce((sum, f) => {
    if (f.routeDistance != null) return sum + f.routeDistance;
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    }
    return sum;
  }, 0);

  const avgDurationMin = sorted.reduce((sum, f) => {
    const dur = f.durationMinutes ?? 0;
    return sum + dur;
  }, 0) / (sorted.length || 1);

  const airlines = [...new Set(sorted.map((f) => f.airline).filter(Boolean))] as string[];
  const seatClasses = [...new Set(sorted.map((f) => f.seatClass).filter(Boolean))] as string[];

  const isTrip = mode === "trip-routes";
  const { depName, depIata, arrName, arrIata } = getRouteEndpoints(sorted);

  return (
    <TooltipContainer
      screenX={screenX}
      screenY={screenY}
      borderColor={isTrip ? tripColor : "var(--accent)"}
      minWidth="280px"
      maxWidth="380px"
    >
      {/* Trip name (trip-routes only) */}
      {isTrip && tripName && (
        <div
          className="font-bold text-xs mb-1 uppercase tracking-wider"
          style={{ color: tripColor }}
        >
          {tripName}
        </div>
      )}

      {/* Route header with full airport names */}
      {isTrip ? (
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {buildTripChain(sorted)}
        </div>
      ) : (
        <div>
          <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
            {depName} ({depIata})
          </div>
          <div className="text-xs my-0.5" style={{ color: "var(--text-muted)" }}>→</div>
          <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
            {arrName} ({arrIata})
          </div>
        </div>
      )}

      {/* Separator */}
      <div className="my-2" style={{ borderTop: "1px solid var(--color-border)" }} />

      {/* Stats row 1: count + distance + avg duration */}
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {sorted.length} {sorted.length === 1 ? t("dashboard:flight") : t("dashboard:flights")}
        {totalDistanceKm > 0 && ` · ${Math.round(totalDistanceKm).toLocaleString(locale)} km`}
        {avgDurationMin > 0 && ` · Ø ${formatDuration(Math.round(avgDurationMin))}`}
      </div>

      {/* Stats row 2: date range */}
      {dateRange && (
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {dateRange}
        </div>
      )}

      {/* Stats row 3: airlines + class */}
      {(airlines.length > 0 || seatClasses.length > 0) && (
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {airlines.join(", ")}
          {seatClasses.length > 0 && ` · ${seatClasses.map((c) => c.replace("_", " ")).join(", ")}`}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-between items-center mt-3">
        {onShowDetails ? (
          <button
            type="button"
            onClick={onShowDetails}
            className="text-xs px-3 py-1.5 rounded font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {isTrip ? t("dashboard:tripDetails") : t("dashboard:routeDetails")} →
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        >
          ✕
        </button>
      </div>
    </TooltipContainer>
  );
}
```

- [ ] **Step 2: Add i18n keys**

Add to `frontend/src/i18n/locales/de/dashboard.json`:
```json
"flight": "Flug",
"flights": "Flüge",
"routeDetails": "Route-Details",
"tripDetails": "Trip-Details"
```

Add to `frontend/src/i18n/locales/en/dashboard.json`:
```json
"flight": "Flight",
"flights": "Flights",
"routeDetails": "Route Details",
"tripDetails": "Trip Details"
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TripTooltip.tsx frontend/src/i18n/
git commit -m "feat(map): redesign TripTooltip with full airport names and details button"
```

---

### Task 3: Create RouteDetailsSidebar

**Files:**
- Create: `frontend/src/components/FlightPanel/RouteDetailsSidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/FlightPanel/RouteDetailsSidebar.tsx
import { useMemo } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import { formatDuration } from "../../lib/formatters";
import type { Flight } from "../../types";

interface RouteDetailsSidebarProps {
  flights: Flight[];
  onBack: () => void;
}

export function RouteDetailsSidebar({ flights, onBack }: RouteDetailsSidebarProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard", "common"]);

  const sorted = useMemo(
    () =>
      [...flights].sort(
        (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime(),
      ),
    [flights],
  );

  const depName = sorted[0]?.depName ?? sorted[0]?.depIata ?? "?";
  const depIata = sorted[0]?.depIata ?? "?";
  const arrName = sorted[0]?.arrName ?? sorted[0]?.arrIata ?? "?";
  const arrIata = sorted[0]?.arrIata ?? "?";

  const totalDistanceKm = useMemo(() => {
    const first = sorted[0];
    if (!first) return 0;
    if (first.routeDistance != null) return first.routeDistance;
    if (first.depLat != null && first.depLon != null && first.arrLat != null && first.arrLon != null) {
      return calculateDistance(first.depLat, first.depLon, first.arrLat, first.arrLon);
    }
    return 0;
  }, [sorted]);

  const avgDurationMin = useMemo(() => {
    const durations = sorted.map((f) => f.durationMinutes ?? 0).filter((d) => d > 0);
    return durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  }, [sorted]);

  const airlineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of sorted) {
      const a = f.airline ?? "Unknown";
      counts[a] = (counts[a] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [sorted]);

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of sorted) {
      const c = f.seatClass?.replace("_", " ") ?? "Unknown";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [sorted]);

  return (
    <div className="flex flex-col h-full">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0"
        style={{ color: "var(--accent)", borderBottom: "1px solid var(--color-border)" }}
      >
        ← {t("common:buttons.back")}
      </button>

      {/* Header */}
      <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {depName}
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>↕</div>
        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {arrName}
        </div>

        <div className="mt-2 space-y-0.5">
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {Math.round(totalDistanceKm).toLocaleString(locale)} km · {sorted.length}× {t("dashboard:flown")}
          </div>
          {avgDurationMin > 0 && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Ø {formatDuration(Math.round(avgDurationMin))}
            </div>
          )}
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {airlineCounts.map(([a, n]) => `${a} (${n}×)`).join(", ")}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {classCounts.map(([c, n]) => `${c} (${n}×)`).join(", ")}
          </div>
        </div>
      </div>

      {/* Flight list header */}
      <div
        className="px-3 py-2 text-xs font-medium uppercase tracking-wider flex-shrink-0"
        style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--color-border)" }}
      >
        {t("dashboard:flightsOnRoute")}
      </div>

      {/* Flight list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((f) => (
          <div
            key={f.id}
            className="px-3 py-2 text-xs flex items-center gap-2"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span className="w-20 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
              {new Date(f.departureTime).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "2-digit" })}
            </span>
            <span className="w-16 flex-shrink-0 font-mono font-medium" style={{ color: "var(--text-primary)" }}>
              {f.flightNumber ?? "—"}
            </span>
            <span className="flex-shrink-0 font-mono" style={{ color: "var(--text-secondary)" }}>
              {f.depIata}→{f.arrIata}
            </span>
            <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
              {f.seatNumber ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys**

Add to DE `dashboard.json`: `"flightsOnRoute": "Flüge auf dieser Route"`, `"flown": "geflogen"`
Add to EN `dashboard.json`: `"flightsOnRoute": "Flights on this route"`, `"flown": "flown"`

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightPanel/RouteDetailsSidebar.tsx frontend/src/i18n/
git commit -m "feat(map): add RouteDetailsSidebar component"
```

---

### Task 4: Create TripDetailsSidebar

**Files:**
- Create: `frontend/src/components/FlightPanel/TripDetailsSidebar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/FlightPanel/TripDetailsSidebar.tsx
import { useMemo } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { calculateDistance } from "../../lib/geo";
import { formatDuration } from "../../lib/formatters";
import type { Flight } from "../../types";

interface TripDetailsSidebarProps {
  flights: Flight[];
  onBack: () => void;
}

export function TripDetailsSidebar({ flights, onBack }: TripDetailsSidebarProps): JSX.Element {
  const locale = useLocale();
  const { t } = useTranslation(["dashboard", "common"]);

  const sorted = useMemo(
    () =>
      [...flights].sort(
        (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime(),
      ),
    [flights],
  );

  const tripName = sorted[0]?.trip?.name ?? t("dashboard:trips.unnamed");
  const tripColor = sorted[0]?.trip?.color ?? "#f59e0b";

  const totalDistanceKm = useMemo(
    () =>
      sorted.reduce((sum, f) => {
        if (f.routeDistance != null) return sum + f.routeDistance;
        if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
          return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
        }
        return sum;
      }, 0),
    [sorted],
  );

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const f of sorted) {
      if (f.depIata) set.add(f.depIata.slice(0, 2)); // rough approximation
    }
    return set.size;
  }, [sorted]);

  return (
    <div className="flex flex-col h-full">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0"
        style={{ color: "var(--accent)", borderBottom: "1px solid var(--color-border)" }}
      >
        ← {t("common:buttons.back")}
      </button>

      {/* Trip header */}
      <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="font-bold text-sm" style={{ color: tripColor }}>
          {tripName}
        </div>
        <div className="mt-2 text-xs space-y-0.5" style={{ color: "var(--text-muted)" }}>
          <div>
            {sorted.length} {sorted.length === 1 ? t("dashboard:flight") : t("dashboard:flights")}
            {totalDistanceKm > 0 && ` · ${Math.round(totalDistanceKm).toLocaleString(locale)} km`}
          </div>
        </div>
      </div>

      {/* Legs header */}
      <div
        className="px-3 py-2 text-xs font-medium uppercase tracking-wider flex-shrink-0"
        style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--color-border)" }}
      >
        Legs
      </div>

      {/* Numbered legs */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((f, i) => {
          const depTime = f.departureTime
            ? new Date(f.departureTime).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
            : "";
          const arrTime = f.arrivalTime
            ? new Date(f.arrivalTime).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
            : "";
          const depDate = f.departureTime
            ? new Date(f.departureTime).toLocaleDateString(locale, { day: "2-digit", month: "short" })
            : "";

          return (
            <div
              key={f.id}
              className="px-3 py-2.5"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: tripColor, color: "white" }}
                >
                  {i + 1}
                </span>
                <span className="font-mono font-medium text-xs" style={{ color: "var(--text-primary)" }}>
                  {f.flightNumber ?? "—"}
                </span>
                <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                  {f.depIata}→{f.arrIata}
                </span>
                <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                  {f.seatNumber ?? ""}
                </span>
              </div>
              <div className="ml-7 mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {depDate} · {depTime}→{arrTime}
                {f.airline && ` · ${f.airline}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FlightPanel/TripDetailsSidebar.tsx
git commit -m "feat(map): add TripDetailsSidebar component"
```

---

### Task 5: Wire FlightPanel to Show Detail Sidebars

**Files:**
- Modify: `frontend/src/components/FlightPanel.tsx`

- [ ] **Step 1: Import new sidebars and store, add detail view rendering**

At the top of FlightPanel.tsx, add imports:

```typescript
import { RouteDetailsSidebar } from "./FlightPanel/RouteDetailsSidebar";
import { TripDetailsSidebar } from "./FlightPanel/TripDetailsSidebar";
import { useFlightSelectionStore } from "../store/flightSelectionStore";
```

Inside the component function, add:

```typescript
const { detailMode, selectedFlights: detailFlights, clearSelection } = useFlightSelectionStore();
```

Then in the JSX, after the tab bar `</div>` (line 157) and before the `{/* List */}` comment (line 159), wrap the existing list content in a conditional:

```tsx
{/* List */}
<div className="flex-1 overflow-y-auto">
  {detailMode === "route-details" && detailFlights.length > 0 ? (
    <RouteDetailsSidebar flights={detailFlights} onBack={clearSelection} />
  ) : detailMode === "trip-details" && detailFlights.length > 0 ? (
    <TripDetailsSidebar flights={detailFlights} onBack={clearSelection} />
  ) : tab === "flights" ? (
    // ... existing flights tab content (groups.map etc.) ...
  ) : (
    // ... existing trips tab content ...
  )}
</div>
```

The existing tab content stays unchanged — only the outer conditional is added.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest --run`
Expected: All 235 tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightPanel.tsx
git commit -m "feat(map): wire FlightPanel to render route/trip detail sidebars"
```

---

### Task 6: Wire DeckGLMap → TripTooltip → Store

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx`

- [ ] **Step 1: Pass onShowDetails and mode to TripTooltip**

In DeckGLMap.tsx, import the store:

```typescript
// Already imported: useFlightSelectionStore
// Add showDetails from destructuring
```

Update the TripTooltip rendering block (around line 395):

```tsx
{tooltipVisible && highlightMode === "group" && selectedFlights.length > 1 && (
  <TripTooltip
    flights={selectedFlights}
    screenX={tooltipPos.x}
    screenY={tooltipPos.y}
    mode={visMode === "trip-routes" ? "trip-routes" : "routes"}
    onClose={() => {
      clearSelection();
      setTooltipVisible(false);
      onResetTrip?.();
    }}
    onShowDetails={() => {
      setTooltipVisible(false);
      showDetails(
        selectedFlights,
        visMode === "trip-routes" ? "trip-details" : "route-details",
      );
    }}
  />
)}
```

Make sure `showDetails` is destructured from the store alongside `clearSelection` and `selectedFlights`.

- [ ] **Step 2: Ensure FlightPanel opens when details are triggered**

In the parent component that manages `FlightPanel.isOpen` (likely `DashboardPage.tsx` or `MapContainer3D.tsx`), ensure the panel opens when `detailMode` is set. Add an effect in the component that controls `isOpen`:

```typescript
const { detailMode } = useFlightSelectionStore();

useEffect(() => {
  if (detailMode) {
    setPanelOpen(true);
  }
}, [detailMode]);
```

- [ ] **Step 3: Verify build + tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest --run`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DeckGLMap.tsx frontend/src/pages/DashboardPage.tsx
git commit -m "feat(map): connect TripTooltip details button to sidebar via store"
```

---

### Task 7: Visual Testing and Polish

- [ ] **Step 1: Start dev server and test routes mode**

Run: `npm run dev`

Open http://localhost:3000, click a route arc on the map.
Verify: Popup shows full airport names, stats, "Route-Details →" button.
Click "Route-Details →" — sidebar should replace flight list with route stats + flight list.
Click "← Zurück" — flight list returns.

- [ ] **Step 2: Test trip-routes mode**

Switch to trip-routes visualization mode.
Click a trip arc.
Verify: Popup shows trip name (colored), city chain, stats, "Trip-Details →" button.
Click "Trip-Details →" — sidebar shows numbered legs with times and seats.

- [ ] **Step 3: Test edge cases**

- Click popup close (✕) — popup closes, no sidebar opens
- Click route with 1 flight — should show MapTooltip (unchanged)
- Switch vis mode while sidebar is open — sidebar should close (clearSelection)
- Resize window — tooltip positioning stays correct

- [ ] **Step 4: Run full test suite**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Run: `cd backend && npx tsc --noEmit && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(map): two-stage route/trip info popup with detail sidebar"
```
