# Flight Panel & Map Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "Letzte Flüge" sidebar with a standalone `FlightPanel` component that groups connecting flights, offers quick actions per entry, and synchronises with a rich map highlight (spotlight + plane animation + tooltip) via a shared Zustand store.

**Architecture:** A new `useFlightSelectionStore` (Zustand) decouples selection state from both the panel and the map. `FlightPanel` is extracted from `DashboardPage` and owns multi-leg grouping logic. `DeckGLMap` subscribes to the store and orchestrates flyTo, spotlight, plane animation, airport pulse, and tooltip rendering.

**Tech Stack:** React 18, Zustand, deck.gl 9, MapLibre GL 5, Framer Motion, Vitest + @testing-library/react

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/store/flightSelectionStore.ts` | Zustand store — selectedIds, selectedFlights, highlightMode |
| `frontend/src/utils/groupFlights.ts` | Pure function — detect multi-leg chains from Flight[] |
| `frontend/src/components/FlightPanel.tsx` | Panel root — header, grouped list, footer |
| `frontend/src/components/FlightPanel/FlightEntry.tsx` | Single flight row + hover quick actions + inline stats toggle |
| `frontend/src/components/FlightPanel/FlightGroupItem.tsx` | Multi-leg wrapper with bracket + group footer |
| `frontend/src/components/FlightPanel/InlineStats.tsx` | Expandable stats row (distance, duration, CO₂…) |
| `frontend/src/components/FlightPanel/QuickActions.tsx` | 5-button action bar shown on hover |
| `frontend/src/components/MapTooltip.tsx` | Absolute-positioned div overlay on map canvas |
| `frontend/src/__tests__/store/flightSelectionStore.test.ts` | Store unit tests |
| `frontend/src/__tests__/utils/groupFlights.test.ts` | groupFlights unit tests |
| `frontend/src/__tests__/components/FlightPanel.test.tsx` | FlightPanel integration tests |

### Modified files
| File | What changes |
|------|-------------|
| `frontend/src/pages/DashboardPage.tsx` | Replace inline panel JSX with `<FlightPanel>`, add `handleDeleteFlight` + `handleDuplicateFlight` |
| `frontend/src/components/DeckGLMap.tsx` | Subscribe to store; add spotlight layers, flyTo, plane animation, airport pulse, MapTooltip |
| `frontend/src/components/MapContainer3D.tsx` | Remove `selectedFlightId` prop (now via store), pass `onEdit` down for tooltip |

---

## Task 1: `useFlightSelectionStore`

**Files:**
- Create: `frontend/src/store/flightSelectionStore.ts`
- Create: `frontend/src/__tests__/store/flightSelectionStore.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/__tests__/store/flightSelectionStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import type { Flight } from "../../types";

const mockFlight = (id: string): Flight => ({
  id,
  userId: "u1",
  airline: "LH",
  flightNumber: "LH404",
  depIata: "MUC",
  depLat: 48.35,
  depLon: 11.79,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T13:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
});

describe("useFlightSelectionStore", () => {
  beforeEach(() => {
    useFlightSelectionStore.setState({
      selectedIds: [],
      selectedFlights: [],
      highlightMode: null,
    });
  });

  it("initializes with empty selection", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedFlights).toEqual([]);
    expect(result.current.highlightMode).toBeNull();
  });

  it("sets single selection and highlightMode to 'single'", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    const flight = mockFlight("f1");
    act(() => result.current.setSelection(["f1"], [flight]));
    expect(result.current.selectedIds).toEqual(["f1"]);
    expect(result.current.selectedFlights).toEqual([flight]);
    expect(result.current.highlightMode).toBe("single");
  });

  it("sets group selection and highlightMode to 'group' for multiple ids", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    const f1 = mockFlight("f1");
    const f2 = mockFlight("f2");
    act(() => result.current.setSelection(["f1", "f2"], [f1, f2]));
    expect(result.current.selectedIds).toEqual(["f1", "f2"]);
    expect(result.current.highlightMode).toBe("group");
  });

  it("clearSelection resets all state", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    act(() => result.current.setSelection(["f1"], [mockFlight("f1")]));
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedFlights).toEqual([]);
    expect(result.current.highlightMode).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/__tests__/store/flightSelectionStore.test.ts
```
Expected: `Cannot find module '../../store/flightSelectionStore'`

- [ ] **Step 3: Create the store**

```typescript
// frontend/src/store/flightSelectionStore.ts
import { create } from "zustand";
import type { Flight } from "../types";

interface FlightSelectionState {
  selectedIds: string[];
  selectedFlights: Flight[];
  highlightMode: "single" | "group" | null;
  setSelection: (ids: string[], flights: Flight[]) => void;
  clearSelection: () => void;
}

export const useFlightSelectionStore = create<FlightSelectionState>()((set) => ({
  selectedIds: [],
  selectedFlights: [],
  highlightMode: null,
  setSelection: (ids, flights) =>
    set({
      selectedIds: ids,
      selectedFlights: flights,
      highlightMode: ids.length === 0 ? null : ids.length === 1 ? "single" : "group",
    }),
  clearSelection: () =>
    set({ selectedIds: [], selectedFlights: [], highlightMode: null }),
}));
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/store/flightSelectionStore.test.ts
```
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/flightSelectionStore.ts frontend/src/__tests__/store/flightSelectionStore.test.ts
git commit -m "feat: add useFlightSelectionStore for map/panel selection sync"
```

---

## Task 2: `groupFlights` utility

**Files:**
- Create: `frontend/src/utils/groupFlights.ts`
- Create: `frontend/src/__tests__/utils/groupFlights.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/__tests__/utils/groupFlights.test.ts
import { describe, it, expect } from "vitest";
import { groupFlights } from "../../utils/groupFlights";
import type { Flight } from "../../types";

function flight(
  id: string,
  depIata: string,
  arrIata: string,
  depTime: string,
  arrTime: string,
  depLat = 48.0,
  depLon = 11.0,
  arrLat = 52.0,
  arrLon = 13.0
): Flight {
  return {
    id,
    userId: "u1",
    airline: "LH",
    flightNumber: id,
    depIata,
    arrIata,
    depLat,
    depLon,
    arrLat,
    arrLon,
    departureTime: depTime,
    arrivalTime: arrTime,
    status: "flown",
    createdAt: "2024-01-01T00:00:00Z",
  };
}

describe("groupFlights", () => {
  it("returns single group for one flight", () => {
    const f = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const result = groupFlights([f]);
    expect(result).toEqual([{ type: "single", flight: f }]);
  });

  it("groups two connecting flights into multileg", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
    if (result[0].type === "multileg") {
      expect(result[0].flights).toHaveLength(2);
      expect(result[0].label).toBe("MUC → FRA → JFK");
    }
  });

  it("does NOT group flights with different connecting airport", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "LHR", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("single");
    expect(result[1].type).toBe("single");
  });

  it("does NOT group flights with gap > 12h", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T23:30:00Z", "2024-03-15T02:00:00Z");
    const result = groupFlights([leg1, leg2]);
    expect(result).toHaveLength(2);
  });

  it("groups a three-leg chain", () => {
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T08:00:00Z", "2024-03-14T09:00:00Z");
    const leg2 = flight("f2", "FRA", "LHR", "2024-03-14T11:00:00Z", "2024-03-14T11:45:00Z");
    const leg3 = flight("f3", "LHR", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const result = groupFlights([leg1, leg2, leg3]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
    if (result[0].type === "multileg") {
      expect(result[0].flights).toHaveLength(3);
      expect(result[0].label).toBe("MUC → FRA → LHR → JFK");
    }
  });

  it("sorts by departure time before grouping", () => {
    const leg2 = flight("f2", "FRA", "JFK", "2024-03-14T13:00:00Z", "2024-03-14T16:00:00Z");
    const leg1 = flight("f1", "MUC", "FRA", "2024-03-14T10:00:00Z", "2024-03-14T11:00:00Z");
    const result = groupFlights([leg2, leg1]); // intentionally reversed
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("multileg");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/__tests__/utils/groupFlights.test.ts
```
Expected: `Cannot find module '../../utils/groupFlights'`

- [ ] **Step 3: Create the utility**

```typescript
// frontend/src/utils/groupFlights.ts
import type { Flight } from "../types";

export type FlightGroup =
  | { type: "single"; flight: Flight }
  | { type: "multileg"; flights: Flight[]; label: string };

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function buildLabel(flights: Flight[]): string {
  const codes: string[] = [];
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (i === 0) codes.push(f.depIata ?? f.depIcao ?? "?");
    codes.push(f.arrIata ?? f.arrIcao ?? "?");
  }
  return codes.join(" → ");
}

function connects(a: Flight, b: Flight): boolean {
  const aArr = a.arrIata ?? a.arrIcao;
  const bDep = b.depIata ?? b.depIcao;
  if (!aArr || !bDep || aArr !== bDep) return false;
  const gapMs =
    new Date(b.departureTime).getTime() - new Date(a.arrivalTime).getTime();
  return gapMs >= 0 && gapMs <= TWELVE_HOURS_MS;
}

export function groupFlights(flights: Flight[]): FlightGroup[] {
  const sorted = [...flights].sort(
    (a, b) =>
      new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
  );

  const groups: FlightGroup[] = [];
  let i = 0;

  while (i < sorted.length) {
    const chain: Flight[] = [sorted[i]];
    while (
      i + 1 < sorted.length &&
      connects(chain[chain.length - 1], sorted[i + 1])
    ) {
      i++;
      chain.push(sorted[i]);
    }
    if (chain.length === 1) {
      groups.push({ type: "single", flight: chain[0] });
    } else {
      groups.push({
        type: "multileg",
        flights: chain,
        label: buildLabel(chain),
      });
    }
    i++;
  }

  return groups;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/utils/groupFlights.test.ts
```
Expected: 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/groupFlights.ts frontend/src/__tests__/utils/groupFlights.test.ts
git commit -m "feat: add groupFlights utility for multi-leg detection"
```

---

## Task 3: `QuickActions` component

**Files:**
- Create: `frontend/src/components/FlightPanel/QuickActions.tsx`

- [ ] **Step 1: Create component**

```typescript
// frontend/src/components/FlightPanel/QuickActions.tsx
import type { Flight } from "../../types";

interface QuickActionsProps {
  flight: Flight;
  onEdit: (flight: Flight) => void;
  onMapFocus: () => void;
  onStatsToggle: () => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
}

export function QuickActions({
  flight,
  onEdit,
  onMapFocus,
  onStatsToggle,
  onDuplicate,
  onDelete,
}: QuickActionsProps): JSX.Element {
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="flex gap-1 items-center flex-shrink-0"
      onClick={stop}
      onMouseEnter={stop}
    >
      {(
        [
          { label: "✏️", title: "Bearbeiten", onClick: () => onEdit(flight) },
          { label: "🗺️", title: "Auf Map zeigen", onClick: onMapFocus },
          { label: "📊", title: "Stats", onClick: onStatsToggle },
          { label: "📋", title: "Duplizieren", onClick: () => onDuplicate(flight) },
          { label: "🗑️", title: "Löschen", onClick: () => onDelete(flight.id) },
        ] as const
      ).map(({ label, title, onClick }) => (
        <button
          key={title}
          onClick={onClick}
          title={title}
          className="w-7 h-7 flex items-center justify-center rounded text-sm transition-colors"
          style={{ background: "var(--bg-surface)" }}
          type="button"
          aria-label={title}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write tests**

```typescript
// frontend/src/__tests__/components/QuickActions.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickActions } from "../../components/FlightPanel/QuickActions";
import type { Flight } from "../../types";

const flight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH404",
  depIata: "MUC",
  depLat: 48.35,
  depLon: 11.79,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T13:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

const noop = vi.fn();

describe("QuickActions", () => {
  it("renders 5 action buttons", () => {
    render(
      <QuickActions
        flight={flight}
        onEdit={noop}
        onMapFocus={noop}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={noop}
      />
    );
    expect(screen.getByLabelText("Bearbeiten")).toBeInTheDocument();
    expect(screen.getByLabelText("Auf Map zeigen")).toBeInTheDocument();
    expect(screen.getByLabelText("Stats")).toBeInTheDocument();
    expect(screen.getByLabelText("Duplizieren")).toBeInTheDocument();
    expect(screen.getByLabelText("Löschen")).toBeInTheDocument();
  });

  it("calls onEdit with flight when edit clicked", () => {
    const onEdit = vi.fn();
    render(
      <QuickActions
        flight={flight}
        onEdit={onEdit}
        onMapFocus={noop}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("Bearbeiten"));
    expect(onEdit).toHaveBeenCalledWith(flight);
  });

  it("calls onDelete with flightId when delete clicked", () => {
    const onDelete = vi.fn();
    render(
      <QuickActions
        flight={flight}
        onEdit={noop}
        onMapFocus={noop}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByLabelText("Löschen"));
    expect(onDelete).toHaveBeenCalledWith("f1");
  });

  it("calls onMapFocus when map button clicked", () => {
    const onMapFocus = vi.fn();
    render(
      <QuickActions
        flight={flight}
        onEdit={noop}
        onMapFocus={onMapFocus}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("Auf Map zeigen"));
    expect(onMapFocus).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/components/QuickActions.test.tsx
```
Expected: 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightPanel/QuickActions.tsx frontend/src/__tests__/components/QuickActions.test.tsx
git commit -m "feat: add QuickActions component for FlightPanel hover actions"
```

---

## Task 4: `InlineStats` component

**Files:**
- Create: `frontend/src/components/FlightPanel/InlineStats.tsx`

- [ ] **Step 1: Create component**

```typescript
// frontend/src/components/FlightPanel/InlineStats.tsx
import { calculateDistance, calculateFlightDuration } from "../../lib/geo";
import type { Flight } from "../../types";

interface InlineStatsProps {
  flight: Flight;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export function InlineStats({ flight }: InlineStatsProps): JSX.Element {
  const distanceKm =
    flight.routeDistance != null
      ? Math.round(flight.routeDistance)
      : flight.depLat != null &&
        flight.depLon != null &&
        flight.arrLat != null &&
        flight.arrLon != null
      ? Math.round(
          calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon)
        )
      : null;

  const durationMin =
    flight.departureTime && flight.arrivalTime
      ? calculateFlightDuration(flight.departureTime, flight.arrivalTime)
      : null;

  const stats: string[] = [];
  if (distanceKm !== null) stats.push(`${distanceKm.toLocaleString("de-DE")} km`);
  if (durationMin !== null) stats.push(formatDuration(durationMin));
  if (flight.seatClass)
    stats.push(flight.seatClass.replace("_", " "));
  if (flight.co2Kg != null) stats.push(`CO₂: ${flight.co2Kg.toFixed(1)}t`);
  if (flight.aircraft) stats.push(flight.aircraft);

  return (
    <div
      className="px-4 py-2 text-xs"
      style={{
        background: "var(--bg-elevated)",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--text-muted)",
      }}
    >
      {stats.join(" · ")}
    </div>
  );
}
```

- [ ] **Step 2: Write tests**

```typescript
// frontend/src/__tests__/components/InlineStats.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineStats } from "../../components/FlightPanel/InlineStats";
import type { Flight } from "../../types";

const baseFlight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH404",
  depLat: 48.35,
  depLon: 11.79,
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T19:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

describe("InlineStats", () => {
  it("shows distance derived from coordinates", () => {
    render(<InlineStats flight={baseFlight} />);
    // MUC to JFK is ~8280 km, expect some distance text
    expect(screen.getByText(/km/)).toBeInTheDocument();
  });

  it("prefers routeDistance over calculated distance", () => {
    render(<InlineStats flight={{ ...baseFlight, routeDistance: 9999 }} />);
    expect(screen.getByText(/9\.999 km/)).toBeInTheDocument();
  });

  it("shows duration", () => {
    render(<InlineStats flight={baseFlight} />);
    expect(screen.getByText(/9h 45m/)).toBeInTheDocument();
  });

  it("shows CO₂ when present", () => {
    render(<InlineStats flight={{ ...baseFlight, co2Kg: 0.9 }} />);
    expect(screen.getByText(/CO₂: 0\.9t/)).toBeInTheDocument();
  });

  it("shows aircraft when present", () => {
    render(<InlineStats flight={{ ...baseFlight, aircraft: "A350" }} />);
    expect(screen.getByText(/A350/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/components/InlineStats.test.tsx
```
Expected: 5 tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightPanel/InlineStats.tsx frontend/src/__tests__/components/InlineStats.test.tsx
git commit -m "feat: add InlineStats component for expandable flight stats row"
```

---

## Task 5: `FlightEntry` component

**Files:**
- Create: `frontend/src/components/FlightPanel/FlightEntry.tsx`

- [ ] **Step 1: Create component**

```typescript
// frontend/src/components/FlightPanel/FlightEntry.tsx
import { useState } from "react";
import type { Flight } from "../../types";
import { QuickActions } from "./QuickActions";
import { InlineStats } from "./InlineStats";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";

interface FlightEntryProps {
  flight: Flight;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
  indented?: boolean;
}

export function FlightEntry({
  flight,
  onEdit,
  onDuplicate,
  onDelete,
  indented = false,
}: FlightEntryProps): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const { selectedIds, setSelection } = useFlightSelectionStore();
  const isSelected = selectedIds.includes(flight.id);

  return (
    <div>
      <button
        type="button"
        onClick={() => setSelection([flight.id], [flight])}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-full text-left py-3 transition-colors border-b flex items-center justify-between gap-2"
        style={{
          paddingLeft: indented ? "2rem" : "1rem",
          paddingRight: "0.75rem",
          background: isSelected || hovered ? "var(--bg-elevated)" : "transparent",
          borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold truncate">
            {flight.depIata ?? flight.depIcao ?? "?"} →{" "}
            {flight.arrIata ?? flight.arrIcao ?? "?"}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {flight.departureTime
              ? new Date(flight.departureTime).toLocaleDateString("de-DE")
              : "Unbekannt"}
            {flight.flightNumber ? ` · ${flight.flightNumber}` : ""}
          </div>
        </div>
        {hovered && (
          <QuickActions
            flight={flight}
            onEdit={onEdit}
            onMapFocus={() => setSelection([flight.id], [flight])}
            onStatsToggle={() => setStatsOpen((s) => !s)}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        )}
      </button>
      {statsOpen && <InlineStats flight={flight} />}
    </div>
  );
}
```

- [ ] **Step 2: Write tests**

```typescript
// frontend/src/__tests__/components/FlightEntry.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlightEntry } from "../../components/FlightPanel/FlightEntry";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import type { Flight } from "../../types";

vi.mock("../../store/flightSelectionStore", () => {
  const setSelection = vi.fn();
  const clearSelection = vi.fn();
  return {
    useFlightSelectionStore: vi.fn(() => ({
      selectedIds: [],
      selectedFlights: [],
      highlightMode: null,
      setSelection,
      clearSelection,
    })),
  };
});

const flight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH404",
  depIata: "MUC",
  depLat: 48.35,
  depLon: 11.79,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T19:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

describe("FlightEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders route and date", () => {
    render(
      <FlightEntry
        flight={flight}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
    expect(screen.getByText(/14\.03\.2024/)).toBeInTheDocument();
  });

  it("calls setSelection on click", () => {
    const { setSelection } = useFlightSelectionStore() as { setSelection: ReturnType<typeof vi.fn> };
    render(
      <FlightEntry
        flight={flight}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(setSelection).toHaveBeenCalledWith(["f1"], [flight]);
  });

  it("shows stats when stats toggle is clicked", () => {
    render(
      <FlightEntry
        flight={flight}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    // Hover to show quick actions
    fireEvent.mouseEnter(screen.getByRole("button"));
    fireEvent.click(screen.getByLabelText("Stats"));
    expect(screen.getByText(/km/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/components/FlightEntry.test.tsx
```
Expected: 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightPanel/FlightEntry.tsx frontend/src/__tests__/components/FlightEntry.test.tsx
git commit -m "feat: add FlightEntry component with hover quick actions and inline stats"
```

---

## Task 6: `FlightGroupItem` component

**Files:**
- Create: `frontend/src/components/FlightPanel/FlightGroupItem.tsx`

- [ ] **Step 1: Create component**

```typescript
// frontend/src/components/FlightPanel/FlightGroupItem.tsx
import type { Flight } from "../../types";
import { FlightEntry } from "./FlightEntry";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import { calculateDistance } from "../../lib/geo";

interface FlightGroupItemProps {
  flights: Flight[];
  label: string;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
}

export function FlightGroupItem({
  flights,
  label,
  onEdit,
  onDuplicate,
  onDelete,
}: FlightGroupItemProps): JSX.Element {
  const { setSelection } = useFlightSelectionStore();

  const totalDistanceKm = Math.round(
    flights.reduce((sum, f) => {
      if (
        f.depLat != null &&
        f.depLon != null &&
        f.arrLat != null &&
        f.arrLon != null
      ) {
        return sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      }
      return sum;
    }, 0)
  );

  return (
    <div
      style={{
        borderLeft: "2px solid var(--accent)",
        marginLeft: "0.5rem",
      }}
    >
      {flights.map((f) => (
        <FlightEntry
          key={f.id}
          flight={f}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          indented
        />
      ))}
      <button
        type="button"
        onClick={() => setSelection(flights.map((f) => f.id), flights)}
        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--color-border)",
          color: "var(--text-muted)",
        }}
      >
        {label} · {flights.length} Legs · {totalDistanceKm.toLocaleString("de-DE")} km
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write tests**

```typescript
// frontend/src/__tests__/components/FlightGroupItem.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlightGroupItem } from "../../components/FlightPanel/FlightGroupItem";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import type { Flight } from "../../types";

const setSelection = vi.fn();
vi.mock("../../store/flightSelectionStore", () => ({
  useFlightSelectionStore: vi.fn(() => ({
    selectedIds: [],
    selectedFlights: [],
    highlightMode: null,
    setSelection,
    clearSelection: vi.fn(),
  })),
}));

const leg1: Flight = {
  id: "f1", userId: "u1", airline: "LH", flightNumber: "LH100",
  depIata: "MUC", arrIata: "FRA",
  depLat: 48.35, depLon: 11.79, arrLat: 50.03, arrLon: 8.57,
  departureTime: "2024-03-14T08:00:00Z", arrivalTime: "2024-03-14T09:00:00Z",
  status: "flown", createdAt: "2024-03-14T00:00:00Z",
};
const leg2: Flight = {
  id: "f2", userId: "u1", airline: "LH", flightNumber: "LH402",
  depIata: "FRA", arrIata: "JFK",
  depLat: 50.03, depLon: 8.57, arrLat: 40.64, arrLon: -73.78,
  departureTime: "2024-03-14T11:00:00Z", arrivalTime: "2024-03-14T14:00:00Z",
  status: "flown", createdAt: "2024-03-14T00:00:00Z",
};

describe("FlightGroupItem", () => {
  it("renders both legs", () => {
    render(
      <FlightGroupItem
        flights={[leg1, leg2]}
        label="MUC → FRA → JFK"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("MUC → FRA")).toBeInTheDocument();
    expect(screen.getByText("FRA → JFK")).toBeInTheDocument();
  });

  it("shows group label and leg count", () => {
    render(
      <FlightGroupItem
        flights={[leg1, leg2]}
        label="MUC → FRA → JFK"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/MUC → FRA → JFK/)).toBeInTheDocument();
    expect(screen.getByText(/2 Legs/)).toBeInTheDocument();
  });

  it("calls setSelection with all flight ids on footer click", () => {
    render(
      <FlightGroupItem
        flights={[leg1, leg2]}
        label="MUC → FRA → JFK"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/MUC → FRA → JFK/));
    expect(setSelection).toHaveBeenCalledWith(["f1", "f2"], [leg1, leg2]);
  });
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/components/FlightGroupItem.test.tsx
```
Expected: 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightPanel/FlightGroupItem.tsx frontend/src/__tests__/components/FlightGroupItem.test.tsx
git commit -m "feat: add FlightGroupItem component for multi-leg visual grouping"
```

---

## Task 7: `FlightPanel` component

**Files:**
- Create: `frontend/src/components/FlightPanel.tsx`
- Create: `frontend/src/__tests__/components/FlightPanel.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/__tests__/components/FlightPanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlightPanel } from "../../components/FlightPanel";
import type { Flight } from "../../types";

vi.mock("../../store/flightSelectionStore", () => ({
  useFlightSelectionStore: vi.fn(() => ({
    selectedIds: [],
    selectedFlights: [],
    highlightMode: null,
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
  })),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const flights: Flight[] = [
  {
    id: "f1", userId: "u1", airline: "LH", flightNumber: "LH404",
    depIata: "MUC", arrIata: "JFK",
    depLat: 48.35, depLon: 11.79, arrLat: 40.64, arrLon: -73.78,
    departureTime: "2024-03-14T10:00:00Z", arrivalTime: "2024-03-14T19:45:00Z",
    status: "flown", createdAt: "2024-03-14T00:00:00Z",
  },
];

describe("FlightPanel", () => {
  it("renders flight list when open", () => {
    render(
      <FlightPanel
        flights={flights}
        totalCount={42}
        isOpen={true}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
  });

  it("shows total count in header", () => {
    render(
      <FlightPanel
        flights={flights}
        totalCount={42}
        isOpen={true}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <FlightPanel
        flights={flights}
        totalCount={1}
        isOpen={false}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/__tests__/components/FlightPanel.test.tsx
```
Expected: `Cannot find module '../../components/FlightPanel'`

- [ ] **Step 3: Create FlightPanel**

```typescript
// frontend/src/components/FlightPanel.tsx
import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Flight } from "../types";
import { groupFlights } from "../utils/groupFlights";
import { FlightEntry } from "./FlightPanel/FlightEntry";
import { FlightGroupItem } from "./FlightPanel/FlightGroupItem";

interface FlightPanelProps {
  flights: Flight[];
  totalCount: number;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight) => void;
  onDelete: (flightId: string) => void;
  onAddFlight: () => void;
}

export function FlightPanel({
  flights,
  totalCount,
  isOpen,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onAddFlight,
}: FlightPanelProps): JSX.Element {
  const groups = useMemo(() => groupFlights(flights), [flights]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-30"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={{ x: -380 }}
            animate={{ x: 0 }}
            exit={{ x: -380 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-14 bottom-0 w-80 z-40 flex flex-col overflow-hidden"
            style={{
              background: "rgba(22,27,34,0.95)",
              backdropFilter: "blur(20px)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2">
                Letzte Flüge
                <span
                  className="px-1.5 py-0.5 text-xs rounded-full"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  {totalCount}
                </span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Panel schließen"
                className="text-sm transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {groups.map((group) =>
                group.type === "single" ? (
                  <FlightEntry
                    key={group.flight.id}
                    flight={group.flight}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                ) : (
                  <FlightGroupItem
                    key={group.flights[0].id}
                    flights={group.flights}
                    label={group.label}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                )
              )}
            </div>

            {/* Footer */}
            <div
              className="p-3 flex-shrink-0"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <button
                type="button"
                onClick={onAddFlight}
                className="btn-primary w-full text-sm"
              >
                + Flug hinzufügen
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/components/FlightPanel.test.tsx
```
Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FlightPanel.tsx frontend/src/__tests__/components/FlightPanel.test.tsx
git commit -m "feat: add FlightPanel component extracted from DashboardPage"
```

---

## Task 8: DashboardPage wiring

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Add `handleDeleteFlight` and `handleDuplicateFlight` handlers**

Find the `handleUpdateFlight` function in `DashboardPage.tsx` (around line 267). Add these two handlers directly after it:

```typescript
// Add after handleUpdateFlight (~line 293)
const pendingDeletes = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

const handleDeleteFlight = useCallback(
  (flightId: string) => {
    // Optimistically remove from list immediately
    setRecentFlights((prev) => prev.filter((f) => f.id !== flightId));
    setTotalFlightsCount((prev) => prev - 1);

    addToast("info", "Flug gelöscht — wird in 3s entfernt");

    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(flightId);
      try {
        await flightsApi.delete(flightId);
        loadFlights();
        const recentData = await flightsApi.getAll({
          limit: API_LIMITS.RECENT_FLIGHTS,
          offset: 0,
        });
        setRecentFlights(recentData.flights);
        setTotalFlightsCount(recentData.total);
      } catch (error) {
        logger.error("Failed to delete flight:", error);
        addToast("error", "Fehler beim Löschen des Fluges");
        // Reload to restore the flight in the list
        const recentData = await flightsApi.getAll({
          limit: API_LIMITS.RECENT_FLIGHTS,
          offset: 0,
        });
        setRecentFlights(recentData.flights);
        setTotalFlightsCount(recentData.total);
      }
    }, 3000);

    pendingDeletes.current.set(flightId, timer);
  },
  [addToast, loadFlights]
);

const handleDuplicateFlight = useCallback(
  async (flight: Flight) => {
    try {
      const { id: _id, userId: _uid, createdAt: _ca, ...rest } = flight;
      void _id; void _uid; void _ca;
      await flightsApi.create(rest as import("../types").FlightInput);
      const recentData = await flightsApi.getAll({
        limit: API_LIMITS.RECENT_FLIGHTS,
        offset: 0,
      });
      setRecentFlights(recentData.flights);
      setTotalFlightsCount(recentData.total);
      loadFlights();
      addToast("success", "Flug dupliziert");
    } catch (error) {
      logger.error("Failed to duplicate flight:", error);
      addToast("error", "Fehler beim Duplizieren");
    }
  },
  [addToast, loadFlights]
);
```

Also add the import at the top of the file:
```typescript
import { useRef, useCallback } from "react";
// (add useRef and useCallback to the existing react import)
```

And import `FlightPanel`:
```typescript
import { FlightPanel } from "../components/FlightPanel";
```

- [ ] **Step 2: Replace the inline left-panel JSX with `<FlightPanel>`**

Find the block starting at `{leftOpen && (` (around line 778) that contains the panel motion.div. Replace the entire block (the `<>` backdrop + `<motion.div>` panel up to and including their closing tags) with:

```typescript
<FlightPanel
  flights={recentFlights}
  totalCount={totalFlightsCount}
  isOpen={leftOpen}
  onClose={() => setLeftOpen(false)}
  onEdit={(flight) => setEditingFlight(flight)}
  onDuplicate={handleDuplicateFlight}
  onDelete={handleDeleteFlight}
  onAddFlight={() => setShowFlightForm(true)}
/>
```

- [ ] **Step 3: Remove `selectedFlightId` state — now owned by the store**

Find and remove: `const [selectedFlightId, setSelectedFlightId] = useState<string>();`

Remove `selectedFlightId` and `onFlightClick` props from `<MapContainer3D>` — the map will now read from the store directly. Keep `onFlightClick` wired only if MapContainer3D still needs it for the globe view (check usage).

- [ ] **Step 4: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Fix any type errors before continuing.

- [ ] **Step 5: Run existing tests**

```bash
cd frontend && npx vitest run
```
Expected: all previously passing tests still pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/components/FlightPanel.tsx
git commit -m "feat: wire FlightPanel into DashboardPage, add delete/duplicate handlers"
```

---

## Task 9: `MapTooltip` component

**Files:**
- Create: `frontend/src/components/MapTooltip.tsx`
- Create: `frontend/src/__tests__/components/MapTooltip.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// frontend/src/__tests__/components/MapTooltip.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapTooltip } from "../../components/MapTooltip";
import type { Flight } from "../../types";

const flight: Flight = {
  id: "f1", userId: "u1", airline: "Lufthansa", flightNumber: "LH404",
  depIata: "MUC", arrIata: "JFK", aircraft: "A350",
  depLat: 48.35, depLon: 11.79, arrLat: 40.64, arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z", arrivalTime: "2024-03-14T19:45:00Z",
  seatClass: "business", co2Kg: 0.9,
  status: "flown", createdAt: "2024-03-14T00:00:00Z",
};

describe("MapTooltip", () => {
  it("renders route header", () => {
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
  });

  it("renders airline and flight number", () => {
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText(/Lufthansa/)).toBeInTheDocument();
    expect(screen.getByText(/LH404/)).toBeInTheDocument();
  });

  it("renders distance and duration", () => {
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText(/km/)).toBeInTheDocument();
    expect(screen.getByText(/h.*m/)).toBeInTheDocument();
  });

  it("calls onEdit when Bearbeiten is clicked", () => {
    const onEdit = vi.fn();
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={onEdit} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("✏️ Bearbeiten"));
    expect(onEdit).toHaveBeenCalledWith(flight);
  });

  it("calls onClose when ✕ is clicked", () => {
    const onClose = vi.fn();
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && npx vitest run src/__tests__/components/MapTooltip.test.tsx
```
Expected: `Cannot find module '../../components/MapTooltip'`

- [ ] **Step 3: Create MapTooltip**

```typescript
// frontend/src/components/MapTooltip.tsx
import { useEffect, useState } from "react";
import { calculateDistance, calculateFlightDuration } from "../lib/geo";
import type { Flight } from "../types";

interface MapTooltipProps {
  flight: Flight;
  screenX: number;
  screenY: number;
  onEdit: (flight: Flight) => void;
  onClose: () => void;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export function MapTooltip({
  flight,
  screenX,
  screenY,
  onEdit,
  onClose,
}: MapTooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const distanceKm =
    flight.routeDistance != null
      ? Math.round(flight.routeDistance)
      : flight.depLat != null &&
        flight.depLon != null &&
        flight.arrLat != null &&
        flight.arrLon != null
      ? Math.round(
          calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon)
        )
      : null;

  const durationMin =
    flight.departureTime && flight.arrivalTime
      ? calculateFlightDuration(flight.departureTime, flight.arrivalTime)
      : null;

  const statParts: string[] = [];
  if (distanceKm !== null) statParts.push(`${distanceKm.toLocaleString("de-DE")} km`);
  if (durationMin !== null) statParts.push(formatDuration(durationMin));
  if (flight.seatClass) statParts.push(flight.seatClass.replace("_", " "));
  if (flight.co2Kg != null) statParts.push(`CO₂: ${flight.co2Kg.toFixed(1)}t`);

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
        border: "1px solid var(--accent)",
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        minWidth: "220px",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="font-mono font-bold text-sm" style={{ color: "var(--accent)" }}>
        {flight.depIata ?? flight.depIcao ?? "?"} →{" "}
        {flight.arrIata ?? flight.arrIcao ?? "?"}
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        {[
          flight.airline,
          flight.flightNumber,
          flight.aircraft,
          flight.departureTime
            ? new Date(flight.departureTime).toLocaleDateString("de-DE")
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {statParts.length > 0 && (
        <div className="text-xs mt-1.5" style={{ color: "var(--text-secondary)" }}>
          {statParts.join(" · ")}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => onEdit(flight)}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: "var(--accent)", color: "white" }}
        >
          ✏️ Bearbeiten
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/components/MapTooltip.test.tsx
```
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapTooltip.tsx frontend/src/__tests__/components/MapTooltip.test.tsx
git commit -m "feat: add MapTooltip overlay component for map flight info"
```

---

## Task 10: DeckGLMap — store subscription, flyTo, spotlight/glow

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx`
- Create: `frontend/src/__tests__/utils/mapAnimationHelpers.test.ts`

- [ ] **Step 1: Add pure helper functions (testable separately)**

Create a new file with the pure geometry helpers:

```typescript
// frontend/src/utils/mapAnimationHelpers.ts

/**
 * Compute [west, south, east, north] bounding box for a set of [lon, lat] points.
 * Returns null if points array is empty.
 */
export function computeBbox(
  points: Array<[number, number]>
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Linearly interpolate a position along the arc at progress t (0→1).
 * Uses a parabolic z to simulate arc height.
 */
export function arcPosition(
  source: [number, number],
  target: [number, number],
  t: number
): [number, number] {
  return [
    source[0] + (target[0] - source[0]) * t,
    source[1] + (target[1] - source[1]) * t,
  ];
}

/** Ease-in-out cubic for smooth animation */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

- [ ] **Step 2: Write tests for helpers**

```typescript
// frontend/src/__tests__/utils/mapAnimationHelpers.test.ts
import { describe, it, expect } from "vitest";
import { computeBbox, arcPosition, easeInOut } from "../../utils/mapAnimationHelpers";

describe("computeBbox", () => {
  it("returns null for empty array", () => {
    expect(computeBbox([])).toBeNull();
  });

  it("returns tight bbox for two points", () => {
    const bbox = computeBbox([[11.79, 48.35], [-73.78, 40.64]]);
    expect(bbox).toEqual([-73.78, 40.64, 11.79, 48.35]);
  });

  it("handles single point", () => {
    const bbox = computeBbox([[10, 50]]);
    expect(bbox).toEqual([10, 50, 10, 50]);
  });
});

describe("arcPosition", () => {
  it("returns source at t=0", () => {
    expect(arcPosition([0, 0], [10, 10], 0)).toEqual([0, 0]);
  });

  it("returns target at t=1", () => {
    expect(arcPosition([0, 0], [10, 10], 1)).toEqual([10, 10]);
  });

  it("returns midpoint at t=0.5", () => {
    const [lon, lat] = arcPosition([0, 0], [10, 10], 0.5);
    expect(lon).toBeCloseTo(5);
    expect(lat).toBeCloseTo(5);
  });
});

describe("easeInOut", () => {
  it("returns 0 at t=0", () => expect(easeInOut(0)).toBe(0));
  it("returns 1 at t=1", () => expect(easeInOut(1)).toBe(1));
  it("returns 0.5 at t=0.5", () => expect(easeInOut(0.5)).toBeCloseTo(0.5));
  it("is slow at start and end", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 3: Run helper tests — expect PASS**

```bash
cd frontend && npx vitest run src/__tests__/utils/mapAnimationHelpers.test.ts
```
Expected: all pass

- [ ] **Step 4: Add store subscription + flyTo to DeckGLMap**

At the top of `DeckGLMap.tsx`, add imports:

```typescript
import { useFlightSelectionStore } from "../store/flightSelectionStore";
import { computeBbox } from "../utils/mapAnimationHelpers";
```

Inside the `DeckGLMap` function, after the existing `useEffect` for auto-pitch (around line 79), add:

```typescript
// Subscribe to selection store
const { selectedIds, selectedFlights, clearSelection } = useFlightSelectionStore();

// FlyTo when selection changes
useEffect(() => {
  if (selectedIds.length === 0) return;
  const map = mapRef.current?.getMap();
  if (!map) return;

  const points: Array<[number, number]> = selectedFlights.flatMap((f) => {
    const pts: Array<[number, number]> = [];
    if (f.depLon != null && f.depLat != null) pts.push([f.depLon, f.depLat]);
    if (f.arrLon != null && f.arrLat != null) pts.push([f.arrLon, f.arrLat]);
    return pts;
  });

  const bbox = computeBbox(points);
  if (!bbox) return;

  const [west, south, east, north] = bbox;
  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;

  // Estimate zoom: larger bbox → lower zoom
  const lonSpan = east - west;
  const latSpan = north - south;
  const span = Math.max(lonSpan, latSpan);
  const zoom = span < 5 ? 6 : span < 20 ? 4 : span < 60 ? 3 : 2;

  map.flyTo({
    center: [centerLon, centerLat],
    zoom,
    duration: 600,
    essential: true,
  });
}, [selectedIds, selectedFlights]);
```

- [ ] **Step 5: Add spotlight/glow layers**

In the `layers` useMemo (currently around line 97 of DeckGLMap), update the `"routes"` case:

```typescript
case "routes": {
  const baseLayers = createRoutesLayers(
    flights,
    minRouteCount,
    onFlightClick,
    themeColors,
    0.3
  );

  if (selectedIds.length === 0) return baseLayers;

  // Find selected features
  const selectedFeatures = flights.filter((f) =>
    selectedIds.includes(f.properties.id)
  );
  const nonSelectedFeatures = flights.filter(
    (f) => !selectedIds.includes(f.properties.id)
  );

  // Dim non-selected routes
  const dimmedLayers = createRoutesLayers(
    nonSelectedFeatures,
    minRouteCount,
    onFlightClick,
    themeColors,
    0.3
  ).map((layer) =>
    layer.clone({ opacity: 0.08, id: `${layer.id}-dimmed` })
  );

  // Highlighted selected routes (full opacity + glow)
  const highlightLayers = createRoutesLayers(
    selectedFeatures,
    1,
    onFlightClick,
    { ...themeColors, arcSourceColor: [129, 140, 248, 255], arcTargetColor: [99, 102, 241, 255] },
    0.3
  ).map((layer) =>
    layer.clone({ id: `${layer.id}-highlight` })
  );

  // Glow: second wider arc layer for the bloom effect
  const glowLayers = createRoutesLayers(
    selectedFeatures,
    1,
    undefined,
    { ...themeColors, arcSourceColor: [129, 140, 248, 100], arcTargetColor: [99, 102, 241, 100] },
    0.3
  ).map((layer) =>
    layer.clone({
      id: `${layer.id}-glow`,
      widthMinPixels: 10,
      opacity: 0.35,
    })
  );

  return [...dimmedLayers, ...glowLayers, ...highlightLayers];
}
```

Also add `selectedIds` to the `useMemo` dependency array.

- [ ] **Step 6: Handle map click to clear selection**

In the Map component JSX (where `<Map>` is rendered in DeckGLMap, around line 129), add an `onClick` handler:

```typescript
onClick={(e) => {
  // Only clear if the click was not on a pickable layer
  if (!e.features || e.features.length === 0) {
    clearSelection();
  }
}}
```

Note: deck.gl pickable clicks are handled by the overlay, not MapLibre's `onClick`. So clearing on any MapLibre map click is safe — pickable arc clicks call `onFlightClick` via the overlay and won't bubble to this handler.

- [ ] **Step 7: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Fix any type errors. Common issues:
- `layer.clone()` — ArcLayer and ScatterplotLayer from `@deck.gl/layers` support `clone()`. If type errors appear, cast via `as unknown as Layer`.
- `themeColors` spread — ensure `MapLayerColors` type allows spread.

- [ ] **Step 8: Run frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add frontend/src/utils/mapAnimationHelpers.ts \
        frontend/src/__tests__/utils/mapAnimationHelpers.test.ts \
        frontend/src/components/DeckGLMap.tsx
git commit -m "feat: add map spotlight/glow highlight and flyTo on flight selection"
```

---

## Task 11: DeckGLMap — plane animation

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx`

The plane animation renders a ✈ marker that travels along the selected route(s) for 1.5s, then stays at the destination. On multi-leg it animates leg 1, then leg 2 sequentially.

- [ ] **Step 1: Add plane animation state and rAF loop to DeckGLMap**

Add these imports at the top:

```typescript
import { TextLayer } from "@deck.gl/layers";
import { arcPosition, easeInOut } from "../utils/mapAnimationHelpers";
```

Inside the DeckGLMap function, after the flyTo useEffect, add:

```typescript
// Plane animation state
const [planePositions, setPlanePositions] = useState<Array<[number, number]>>([]);
const animFrameRef = useRef<number | null>(null);

useEffect(() => {
  // Cancel previous animation
  if (animFrameRef.current !== null) {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
  }
  setPlanePositions([]);

  if (selectedFlights.length === 0) return;

  // Build list of legs to animate: [source, target] per leg
  const legs: Array<{ source: [number, number]; target: [number, number] }> =
    selectedFlights
      .filter(
        (f) =>
          f.depLon != null && f.depLat != null && f.arrLon != null && f.arrLat != null
      )
      .map((f) => ({
        source: [f.depLon!, f.depLat!],
        target: [f.arrLon!, f.arrLat!],
      }));

  if (legs.length === 0) return;

  const LEG_DURATION = 1500; // ms per leg
  const DELAY_AFTER_FLYTO = 500; // wait for flyTo to finish
  const totalDuration = legs.length * LEG_DURATION;
  let startTime: number | null = null;

  const animate = (ts: number) => {
    if (startTime === null) startTime = ts;
    const elapsed = ts - startTime - DELAY_AFTER_FLYTO;
    if (elapsed < 0) {
      animFrameRef.current = requestAnimationFrame(animate);
      return;
    }

    const positions: Array<[number, number]> = legs.map((leg, i) => {
      const legStart = i * LEG_DURATION;
      const legElapsed = elapsed - legStart;
      if (legElapsed < 0) return leg.source;
      if (legElapsed >= LEG_DURATION) return leg.target;
      const t = easeInOut(legElapsed / LEG_DURATION);
      return arcPosition(leg.source, leg.target, t);
    });

    setPlanePositions(positions);

    if (elapsed < totalDuration) {
      animFrameRef.current = requestAnimationFrame(animate);
    }
  };

  animFrameRef.current = requestAnimationFrame(animate);

  return () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
    }
  };
}, [selectedFlights]);
```

- [ ] **Step 2: Add plane TextLayer to layer list**

In the `layers` useMemo, after constructing the final layer array for the `"routes"` case, append the plane layer at the end. Add a new `useMemo` for the plane layer (separate from the main layers memo, since it updates on every animation frame):

```typescript
const planeLayers = useMemo((): Layer[] => {
  if (planePositions.length === 0) return [];
  return [
    new TextLayer({
      id: "plane-marker",
      data: planePositions.map((position, i) => ({ position, index: i })),
      getText: () => "✈",
      getPosition: (d: { position: [number, number] }) => d.position,
      getSize: 20,
      getColor: [255, 255, 255, 230],
      getAngle: 0,
      fontFamily: "Arial, sans-serif",
      billboard: true,
    }),
  ];
}, [planePositions]);
```

Then in the `DeckMapboxOverlay` (where layers are passed to the overlay), merge `planeLayers`:

Find the line where the overlay receives layers (around line 135 in DeckGLMap, the `layers` prop on `DeckMapboxOverlay` or `MapboxOverlay`). Change:
```typescript
layers={layers}
```
to:
```typescript
layers={[...layers, ...planeLayers]}
```

- [ ] **Step 3: Type-check and run tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DeckGLMap.tsx
git commit -m "feat: add plane animation along selected flight route"
```

---

## Task 12: DeckGLMap — airport pulse + MapTooltip integration

**Files:**
- Modify: `frontend/src/components/DeckGLMap.tsx`

- [ ] **Step 1: Add airport pulse layers**

Add pulse state + interval inside the DeckGLMap function, after the plane animation block:

```typescript
// Airport pulse phase (0, 1, 2 — cycles every 800ms)
const [pulsePhase, setPulsePhase] = useState(0);
const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

useEffect(() => {
  if (pulseIntervalRef.current) {
    clearInterval(pulseIntervalRef.current);
    pulseIntervalRef.current = null;
  }
  setPulsePhase(0);
  if (selectedFlights.length === 0) return;

  pulseIntervalRef.current = setInterval(() => {
    setPulsePhase((p) => (p + 1) % 3);
  }, 800);

  return () => {
    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
  };
}, [selectedFlights]);
```

Add a pulseLayers memo:

```typescript
const pulseLayers = useMemo((): Layer[] => {
  if (selectedFlights.length === 0) return [];

  const airports = selectedFlights.flatMap((f) => {
    const pts: Array<[number, number]> = [];
    if (f.depLon != null && f.depLat != null) pts.push([f.depLon, f.depLat]);
    if (f.arrLon != null && f.arrLat != null) pts.push([f.arrLon, f.arrLat]);
    return pts;
  });

  // Deduplicate
  const seen = new Set<string>();
  const unique = airports.filter(([lon, lat]) => {
    const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const BASE_RADIUS = 80000; // meters
  const rings = [
    { multiplier: 1, opacities: [200, 80, 20] },
    { multiplier: 2, opacities: [80, 200, 80] },
    { multiplier: 3.5, opacities: [20, 80, 200] },
  ];

  return rings.map(({ multiplier, opacities }) =>
    new ScatterplotLayer({
      id: `pulse-ring-${multiplier}`,
      data: unique.map((position) => ({ position })),
      getPosition: (d: { position: [number, number] }) => d.position,
      getRadius: BASE_RADIUS * multiplier,
      getFillColor: [0, 0, 0, 0] as [number, number, number, number],
      getLineColor: [129, 140, 248, opacities[pulsePhase]] as [number, number, number, number],
      stroked: true,
      filled: false,
      lineWidthMinPixels: 1.5,
      pickable: false,
    })
  );
}, [selectedFlights, pulsePhase]);
```

Update the layers merge to include pulseLayers:
```typescript
layers={[...layers, ...pulseLayers, ...planeLayers]}
```

- [ ] **Step 2: Add MapTooltip rendering**

The tooltip appears after the plane animation finishes (~1.8s after selection). It is positioned at the screen coordinates of the route midpoint.

Add tooltip state:

```typescript
const [tooltipVisible, setTooltipVisible] = useState(false);
const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
```

Add a useEffect that shows the tooltip after 1.8s:

```typescript
useEffect(() => {
  setTooltipVisible(false);
  if (selectedFlights.length === 0) return;

  const timer = setTimeout(() => {
    const map = mapRef.current?.getMap();
    if (!map || selectedFlights.length === 0) return;

    const f = selectedFlights[0];
    if (f.depLon == null || f.arrLon == null) return;

    // Midpoint of first flight
    const midLon = (f.depLon + f.arrLon) / 2;
    const midLat = (f.depLat! + f.arrLat!) / 2;
    const screenPt = map.project([midLon, midLat]);
    setTooltipPos({ x: screenPt.x, y: screenPt.y });
    setTooltipVisible(true);
  }, 1800);

  return () => clearTimeout(timer);
}, [selectedFlights]);
```

Add the `onEdit` prop to `DeckGLMapProps`:

```typescript
interface DeckGLMapProps {
  flights: GeoJSONFeature[];
  visMode: VisMode;
  minRouteCount?: number;
  selectedFlightId?: string;
  onFlightClick?: (flightId: string) => void;
  onEdit?: (flight: Flight) => void;  // ← add this
}
```

Import `Flight` type and `MapTooltip`:

```typescript
import type { Flight } from "../types";
import { MapTooltip } from "./MapTooltip";
```

Render the tooltip inside the DeckGLMap return JSX. The map is rendered inside a `<div>` wrapper — add the tooltip as a sibling to the `<Map>` component:

```typescript
{tooltipVisible && selectedFlights.length > 0 && (
  <MapTooltip
    flight={selectedFlights[0] as unknown as Flight}
    screenX={tooltipPos.x}
    screenY={tooltipPos.y}
    onEdit={(flight) => {
      clearSelection();
      onEdit?.(flight);
    }}
    onClose={() => {
      clearSelection();
      setTooltipVisible(false);
    }}
  />
)}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DeckGLMap.tsx
git commit -m "feat: add airport pulse rings and map tooltip to flight selection"
```

---

## Task 13: MapContainer3D cleanup + DashboardPage `onEdit` wiring

**Files:**
- Modify: `frontend/src/components/MapContainer3D.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Update MapContainer3D props**

`selectedFlightId` is no longer needed (store handles it). Add `onEdit` for the tooltip's edit button.

Update the interface in `MapContainer3D.tsx`:

```typescript
interface MapContainer3DProps {
  flights: GeoJSONFeature[];
  onFlightClick?: (flightId: string) => void;
  visMode: VisMode;
  onVisModeChange: (mode: VisMode) => void;
  minRouteCount?: number;
  filterSlot?: React.ReactNode;
  onEdit?: (flight: Flight) => void;  // ← add
}
```

Remove `selectedFlightId` from the destructured props and from the `<DeckGLMap>` call. Add `onEdit`:

```typescript
<DeckGLMap
  flights={flights}
  onFlightClick={onFlightClick}
  visMode={visMode}
  minRouteCount={minRouteCount}
  onEdit={onEdit}
/>
```

- [ ] **Step 2: Update DashboardPage to pass `onEdit` to MapContainer3D**

In `DashboardPage.tsx`, find the `<MapContainer3D>` usage and add `onEdit`:

```typescript
<MapContainer3D
  flights={geoFlights}
  onFlightClick={(id) => {
    // Still useful for Globe mode — set store selection
    const flight = recentFlights.find((f) => f.id === id);
    if (flight) {
      useFlightSelectionStore.getState().setSelection([id], [flight]);
    }
  }}
  visMode={visMode}
  onVisModeChange={handleVisModeChange}
  minRouteCount={filters.minRouteCount ?? 1}
  filterSlot={...}
  onEdit={(flight) => setEditingFlight(flight)}
/>
```

Add this import at the top:
```typescript
import { useFlightSelectionStore } from "../store/flightSelectionStore";
```

- [ ] **Step 3: Full type-check**

```bash
cd frontend && npx tsc --noEmit
```
Fix any remaining type errors.

- [ ] **Step 4: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: all previously passing tests still pass + the 20+ new tests added in this plan all pass.

- [ ] **Step 5: Run build check**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

- [ ] **Step 6: Final commit**

```bash
git add frontend/src/components/MapContainer3D.tsx \
        frontend/src/pages/DashboardPage.tsx
git commit -m "feat: wire onEdit through MapContainer3D for map tooltip, cleanup selectedFlightId prop"
```

---

## Spec Coverage Check

| Spec requirement | Covered in |
|-----------------|-----------|
| `useFlightSelectionStore` with selectedIds, selectedFlights, highlightMode | Task 1 |
| `FlightGroup` type + multi-leg detection ≤12h, same airport | Task 2 |
| QuickActions: Edit, Map, Stats, Duplicate, Delete | Task 3 |
| InlineStats: distance, duration, seatClass, CO₂, aircraft | Task 4 |
| FlightEntry: selection on click, hover state, stats toggle | Task 5 |
| FlightGroupItem: bracket, group footer with label + distance | Task 6 |
| FlightPanel extracted from DashboardPage | Task 7 |
| DashboardPage: delete (3s delayed API), duplicate, panel swap | Task 8 |
| MapTooltip overlay with flight info + Edit/Close buttons | Task 9 |
| Spotlight: non-selected routes dimmed to 10%, selected glows | Task 10 |
| FlyTo: camera flies to bbox on selection | Task 10 |
| Plane animation: rAF loop, eased interpolation, sequential legs | Task 11 |
| Airport pulse: 3 concentric rings phase-cycled | Task 12 |
| Tooltip appears after animation (1.8s delay) at arc midpoint | Task 12 |
| Deselection on map click → clearSelection | Task 10 |
| Error: missing coords → skip flyTo/animation, tooltip still shows | Task 12 (flyTo guard) |
| Delete undo: delay API call, optimistic remove from list | Task 8 |
