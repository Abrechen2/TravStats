# Multi-Domain Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flight-centric TravStats dashboard into a multi-domain, map-first UI with a domain tab strip (All/Flights/Cruises/POIs), per-domain map modes, URL-persisted tab+mode, time-filter global and domain-filters per-tab, and a removed right-side stats panel.

**Architecture:** Frontend-only refactor on `dev/multi-domain-v1`. New top-level components under `frontend/src/components/Dashboard/`. Route state lives in URL segments (tab) + query (mode), mirrored to `localStorage` for "last mode per domain" convenience. Filter state goes into a new Zustand store. Modes become per-domain unions keyed off a central registry; the global `VisMode` enum is deleted.

**Tech Stack:** React 18 + Vite + TypeScript (strict), Zustand for filter state, react-router-dom v6 for nested routes, react-i18next (de primary + en mirror), deck.gl + MapLibre for the map, Vitest + react-testing-library for unit tests, Playwright for E2E.

**Spec:** [`docs/superpowers/specs/2026-04-21-multi-domain-dashboard-redesign-design.md`](../specs/2026-04-21-multi-domain-dashboard-redesign-design.md)

**Branch:** `dev/multi-domain-v1` (local only; never commit to main until user promotes).

---

## Task order / dependency graph

Tasks 1 → 3 are backbone (types + hooks + store). Tasks 4 → 7 build the
shell (tab strip, controls bar, routing). Tasks 8 → 12 wire tabs +
existing modes. Tasks 13 → 16 add the new modes. Task 17 is the filter
redesign. Task 18 handles sidebars. Task 19 is cleanup. Tasks 20 → 22
are i18n + tests + verification.

Each task is self-contained — a fresh subagent must be able to execute
any task without reading the previous task's implementation.

---

## Task 1: Dashboard types + mode registry

**Files:**
- Create: `frontend/src/types/dashboard.ts`
- Test: `frontend/src/types/__tests__/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/types/__tests__/dashboard.test.ts
import { describe, it, expect } from "vitest";
import {
  DASHBOARD_TABS,
  TAB_MODE_REGISTRY,
  isDashboardTab,
  isModeForTab,
  defaultModeForTab,
} from "../dashboard";

describe("dashboard tab + mode registry", () => {
  it("exposes exactly the four agreed tabs", () => {
    expect(DASHBOARD_TABS).toEqual(["all", "flight", "cruise", "poi"]);
  });

  it("isDashboardTab narrows arbitrary strings", () => {
    expect(isDashboardTab("flight")).toBe(true);
    expect(isDashboardTab("hexagon")).toBe(false);
    expect(isDashboardTab(undefined)).toBe(false);
  });

  it("each tab has a non-empty ordered mode list with a valid default", () => {
    for (const tab of DASHBOARD_TABS) {
      const entry = TAB_MODE_REGISTRY[tab];
      expect(entry.modes.length).toBeGreaterThan(0);
      expect(entry.modes).toContain(entry.default);
    }
  });

  it("isModeForTab validates cross-tab boundaries", () => {
    expect(isModeForTab("flight", "routes")).toBe(true);
    expect(isModeForTab("flight", "sea-routes")).toBe(false);
    expect(isModeForTab("cruise", "sea-routes")).toBe(true);
    expect(isModeForTab("all", "overview")).toBe(true);
    expect(isModeForTab("poi", "routes")).toBe(false);
  });

  it("defaultModeForTab returns the registered default", () => {
    expect(defaultModeForTab("flight")).toBe("routes");
    expect(defaultModeForTab("cruise")).toBe("sea-routes");
    expect(defaultModeForTab("poi")).toBe("markers");
    expect(defaultModeForTab("all")).toBe("overview");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/types/__tests__/dashboard.test.ts
```
Expected: FAIL with "Cannot find module '../dashboard'"

- [ ] **Step 3: Write the types + registry**

```typescript
// frontend/src/types/dashboard.ts
export const DASHBOARD_TABS = ["all", "flight", "cruise", "poi"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const ALL_MODES = ["overview", "heatmap", "journey", "globe"] as const;
export type AllMode = (typeof ALL_MODES)[number];

export const FLIGHT_MODES = ["routes", "heatmap", "stats-map", "trips"] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const CRUISE_MODES = ["sea-routes", "itinerary", "port-frequency"] as const;
export type CruiseMode = (typeof CRUISE_MODES)[number];

export const POI_MODES = ["markers", "heatmap"] as const;
export type PoiMode = (typeof POI_MODES)[number];

export type DashboardMode = AllMode | FlightMode | CruiseMode | PoiMode;

interface TabRegistryEntry<M extends DashboardMode> {
  readonly modes: readonly M[];
  readonly default: M;
}

export const TAB_MODE_REGISTRY = {
  all: { modes: ALL_MODES, default: "overview" },
  flight: { modes: FLIGHT_MODES, default: "routes" },
  cruise: { modes: CRUISE_MODES, default: "sea-routes" },
  poi: { modes: POI_MODES, default: "markers" },
} as const satisfies Record<DashboardTab, TabRegistryEntry<DashboardMode>>;

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === "string" && (DASHBOARD_TABS as readonly string[]).includes(value);
}

export function isModeForTab(tab: DashboardTab, mode: unknown): mode is DashboardMode {
  if (typeof mode !== "string") return false;
  return (TAB_MODE_REGISTRY[tab].modes as readonly string[]).includes(mode);
}

export function defaultModeForTab(tab: DashboardTab): DashboardMode {
  return TAB_MODE_REGISTRY[tab].default;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/types/__tests__/dashboard.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/dashboard.ts frontend/src/types/__tests__/dashboard.test.ts
git commit -m "feat(dashboard): tab + mode type registry"
```

---

## Task 2: useDashboardRoute hook (URL ↔ state + localStorage)

**Files:**
- Create: `frontend/src/hooks/useDashboardRoute.ts`
- Test: `frontend/src/hooks/__tests__/useDashboardRoute.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/hooks/__tests__/useDashboardRoute.test.tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useDashboardRoute } from "../useDashboardRoute";
import type { ReactNode } from "react";

const LAST_MODE_KEY = "travstats:dashboard:lastMode";

function wrapper(initialEntries: string[]): (props: { children: ReactNode }) => JSX.Element {
  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/dashboard" element={children} />
        <Route path="/dashboard/:tab" element={children} />
      </Routes>
    </MemoryRouter>
  );
}

describe("useDashboardRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to all/overview when URL has no tab or mode", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.tab).toBe("all");
    expect(result.current.mode).toBe("overview");
  });

  it("reads tab from URL segment, mode from URL query", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight?mode=heatmap"]),
    });
    expect(result.current.tab).toBe("flight");
    expect(result.current.mode).toBe("heatmap");
  });

  it("URL mode missing → falls back to last-used localStorage mode for that tab", () => {
    window.localStorage.setItem(
      LAST_MODE_KEY,
      JSON.stringify({ flight: "trips", cruise: "itinerary" }),
    );
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    expect(result.current.mode).toBe("trips");
  });

  it("URL mode missing AND no localStorage → tab default", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/cruise"]),
    });
    expect(result.current.mode).toBe("sea-routes");
  });

  it("invalid URL mode for the active tab → tab default, no crash", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight?mode=sea-routes"]),
    });
    expect(result.current.mode).toBe("routes");
  });

  it("invalid tab → redirects to /dashboard (tab resolves to all)", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/spaceship"]),
    });
    expect(result.current.tab).toBe("all");
  });

  it("setMode persists to localStorage", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    act(() => {
      result.current.setMode("heatmap");
    });
    const stored = JSON.parse(window.localStorage.getItem(LAST_MODE_KEY) ?? "{}");
    expect(stored.flight).toBe("heatmap");
  });

  it("obsolete localStorage mode name ignored in favour of tab default", () => {
    window.localStorage.setItem(
      LAST_MODE_KEY,
      JSON.stringify({ flight: "hexagon" }),
    );
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    expect(result.current.mode).toBe("routes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/hooks/__tests__/useDashboardRoute.test.tsx
```
Expected: FAIL — "Cannot find module '../useDashboardRoute'".

- [ ] **Step 3: Write the hook**

```typescript
// frontend/src/hooks/useDashboardRoute.ts
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DashboardMode,
  DashboardTab,
  defaultModeForTab,
  isDashboardTab,
  isModeForTab,
} from "../types/dashboard";

const LAST_MODE_KEY = "travstats:dashboard:lastMode";

interface DashboardRouteState {
  tab: DashboardTab;
  mode: DashboardMode;
  setTab(next: DashboardTab): void;
  setMode(next: DashboardMode): void;
}

function readLastModes(): Partial<Record<DashboardTab, DashboardMode>> {
  try {
    const raw = window.localStorage.getItem(LAST_MODE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Partial<Record<DashboardTab, DashboardMode>>;
  } catch {
    return {};
  }
}

function writeLastMode(tab: DashboardTab, mode: DashboardMode): void {
  const current = readLastModes();
  const next = { ...current, [tab]: mode };
  try {
    window.localStorage.setItem(LAST_MODE_KEY, JSON.stringify(next));
  } catch {
    // Silent — localStorage full / disabled; not worth surfacing.
  }
}

export function useDashboardRoute(): DashboardRouteState {
  const { tab: rawTab } = useParams<{ tab?: string }>();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();

  const tab: DashboardTab = isDashboardTab(rawTab) ? rawTab : "all";

  // If the URL tab was invalid, normalise it once so the URL doesn't stick
  // at /dashboard/spaceship.
  useEffect(() => {
    if (rawTab !== undefined && !isDashboardTab(rawTab)) {
      navigate("/dashboard", { replace: true });
    }
  }, [rawTab, navigate]);

  const mode: DashboardMode = useMemo(() => {
    const urlMode = search.get("mode");
    if (urlMode && isModeForTab(tab, urlMode)) return urlMode;
    const stored = readLastModes()[tab];
    if (stored && isModeForTab(tab, stored)) return stored;
    return defaultModeForTab(tab);
  }, [search, tab]);

  const setTab = useCallback(
    (next: DashboardTab) => {
      if (next === "all") {
        navigate("/dashboard");
      } else {
        navigate(`/dashboard/${next}`);
      }
    },
    [navigate],
  );

  const setMode = useCallback(
    (next: DashboardMode) => {
      if (!isModeForTab(tab, next)) return;
      writeLastMode(tab, next);
      const nextSearch = new URLSearchParams(search);
      nextSearch.set("mode", next);
      setSearch(nextSearch, { replace: true });
    },
    [tab, search, setSearch],
  );

  return { tab, mode, setTab, setMode };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/hooks/__tests__/useDashboardRoute.test.tsx
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDashboardRoute.ts frontend/src/hooks/__tests__/useDashboardRoute.test.tsx
git commit -m "feat(dashboard): useDashboardRoute hook (URL + localStorage)"
```

---

## Task 3: dashboardFilterStore (time global + per-domain)

**Files:**
- Create: `frontend/src/store/dashboardFilterStore.ts`
- Test: `frontend/src/store/__tests__/dashboardFilterStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/store/__tests__/dashboardFilterStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDashboardFilterStore, intervalOverlapsRange } from "../dashboardFilterStore";

describe("dashboardFilterStore", () => {
  beforeEach(() => {
    useDashboardFilterStore.getState().reset();
  });

  it("time range is empty by default", () => {
    const { time } = useDashboardFilterStore.getState();
    expect(time.from).toBeNull();
    expect(time.to).toBeNull();
  });

  it("setTimeRange updates the shared time slice", () => {
    useDashboardFilterStore.getState().setTimeRange("2024-01-01", "2024-12-31");
    const { time } = useDashboardFilterStore.getState();
    expect(time.from).toBe("2024-01-01");
    expect(time.to).toBe("2024-12-31");
  });

  it("setFlightFilter updates only the flight slice", () => {
    useDashboardFilterStore.getState().setFlightFilter({ airline: "LH" });
    const { flight, cruise } = useDashboardFilterStore.getState();
    expect(flight.airline).toBe("LH");
    expect(cruise.cruiseLine).toBeUndefined();
  });

  it("setCruiseFilter updates only the cruise slice", () => {
    useDashboardFilterStore.getState().setCruiseFilter({ cruiseLine: "AIDA", status: "scheduled" });
    const { flight, cruise } = useDashboardFilterStore.getState();
    expect(cruise.cruiseLine).toBe("AIDA");
    expect(cruise.status).toBe("scheduled");
    expect(flight.airline).toBeUndefined();
  });
});

describe("intervalOverlapsRange", () => {
  it("true when cruise interval falls entirely inside filter range", () => {
    expect(intervalOverlapsRange("2024-06-01", "2024-06-14", "2024-01-01", "2024-12-31")).toBe(true);
  });
  it("true when cruise interval partially overlaps filter range (left)", () => {
    expect(intervalOverlapsRange("2023-12-20", "2024-01-10", "2024-01-01", "2024-12-31")).toBe(true);
  });
  it("true when cruise interval partially overlaps filter range (right)", () => {
    expect(intervalOverlapsRange("2024-12-20", "2025-01-10", "2024-01-01", "2024-12-31")).toBe(true);
  });
  it("false when cruise interval is entirely before filter range", () => {
    expect(intervalOverlapsRange("2023-01-01", "2023-12-31", "2024-01-01", "2024-12-31")).toBe(false);
  });
  it("false when cruise interval is entirely after filter range", () => {
    expect(intervalOverlapsRange("2025-01-01", "2025-12-31", "2024-01-01", "2024-12-31")).toBe(false);
  });
  it("null cruise endDate treated as open-ended (overlaps if start is in range)", () => {
    expect(intervalOverlapsRange("2024-06-01", null, "2024-01-01", "2024-12-31")).toBe(true);
  });
  it("filter range null (from or to) disables that bound", () => {
    expect(intervalOverlapsRange("2020-01-01", "2020-01-31", null, "2024-12-31")).toBe(true);
    expect(intervalOverlapsRange("2030-01-01", "2030-01-31", "2024-01-01", null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/store/__tests__/dashboardFilterStore.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write the store + helper**

```typescript
// frontend/src/store/dashboardFilterStore.ts
import { create } from "zustand";

export interface TimeRange {
  from: string | null; // ISO yyyy-mm-dd
  to: string | null;
}

export interface FlightFilter {
  airline?: string;
  status?: string;
}

export interface CruiseFilter {
  cruiseLine?: string;
  status?: string;
}

export interface PoiFilter {
  category?: string;
}

interface DashboardFilterState {
  time: TimeRange;
  flight: FlightFilter;
  cruise: CruiseFilter;
  poi: PoiFilter;
  setTimeRange(from: string | null, to: string | null): void;
  setFlightFilter(patch: Partial<FlightFilter>): void;
  setCruiseFilter(patch: Partial<CruiseFilter>): void;
  setPoiFilter(patch: Partial<PoiFilter>): void;
  reset(): void;
}

const EMPTY_TIME: TimeRange = { from: null, to: null };

export const useDashboardFilterStore = create<DashboardFilterState>((set) => ({
  time: EMPTY_TIME,
  flight: {},
  cruise: {},
  poi: {},
  setTimeRange: (from, to) => set({ time: { from, to } }),
  setFlightFilter: (patch) => set((s) => ({ flight: { ...s.flight, ...patch } })),
  setCruiseFilter: (patch) => set((s) => ({ cruise: { ...s.cruise, ...patch } })),
  setPoiFilter: (patch) => set((s) => ({ poi: { ...s.poi, ...patch } })),
  reset: () => set({ time: EMPTY_TIME, flight: {}, cruise: {}, poi: {} }),
}));

/**
 * True when the interval [startDate, endDate] overlaps the filter range
 * [from, to]. Used for cruise time-filtering where each cruise is an
 * interval and the global time-slider is also a range. Null `endDate`
 * means open-ended cruise (treated as still ongoing). Null `from` / `to`
 * means that bound is unset.
 */
export function intervalOverlapsRange(
  startDate: string,
  endDate: string | null,
  from: string | null,
  to: string | null,
): boolean {
  const start = Date.parse(startDate);
  const end = endDate === null ? Number.POSITIVE_INFINITY : Date.parse(endDate);
  const rangeFrom = from === null ? Number.NEGATIVE_INFINITY : Date.parse(from);
  const rangeTo = to === null ? Number.POSITIVE_INFINITY : Date.parse(to);
  return start <= rangeTo && end >= rangeFrom;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/store/__tests__/dashboardFilterStore.test.ts
```
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/dashboardFilterStore.ts frontend/src/store/__tests__/dashboardFilterStore.test.ts
git commit -m "feat(dashboard): filter store — time global, per-domain slices"
```

---

## Task 4: DomainTabStrip component

**Files:**
- Create: `frontend/src/components/Dashboard/DomainTabStrip.tsx`
- Test: `frontend/src/components/Dashboard/__tests__/DomainTabStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Dashboard/__tests__/DomainTabStrip.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DomainTabStrip } from "../DomainTabStrip";

describe("DomainTabStrip", () => {
  it("renders the four tabs with counts", () => {
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 127, cruise: 2, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: true }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /all/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /127/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /2/ })).toBeTruthy();
  });

  it("marks the active tab with aria-selected", () => {
    render(
      <DomainTabStrip
        active="cruise"
        counts={{ flight: 0, cruise: 2, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: true }}
        onSelect={() => {}}
      />,
    );
    const tab = screen.getByRole("tab", { name: /cruise/i });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("calls onSelect with the clicked tab", () => {
    const onSelect = vi.fn();
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 0, cruise: 0, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: true }}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /flights/i }));
    expect(onSelect).toHaveBeenCalledWith("flight");
  });

  it("dims but still allows clicking a disabled-domain tab (so user can see the 'coming soon' screen)", () => {
    const onSelect = vi.fn();
    render(
      <DomainTabStrip
        active="all"
        counts={{ flight: 0, cruise: 0, poi: 0 }}
        enabled={{ flight: true, cruise: true, poi: false }}
        onSelect={onSelect}
      />,
    );
    const poi = screen.getByRole("tab", { name: /poi/i });
    expect(poi.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(poi);
    expect(onSelect).toHaveBeenCalledWith("poi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/components/Dashboard/__tests__/DomainTabStrip.test.tsx
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/Dashboard/DomainTabStrip.tsx
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import { DASHBOARD_TABS } from "../../types/dashboard";

interface DomainTabStripProps {
  active: DashboardTab;
  counts: Record<Exclude<DashboardTab, "all">, number>;
  enabled: Record<Exclude<DashboardTab, "all">, boolean>;
  onSelect(next: DashboardTab): void;
}

const TAB_ICON: Record<DashboardTab, string> = {
  all: "◎",
  flight: "✈",
  cruise: "⚓",
  poi: "📍",
};

export function DomainTabStrip({
  active,
  counts,
  enabled,
  onSelect,
}: DomainTabStripProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);

  return (
    <div
      role="tablist"
      aria-label={t("dashboard:tabStrip.label")}
      style={{
        background: "#0b1017",
        padding: "6px 16px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        gap: "4px",
        fontSize: "13px",
      }}
    >
      {DASHBOARD_TABS.map((tab) => {
        const isActive = tab === active;
        const isDisabled = tab !== "all" && !enabled[tab];
        const count = tab === "all" ? null : counts[tab];
        const label = t(`dashboard:tabStrip.tabs.${tab}`);
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            data-disabled={isDisabled ? "true" : "false"}
            onClick={() => onSelect(tab)}
            style={{
              padding: "8px 18px",
              background: "transparent",
              color: isActive ? "var(--accent)" : "var(--text-primary)",
              borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              opacity: isDisabled ? 0.55 : 1,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
            }}
          >
            <span style={{ marginRight: "6px" }}>{TAB_ICON[tab]}</span>
            {label}
            {count !== null && (
              <span style={{ marginLeft: "8px", opacity: 0.65, fontFamily: "var(--font-mono)" }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add i18n stubs so the test doesn't blow up on missing keys**

Edit `frontend/src/i18n/resources/de/dashboard.json`, add next to existing keys:

```json
  "tabStrip": {
    "label": "Bereichswahl",
    "tabs": {
      "all": "Alle",
      "flight": "Flüge",
      "cruise": "Kreuzfahrten",
      "poi": "POIs"
    }
  },
```

Edit `frontend/src/i18n/resources/en/dashboard.json`, add next to existing keys:

```json
  "tabStrip": {
    "label": "Domain switcher",
    "tabs": {
      "all": "All",
      "flight": "Flights",
      "cruise": "Cruises",
      "poi": "POIs"
    }
  },
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/components/Dashboard/__tests__/DomainTabStrip.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Dashboard/DomainTabStrip.tsx frontend/src/components/Dashboard/__tests__/DomainTabStrip.test.tsx frontend/src/i18n/resources/de/dashboard.json frontend/src/i18n/resources/en/dashboard.json
git commit -m "feat(dashboard): DomainTabStrip component + i18n"
```

---

## Task 5: AddDomainPicker (All-tab's "+ Add" dropdown)

**Files:**
- Create: `frontend/src/components/Dashboard/AddDomainPicker.tsx`
- Test: `frontend/src/components/Dashboard/__tests__/AddDomainPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Dashboard/__tests__/AddDomainPicker.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddDomainPicker } from "../AddDomainPicker";

describe("AddDomainPicker", () => {
  it("renders the button label", () => {
    render(
      <AddDomainPicker
        enabled={{ flight: true, cruise: true, poi: false }}
        onPick={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /hinzufügen|add/i })).toBeTruthy();
  });

  it("opens the menu on click and lists only enabled domains", () => {
    render(
      <AddDomainPicker
        enabled={{ flight: true, cruise: true, poi: false }}
        onPick={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen|add/i }));
    expect(screen.getByText(/flug/i)).toBeTruthy();
    expect(screen.getByText(/kreuzfahrt/i)).toBeTruthy();
    expect(screen.queryByText(/poi/i)).toBeNull();
  });

  it("calls onPick with the selected domain and closes the menu", () => {
    const onPick = vi.fn();
    render(
      <AddDomainPicker
        enabled={{ flight: true, cruise: true, poi: false }}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen|add/i }));
    fireEvent.click(screen.getByText(/kreuzfahrt/i));
    expect(onPick).toHaveBeenCalledWith("cruise");
    expect(screen.queryByText(/flug/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/components/Dashboard/__tests__/AddDomainPicker.test.tsx
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/Dashboard/AddDomainPicker.tsx
import { useState, useRef, useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

type AddableDomain = "flight" | "cruise" | "poi";

interface AddDomainPickerProps {
  enabled: Record<AddableDomain, boolean>;
  onPick(domain: AddableDomain): void;
}

export function AddDomainPicker({ enabled, onPick }: AddDomainPickerProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const options: { key: AddableDomain; label: string }[] = [];
  if (enabled.flight) options.push({ key: "flight", label: t("dashboard:addPicker.flight") });
  if (enabled.cruise) options.push({ key: "cruise", label: t("dashboard:addPicker.cruise") });
  if (enabled.poi) options.push({ key: "poi", label: t("dashboard:addPicker.poi") });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          background: "var(--accent)",
          color: "#0d1117",
          padding: "6px 12px",
          borderRadius: "10px",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        + {t("dashboard:addPicker.button")} ▾
      </button>
      {open && (
        <ul
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            padding: "4px 0",
            minWidth: "180px",
            zIndex: 30,
            listStyle: "none",
            margin: 0,
          }}
        >
          {options.map((opt) => (
            <li key={opt.key}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(opt.key);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: "transparent",
                  color: "var(--text-primary)",
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add i18n keys**

Edit `frontend/src/i18n/resources/de/dashboard.json`:

```json
  "addPicker": {
    "button": "Hinzufügen",
    "flight": "Flug",
    "cruise": "Kreuzfahrt",
    "poi": "POI"
  },
```

Edit `frontend/src/i18n/resources/en/dashboard.json`:

```json
  "addPicker": {
    "button": "Add",
    "flight": "Flight",
    "cruise": "Cruise",
    "poi": "POI"
  },
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/components/Dashboard/__tests__/AddDomainPicker.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Dashboard/AddDomainPicker.tsx frontend/src/components/Dashboard/__tests__/AddDomainPicker.test.tsx frontend/src/i18n/resources/de/dashboard.json frontend/src/i18n/resources/en/dashboard.json
git commit -m "feat(dashboard): AddDomainPicker + i18n"
```

---

## Task 6: DashboardControlsBar (mode dropdown + filter button + primary-add)

**Files:**
- Create: `frontend/src/components/Dashboard/DashboardControlsBar.tsx`
- Test: `frontend/src/components/Dashboard/__tests__/DashboardControlsBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/Dashboard/__tests__/DashboardControlsBar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardControlsBar } from "../DashboardControlsBar";

describe("DashboardControlsBar", () => {
  it("renders the modes for the active tab", () => {
    render(
      <DashboardControlsBar
        tab="cruise"
        mode="sea-routes"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={() => {}}
        onAdd={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sea-routes|routes/i }));
    expect(screen.getByRole("menuitem", { name: /itinerary/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /port-frequency/i })).toBeTruthy();
  });

  it("calls onModeChange when a mode is picked", () => {
    const onModeChange = vi.fn();
    render(
      <DashboardControlsBar
        tab="flight"
        mode="routes"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={onModeChange}
        onFilterOpen={() => {}}
        onAdd={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /routes/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /heatmap/i }));
    expect(onModeChange).toHaveBeenCalledWith("heatmap");
  });

  it("shows the domain-specific primary add button on a domain tab", () => {
    const onAdd = vi.fn();
    render(
      <DashboardControlsBar
        tab="flight"
        mode="routes"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={() => {}}
        onAdd={onAdd}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /flug hinzufügen|add flight/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("shows the AddDomainPicker on the All tab", () => {
    render(
      <DashboardControlsBar
        tab="all"
        mode="overview"
        enabledDomains={{ flight: true, cruise: true, poi: false }}
        onModeChange={() => {}}
        onFilterOpen={() => {}}
        onAdd={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen|add/i }));
    expect(screen.getByText(/flug/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run src/components/Dashboard/__tests__/DashboardControlsBar.test.tsx
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/Dashboard/DashboardControlsBar.tsx
import { useState, useRef, useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  DashboardMode,
  DashboardTab,
  TAB_MODE_REGISTRY,
} from "../../types/dashboard";
import { AddDomainPicker } from "./AddDomainPicker";

interface DashboardControlsBarProps {
  tab: DashboardTab;
  mode: DashboardMode;
  enabledDomains: { flight: boolean; cruise: boolean; poi: boolean };
  onModeChange(next: DashboardMode): void;
  onFilterOpen(): void;
  onAdd(domain?: "flight" | "cruise" | "poi"): void;
}

export function DashboardControlsBar({
  tab,
  mode,
  enabledDomains,
  onModeChange,
  onFilterOpen,
  onAdd,
}: DashboardControlsBarProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!modeRef.current?.contains(e.target as Node)) setModeMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [modeMenuOpen]);

  const modes = TAB_MODE_REGISTRY[tab].modes;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        padding: "8px 16px",
        background: "var(--color-surface-muted)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div ref={modeRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setModeMenuOpen((prev) => !prev)}
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            padding: "6px 12px",
            borderRadius: "10px",
            color: "var(--text-primary)",
            fontSize: "13px",
          }}
        >
          {t("dashboard:controls.mode")}: <strong>{t(`dashboard:modes.${mode}`)}</strong> ▾
        </button>
        {modeMenuOpen && (
          <ul
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              listStyle: "none",
              margin: 0,
              padding: "4px 0",
              minWidth: "200px",
              zIndex: 30,
            }}
          >
            {modes.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onModeChange(m);
                    setModeMenuOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background: m === mode ? "var(--color-surface-muted)" : "transparent",
                    color: "var(--text-primary)",
                  }}
                >
                  {t(`dashboard:modes.${m}`)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onFilterOpen}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          padding: "6px 12px",
          borderRadius: "10px",
          color: "var(--text-primary)",
          fontSize: "13px",
        }}
      >
        {t("dashboard:controls.filter")} ▾
      </button>

      <div style={{ marginLeft: "auto" }}>
        {tab === "all" ? (
          <AddDomainPicker enabled={enabledDomains} onPick={onAdd} />
        ) : (
          <button
            type="button"
            onClick={() => onAdd()}
            style={{
              background: "var(--accent)",
              color: "#0d1117",
              padding: "6px 12px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            + {t(`dashboard:controls.addPerTab.${tab}`)}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add i18n keys**

`frontend/src/i18n/resources/de/dashboard.json`:

```json
  "controls": {
    "mode": "Modus",
    "filter": "Filter",
    "addPerTab": {
      "flight": "Flug hinzufügen",
      "cruise": "Kreuzfahrt hinzufügen",
      "poi": "POI hinzufügen"
    }
  },
  "modes": {
    "overview": "Übersicht",
    "heatmap": "Heatmap",
    "journey": "Reise",
    "globe": "Globus",
    "routes": "Routen",
    "stats-map": "Flughafen-Frequenz",
    "trips": "Trips",
    "sea-routes": "Seerouten",
    "itinerary": "Itinerar",
    "port-frequency": "Hafen-Frequenz",
    "markers": "Marker"
  },
```

`frontend/src/i18n/resources/en/dashboard.json`:

```json
  "controls": {
    "mode": "Mode",
    "filter": "Filter",
    "addPerTab": {
      "flight": "Add flight",
      "cruise": "Add cruise",
      "poi": "Add POI"
    }
  },
  "modes": {
    "overview": "Overview",
    "heatmap": "Heatmap",
    "journey": "Journey",
    "globe": "Globe",
    "routes": "Routes",
    "stats-map": "Airport frequency",
    "trips": "Trips",
    "sea-routes": "Sea routes",
    "itinerary": "Itinerary",
    "port-frequency": "Port frequency",
    "markers": "Markers"
  },
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd frontend && npx vitest --run src/components/Dashboard/__tests__/DashboardControlsBar.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Dashboard/DashboardControlsBar.tsx frontend/src/components/Dashboard/__tests__/DashboardControlsBar.test.tsx frontend/src/i18n/resources/de/dashboard.json frontend/src/i18n/resources/en/dashboard.json
git commit -m "feat(dashboard): DashboardControlsBar + mode/filter/add i18n"
```

---

## Task 7: Wire nested routes `/dashboard/:tab?` in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Read existing routing structure**

```bash
grep -n "dashboard\|Dashboard" frontend/src/App.tsx
```

Take note of the current `<Route path="/" element={<DashboardPage />} />` (or whatever form). The dashboard is currently at `/`.

- [ ] **Step 2: Update App.tsx**

Replace the dashboard route with a nested structure:

```tsx
// Before:
<Route path="/" element={<DashboardPage />} />

// After:
<Route path="/" element={<Navigate to="/dashboard" replace />} />
<Route path="/dashboard" element={<DashboardPage />} />
<Route path="/dashboard/:tab" element={<DashboardPage />} />
```

Add the `Navigate` import from `react-router-dom` if not already present. Keep all other existing routes unchanged.

- [ ] **Step 3: Verify the project still compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(dashboard): nested /dashboard/:tab route"
```

---

## Task 8: Slim DashboardPage shell (tab detection + layout skeleton)

Replaces the large flight-centric `DashboardPage.tsx` with a thin shell that delegates to per-tab components. This task removes the cruise pill and the right stats panel scaffolding too.

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Create: `frontend/src/components/Dashboard/DashboardLayout.tsx`

- [ ] **Step 1: Create DashboardLayout**

```tsx
// frontend/src/components/Dashboard/DashboardLayout.tsx
import type { JSX, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import NavigationBar from "../NavigationBar";
import { DomainTabStrip } from "./DomainTabStrip";
import { DashboardControlsBar } from "./DashboardControlsBar";

interface DashboardLayoutProps {
  children: ReactNode;
  counts: { flight: number; cruise: number; poi: number };
}

export function DashboardLayout({ children, counts }: DashboardLayoutProps): JSX.Element {
  useTranslation(["dashboard"]); // ensures namespace is loaded
  const { tab, mode, setTab, setMode } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const navigate = useNavigate();

  const enabledDomains = {
    flight: isEnabled("flight"),
    cruise: isEnabled("cruise"),
    poi: isEnabled("poi"),
  };

  const handleAdd = (pickedDomain?: "flight" | "cruise" | "poi"): void => {
    const target = pickedDomain ?? (tab === "all" ? undefined : tab);
    if (target === "flight") navigate("/flights?add=1");
    else if (target === "cruise") navigate("/cruises?add=1");
    else if (target === "poi") navigate("/poi?add=1");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <NavigationBar />
      <DomainTabStrip
        active={tab}
        counts={counts}
        enabled={enabledDomains}
        onSelect={setTab}
      />
      <DashboardControlsBar
        tab={tab}
        mode={mode}
        enabledDomains={enabledDomains}
        onModeChange={setMode}
        onFilterOpen={() => {
          /* Filter modal wiring in Task 17 */
        }}
        onAdd={handleAdd}
      />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Replace DashboardPage.tsx with a thin shell**

Overwrite the entire file. Reduce from ~1100 lines to ~80:

```tsx
// frontend/src/pages/DashboardPage.tsx
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { DashboardLayout } from "../components/Dashboard/DashboardLayout";
import { useDashboardRoute } from "../hooks/useDashboardRoute";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { flightsApi } from "../lib/api";
import { cruiseApi } from "../lib/api/cruise";
import { logger } from "../lib/logger";
import { AllTab } from "../components/Dashboard/tabs/AllTab";
import { FlightsTab } from "../components/Dashboard/tabs/FlightsTab";
import { CruisesTab } from "../components/Dashboard/tabs/CruisesTab";
import { PoiTab } from "../components/Dashboard/tabs/PoiTab";

export default function DashboardPage(): JSX.Element {
  const { tab } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const [counts, setCounts] = useState({ flight: 0, cruise: 0, poi: 0 });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const flightsPromise = flightsApi.getAll({ limit: 1, offset: 0 });
        const cruisesPromise = isEnabled("cruise")
          ? cruiseApi.list({})
          : Promise.resolve([]);
        const [flights, cruises] = await Promise.all([flightsPromise, cruisesPromise]);
        if (cancelled) return;
        setCounts({
          flight: flights.total,
          cruise: cruises.length,
          poi: 0,
        });
      } catch (err) {
        logger.error("Failed to load dashboard counts:", err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  return (
    <DashboardLayout counts={counts}>
      {tab === "all" && <AllTab />}
      {tab === "flight" && <FlightsTab />}
      {tab === "cruise" && <CruisesTab />}
      {tab === "poi" && <PoiTab />}
    </DashboardLayout>
  );
}
```

- [ ] **Step 3: Stub the four tab components so the page compiles**

```tsx
// frontend/src/components/Dashboard/tabs/AllTab.tsx
import type { JSX } from "react";
export function AllTab(): JSX.Element {
  return <div style={{ padding: 24 }}>All tab — rendered by Task 12</div>;
}
```

```tsx
// frontend/src/components/Dashboard/tabs/FlightsTab.tsx
import type { JSX } from "react";
export function FlightsTab(): JSX.Element {
  return <div style={{ padding: 24 }}>Flights tab — rendered by Task 10</div>;
}
```

```tsx
// frontend/src/components/Dashboard/tabs/CruisesTab.tsx
import type { JSX } from "react";
export function CruisesTab(): JSX.Element {
  return <div style={{ padding: 24 }}>Cruises tab — rendered by Task 11</div>;
}
```

```tsx
// frontend/src/components/Dashboard/tabs/PoiTab.tsx
import type { JSX } from "react";
export function PoiTab(): JSX.Element {
  return <div style={{ padding: 24 }}>POI tab — rendered by Task 13</div>;
}
```

- [ ] **Step 4: Compile**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/components/Dashboard/DashboardLayout.tsx frontend/src/components/Dashboard/tabs/
git commit -m "refactor(dashboard): slim page shell + layout, stub per-tab components"
```

---

## Task 9: Remove the cruise pill + right stats panel from the legacy dashboard surface

The previous task replaced DashboardPage.tsx entirely, which already removes these. This task double-checks nothing leaked, and strips now-unused i18n keys.

**Files:**
- Modify: `frontend/src/i18n/resources/de/dashboard.json`
- Modify: `frontend/src/i18n/resources/en/dashboard.json`

- [ ] **Step 1: Grep for stale cruise-pill references**

```bash
grep -rn "cruiseNext\|cruiseNoneUpcoming\|cruisesTitle" frontend/src
```

Expected: only matches in the `dashboard.json` files. If any code matches, delete.

- [ ] **Step 2: Remove stale keys from both `dashboard.json` files**

From `frontend/src/i18n/resources/de/dashboard.json`, delete:

```json
  "cruises": "Kreuzfahrten",
  "cruisesTitle": "Kreuzfahrten öffnen",
  "cruiseNext": "Nächste: {{name}} · {{date}}",
  "cruiseNoneUpcoming": "Keine anstehenden Kreuzfahrten",
```

(The new `tabStrip.tabs.cruise` and `controls.addPerTab.cruise` keys cover the same territory.)

Same deletion in `frontend/src/i18n/resources/en/dashboard.json`.

- [ ] **Step 3: Run frontend tests to verify no regression**

```bash
cd frontend && npx vitest --run
```
Expected: all tests pass. If any test imports `dashboard:cruises`, update the test to use the new key.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/resources/
git commit -m "chore(dashboard): remove cruise-pill i18n keys (superseded by tab strip)"
```

---

## Task 10: FlightsTab — map + existing flight modes wired through new shell

The FlightsTab wraps the existing deck.gl map container, feeds it the active mode from `useDashboardRoute`, and handles the flight list sidebar.

**Files:**
- Modify: `frontend/src/components/Dashboard/tabs/FlightsTab.tsx`
- Read: existing `frontend/src/components/MapContainer3D.tsx` to understand its props

- [ ] **Step 1: Confirm MapContainer3D's prop shape**

```bash
grep -n "interface.*MapContainer3DProps\|type.*MapContainer3DProps\|function MapContainer3D" frontend/src/components/MapContainer3D.tsx | head -5
```

Record the props: likely `{ flights, visMode, onRouteSelect }`. The component internally renders the existing flight modes (routes, heatmap, trips — we keep these).

- [ ] **Step 2: Implement FlightsTab**

```tsx
// frontend/src/components/Dashboard/tabs/FlightsTab.tsx
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { flightsApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";
import type { Flight } from "../../../types";
import type { VisMode } from "../../../types/visMode";
import MapContainer3D from "../../MapContainer3D";

const MODE_TO_VISMODE: Record<string, VisMode> = {
  routes: "routes",
  heatmap: "heatmap",
  "stats-map": "routes", // stats-map delivered by Task 14; fallback to routes until then
  trips: "trips",
};

export function FlightsTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    let cancelled = false;
    flightsApi
      .getAll({ limit: 2000, offset: 0 })
      .then((data) => {
        if (!cancelled) setFlights(data.flights);
      })
      .catch((err) => logger.error("FlightsTab load failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const visMode = MODE_TO_VISMODE[mode] ?? "routes";

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D
        flights={flights}
        visMode={visMode}
        onRouteSelect={() => {
          /* retained behaviour; wiring preserved in later task */
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Compile + run tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run src/components/Dashboard/
```
Expected: clean tsc; tests still pass.

- [ ] **Step 4: Manual smoke**

In one terminal, start dev backend:
```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" PORT=8000 FRONTEND_URL=http://localhost:3000 NODE_ENV=development COOKIE_SECURE=false npx tsx src/index.ts
```

In another, start frontend:
```bash
cd frontend && VITE_API_URL=http://localhost:8000 npx vite --port 3000 --host 0.0.0.0
```

Open `http://localhost:3000/dashboard/flight`. Expected: flights render on the map with the "routes" mode active.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Dashboard/tabs/FlightsTab.tsx
git commit -m "feat(dashboard): FlightsTab wires existing flight modes through new shell"
```

---

## Task 11: CruisesTab — sea-routes + itinerary modes

**Files:**
- Modify: `frontend/src/components/Dashboard/tabs/CruisesTab.tsx`
- Read: existing `frontend/src/components/layers/cruiseArcsLayer.ts` + `cruisePortsLayer.ts`

- [ ] **Step 1: Review existing cruise layer code**

```bash
grep -rn "buildCruiseArcsLayer\|buildCruisePortsLayer" frontend/src | head -10
```

Record which files export cruise layer builders.

- [ ] **Step 2: Implement CruisesTab (sea-routes default, itinerary as numbered markers)**

```tsx
// frontend/src/components/Dashboard/tabs/CruisesTab.tsx
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { cruiseApi } from "../../../lib/api/cruise";
import { logger } from "../../../lib/logger";
import type { Cruise } from "../../../types/cruise";
import MapContainer3D from "../../MapContainer3D";
import { buildCruiseArcsLayer } from "../../layers/cruiseArcsLayer";
import { buildCruisePortsLayer } from "../../layers/cruisePortsLayer";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";

export function CruisesTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const [cruises, setCruises] = useState<Cruise[]>([]);

  useEffect(() => {
    let cancelled = false;
    cruiseApi
      .list({})
      .then((list) => {
        if (!cancelled) setCruises(list);
      })
      .catch((err) => logger.error("CruisesTab load failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const layers = useMemo<Layer[]>(() => {
    if (mode === "sea-routes") {
      return [buildCruiseArcsLayer(cruises), buildCruisePortsLayer(cruises)];
    }
    if (mode === "itinerary") {
      const stops = cruises.flatMap((c) =>
        c.stops
          .filter((s) => !s.isAtSea && s.port)
          .map((s, index) => ({
            lat: s.port!.lat,
            lon: s.port!.lon,
            label: String(index + 1),
            cruiseId: c.id,
          })),
      );
      return [
        new ScatterplotLayer({
          id: "itinerary-dots",
          data: stops,
          getPosition: (d) => [d.lon, d.lat],
          getFillColor: [34, 211, 238],
          getRadius: 6,
          radiusUnits: "pixels",
        }),
        new TextLayer({
          id: "itinerary-labels",
          data: stops,
          getPosition: (d) => [d.lon, d.lat],
          getText: (d) => d.label,
          getColor: [255, 255, 255],
          getSize: 12,
          background: true,
          backgroundPadding: [3, 2],
          getBackgroundColor: [34, 50, 80, 220],
        }),
      ];
    }
    if (mode === "port-frequency") {
      // Delivered fully in Task 15 — for now render sea-routes as a safe default.
      return [buildCruiseArcsLayer(cruises), buildCruisePortsLayer(cruises)];
    }
    return [buildCruiseArcsLayer(cruises), buildCruisePortsLayer(cruises)];
  }, [cruises, mode]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D flights={[]} visMode="routes" extraLayers={layers} />
    </div>
  );
}
```

- [ ] **Step 3: Extend MapContainer3D props to accept `extraLayers`**

If MapContainer3D doesn't yet accept an `extraLayers` prop, add one with fallback `[]`. Inside the component, concatenate `extraLayers` into the deck.gl layer array.

```bash
grep -n "MapContainer3DProps\|interface.*MapContainer3D\|function MapContainer3D" frontend/src/components/MapContainer3D.tsx
```

Modify the component's prop type:
```ts
extraLayers?: Layer[];
```
And inside the render:
```ts
<DeckGLMap layers={[...builtLayers, ...(extraLayers ?? [])]} ... />
```

- [ ] **Step 4: Compile + vitest**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```
Expected: clean.

- [ ] **Step 5: Manual smoke**

Open `http://localhost:3000/dashboard/cruise`. Expected: sea-routes render. Switch mode to "Itinerary" — each port gets a numbered marker.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Dashboard/tabs/CruisesTab.tsx frontend/src/components/MapContainer3D.tsx
git commit -m "feat(dashboard): CruisesTab — sea-routes + itinerary modes"
```

---

## Task 12: AllTab — layered overview + cross-domain heatmap + globe

**Files:**
- Modify: `frontend/src/components/Dashboard/tabs/AllTab.tsx`

- [ ] **Step 1: Implement AllTab**

```tsx
// frontend/src/components/Dashboard/tabs/AllTab.tsx
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useDashboardRoute } from "../../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { flightsApi } from "../../../lib/api";
import { cruiseApi } from "../../../lib/api/cruise";
import { logger } from "../../../lib/logger";
import type { Flight } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import MapContainer3D from "../../MapContainer3D";
import { buildCruiseArcsLayer } from "../../layers/cruiseArcsLayer";
import { buildCruisePortsLayer } from "../../layers/cruisePortsLayer";

export function AllTab(): JSX.Element {
  const { mode } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [cruises, setCruises] = useState<Cruise[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [flightData, cruiseData] = await Promise.all([
          flightsApi.getAll({ limit: 2000, offset: 0 }),
          isEnabled("cruise") ? cruiseApi.list({}) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setFlights(flightData.flights);
        setCruises(cruiseData);
      } catch (err) {
        logger.error("AllTab load failed", err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // Layer order: cruises bottom → flights top → (POIs on top, future).
  const cruiseLayers = useMemo(
    () =>
      isEnabled("cruise") ? [buildCruiseArcsLayer(cruises), buildCruisePortsLayer(cruises)] : [],
    [cruises, isEnabled],
  );

  if (mode === "globe") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <MapContainer3D flights={flights} visMode="globe" extraLayers={cruiseLayers} />
      </div>
    );
  }

  if (mode === "heatmap") {
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <MapContainer3D flights={flights} visMode="heatmap" extraLayers={cruiseLayers} />
      </div>
    );
  }

  if (mode === "journey") {
    // Delivered in Task 16; for now fall back to overview so the tab renders.
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <MapContainer3D flights={flights} visMode="routes" extraLayers={cruiseLayers} />
      </div>
    );
  }

  // Default "overview": routes + cruises + ports, all layered on a 2D map.
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D flights={flights} visMode="routes" extraLayers={cruiseLayers} />
    </div>
  );
}
```

- [ ] **Step 2: Compile + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```
Expected: clean.

- [ ] **Step 3: Manual smoke**

Navigate to `http://localhost:3000/dashboard` (or `/dashboard/all`). Expected: flights arcs + cruise sea-routes both visible on the world map.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Dashboard/tabs/AllTab.tsx
git commit -m "feat(dashboard): AllTab — layered overview + heatmap + globe"
```

---

## Task 13: PoiTab — coming-soon empty state

**Files:**
- Modify: `frontend/src/components/Dashboard/tabs/PoiTab.tsx`

- [ ] **Step 1: Implement the coming-soon card**

```tsx
// frontend/src/components/Dashboard/tabs/PoiTab.tsx
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";

export function PoiTab(): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const { isEnabled } = useEnabledDomains();
  const enabled = isEnabled("poi");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: 32,
          textAlign: "center",
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>📍</div>
        <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)" }}>
          {t("dashboard:poi.title")}
        </h2>
        <p style={{ color: "var(--text-muted)", margin: "0 0 24px" }}>
          {enabled ? t("dashboard:poi.enabledEmpty") : t("dashboard:poi.disabled")}
        </p>
        {!enabled && (
          <Link
            to="/settings#domains"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "var(--accent)",
              color: "#0d1117",
              borderRadius: 10,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            {t("dashboard:poi.goToSettings")}
          </Link>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys**

`frontend/src/i18n/resources/de/dashboard.json`:
```json
  "poi": {
    "title": "POIs kommen bald",
    "disabled": "Die POI-Domain ist noch nicht aktiviert. Schalte sie unter Einstellungen → Domains frei.",
    "enabledEmpty": "Noch keine POIs erfasst.",
    "goToSettings": "Zu den Einstellungen"
  },
```

`frontend/src/i18n/resources/en/dashboard.json`:
```json
  "poi": {
    "title": "POIs coming soon",
    "disabled": "The POI domain is not yet enabled. Activate it under Settings → Domains.",
    "enabledEmpty": "No POIs yet.",
    "goToSettings": "Open settings"
  },
```

- [ ] **Step 3: Compile + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Dashboard/tabs/PoiTab.tsx frontend/src/i18n/resources/
git commit -m "feat(dashboard): PoiTab coming-soon empty state"
```

---

## Task 14: StatsMapMode — airport frequency markers (flights)

**Files:**
- Create: `frontend/src/components/Dashboard/modes/buildStatsMapLayer.ts`
- Create: `frontend/src/components/Dashboard/modes/__tests__/buildStatsMapLayer.test.ts`
- Modify: `frontend/src/components/Dashboard/tabs/FlightsTab.tsx`

- [ ] **Step 1: Write the failing reducer test**

```typescript
// frontend/src/components/Dashboard/modes/__tests__/buildStatsMapLayer.test.ts
import { describe, it, expect } from "vitest";
import { computeAirportStats } from "../buildStatsMapLayer";
import type { Flight } from "../../../../types";

function f(dep: string, arr: string): Flight {
  return {
    id: `${dep}-${arr}`,
    departureIata: dep,
    arrivalIata: arr,
    departureAirport: { iata: dep, lat: 0, lon: 0, name: dep, city: dep, country: "--" },
    arrivalAirport: { iata: arr, lat: 0, lon: 0, name: arr, city: arr, country: "--" },
  } as unknown as Flight;
}

describe("computeAirportStats", () => {
  it("counts each airport touch exactly once per flight (dep + arr)", () => {
    const flights = [f("FRA", "JFK"), f("FRA", "LHR"), f("LHR", "FRA")];
    const stats = computeAirportStats(flights);
    const byIata = Object.fromEntries(stats.map((s) => [s.iata, s.count]));
    expect(byIata.FRA).toBe(3);
    expect(byIata.JFK).toBe(1);
    expect(byIata.LHR).toBe(2);
  });

  it("skips flights without IATA on one side", () => {
    const flights = [f("FRA", "JFK"), { ...f("", "LHR") } as unknown as Flight];
    const stats = computeAirportStats(flights);
    expect(stats.length).toBe(3); // FRA, JFK, LHR
  });
});
```

- [ ] **Step 2: Run test — FAIL**

```bash
cd frontend && npx vitest --run src/components/Dashboard/modes/__tests__/buildStatsMapLayer.test.ts
```

- [ ] **Step 3: Implement the layer builder**

```typescript
// frontend/src/components/Dashboard/modes/buildStatsMapLayer.ts
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../../../types";

export interface AirportStat {
  iata: string;
  name: string;
  lat: number;
  lon: number;
  count: number;
}

export function computeAirportStats(flights: readonly Flight[]): AirportStat[] {
  const byIata = new Map<string, AirportStat>();
  const touch = (ap: Flight["departureAirport"]): void => {
    if (!ap?.iata || typeof ap.lat !== "number" || typeof ap.lon !== "number") return;
    const existing = byIata.get(ap.iata);
    if (existing) {
      byIata.set(ap.iata, { ...existing, count: existing.count + 1 });
    } else {
      byIata.set(ap.iata, {
        iata: ap.iata,
        name: ap.name ?? ap.iata,
        lat: ap.lat,
        lon: ap.lon,
        count: 1,
      });
    }
  };
  for (const f of flights) {
    touch(f.departureAirport);
    touch(f.arrivalAirport);
  }
  return Array.from(byIata.values());
}

export function buildStatsMapLayer(flights: readonly Flight[]): Layer {
  const stats = computeAirportStats(flights);
  const max = stats.reduce((m, s) => (s.count > m ? s.count : m), 1);
  return new ScatterplotLayer({
    id: "stats-map-airports",
    data: stats,
    getPosition: (d: AirportStat) => [d.lon, d.lat],
    getRadius: (d: AirportStat) => 3 + 20 * (d.count / max),
    radiusUnits: "pixels",
    getFillColor: [245, 158, 11, 220],
    pickable: true,
  });
}
```

- [ ] **Step 4: Run test — PASS**

```bash
cd frontend && npx vitest --run src/components/Dashboard/modes/__tests__/buildStatsMapLayer.test.ts
```

- [ ] **Step 5: Wire into FlightsTab (replace the fallback)**

In `FlightsTab.tsx`, import the builder and branch on mode:

```tsx
import { buildStatsMapLayer } from "../modes/buildStatsMapLayer";
// …
const layers = useMemo<Layer[]>(() => {
  if (mode === "stats-map") return [buildStatsMapLayer(flights)];
  return [];
}, [mode, flights]);
// Render:
<MapContainer3D flights={flights} visMode={visMode} extraLayers={layers} />
```

Also remove the stats-map entry from `MODE_TO_VISMODE` since it's now handled via the extraLayers path. When `mode === 'stats-map'`, pass `visMode="routes"` but set `flights={[]}` so arcs don't also render. Keep `flights={flights}` in `extraLayers` only.

- [ ] **Step 6: Compile + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Dashboard/modes/ frontend/src/components/Dashboard/tabs/FlightsTab.tsx
git commit -m "feat(dashboard): stats-map mode — airport frequency markers"
```

---

## Task 15: PortFrequencyMode — port markers scaled by repeat visits

**Files:**
- Create: `frontend/src/components/Dashboard/modes/buildPortFrequencyLayer.ts`
- Create: `frontend/src/components/Dashboard/modes/__tests__/buildPortFrequencyLayer.test.ts`
- Modify: `frontend/src/components/Dashboard/tabs/CruisesTab.tsx`

- [ ] **Step 1: Write the failing reducer test**

```typescript
// frontend/src/components/Dashboard/modes/__tests__/buildPortFrequencyLayer.test.ts
import { describe, it, expect } from "vitest";
import { computePortFrequency } from "../buildPortFrequencyLayer";
import type { Cruise } from "../../../../types/cruise";

function cruise(id: string, portIds: number[]): Cruise {
  return {
    id,
    stops: portIds.map((pid, idx) => ({
      id: `${id}-${idx}`,
      cruiseId: id,
      portId: pid,
      port: { id: pid, name: `Port ${pid}`, lat: pid, lon: pid, city: null, country: null, unlocode: null, timezone: null, region: null, isUserAdded: false },
      dayNumber: idx + 1,
      isAtSea: false,
      arrivalTime: null,
      departureTime: null,
      excursionNote: null,
    })),
  } as unknown as Cruise;
}

describe("computePortFrequency", () => {
  it("counts visits per port across all cruises", () => {
    const cruises = [cruise("a", [1, 2, 3]), cruise("b", [2, 3, 3])];
    const freq = computePortFrequency(cruises);
    const byId = Object.fromEntries(freq.map((p) => [p.portId, p.count]));
    expect(byId[1]).toBe(1);
    expect(byId[2]).toBe(2);
    expect(byId[3]).toBe(3);
  });
  it("ignores sea-days and stops without a port", () => {
    const c = cruise("x", [1]);
    c.stops.push({
      id: "x-sea",
      cruiseId: "x",
      portId: null,
      port: null,
      dayNumber: 2,
      isAtSea: true,
      arrivalTime: null,
      departureTime: null,
      excursionNote: null,
    });
    const freq = computePortFrequency([c]);
    expect(freq.length).toBe(1);
    expect(freq[0].portId).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

```bash
cd frontend && npx vitest --run src/components/Dashboard/modes/__tests__/buildPortFrequencyLayer.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// frontend/src/components/Dashboard/modes/buildPortFrequencyLayer.ts
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise, Port } from "../../../types/cruise";

export interface PortFrequency {
  portId: number;
  port: Port;
  count: number;
}

export function computePortFrequency(cruises: readonly Cruise[]): PortFrequency[] {
  const byPort = new Map<number, PortFrequency>();
  for (const c of cruises) {
    for (const s of c.stops) {
      if (s.isAtSea || s.port === null || s.portId === null) continue;
      const existing = byPort.get(s.portId);
      if (existing) {
        byPort.set(s.portId, { ...existing, count: existing.count + 1 });
      } else {
        byPort.set(s.portId, { portId: s.portId, port: s.port, count: 1 });
      }
    }
  }
  return Array.from(byPort.values());
}

export function buildPortFrequencyLayer(cruises: readonly Cruise[]): Layer {
  const data = computePortFrequency(cruises);
  const max = data.reduce((m, p) => (p.count > m ? p.count : m), 1);
  return new ScatterplotLayer({
    id: "port-frequency",
    data,
    getPosition: (d: PortFrequency) => [d.port.lon, d.port.lat],
    getRadius: (d: PortFrequency) => 4 + 18 * (d.count / max),
    radiusUnits: "pixels",
    getFillColor: [34, 211, 238, 230],
    pickable: true,
  });
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Wire into CruisesTab**

In `CruisesTab.tsx`, replace the `port-frequency` branch's placeholder:

```tsx
import { buildPortFrequencyLayer } from "../modes/buildPortFrequencyLayer";
// …
if (mode === "port-frequency") {
  return [buildPortFrequencyLayer(cruises)];
}
```

- [ ] **Step 6: Compile + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Dashboard/modes/ frontend/src/components/Dashboard/tabs/CruisesTab.tsx
git commit -m "feat(dashboard): port-frequency mode"
```

---

## Task 16: JourneyMode — cross-domain trip as one story

**Files:**
- Create: `frontend/src/components/Dashboard/modes/buildJourneyLayers.ts`
- Create: `frontend/src/components/Dashboard/modes/__tests__/buildJourneyLayers.test.ts`
- Modify: `frontend/src/components/Dashboard/tabs/AllTab.tsx`

- [ ] **Step 1: Write the failing reducer test**

```typescript
// frontend/src/components/Dashboard/modes/__tests__/buildJourneyLayers.test.ts
import { describe, it, expect } from "vitest";
import { groupByTripId } from "../buildJourneyLayers";
import type { Flight } from "../../../../types";
import type { Cruise } from "../../../../types/cruise";

function f(id: string, tripId: string | null): Flight {
  return { id, tripId } as unknown as Flight;
}
function c(id: string, tripId: string | null): Cruise {
  return { id, tripId } as unknown as Cruise;
}

describe("groupByTripId", () => {
  it("groups flights + cruises by shared tripId", () => {
    const flights = [f("f1", "t1"), f("f2", "t1"), f("f3", null)];
    const cruises = [c("c1", "t1"), c("c2", "t2")];
    const groups = groupByTripId(flights, cruises);
    expect(Object.keys(groups).sort()).toEqual(["t1", "t2"]);
    expect(groups.t1.flights.map((x) => x.id)).toEqual(["f1", "f2"]);
    expect(groups.t1.cruises.map((x) => x.id)).toEqual(["c1"]);
    expect(groups.t2.cruises.map((x) => x.id)).toEqual(["c2"]);
  });
  it("ignores entries without tripId", () => {
    const groups = groupByTripId([f("x", null)], [c("y", null)]);
    expect(Object.keys(groups).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement**

```typescript
// frontend/src/components/Dashboard/modes/buildJourneyLayers.ts
import type { Flight } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import { ArcLayer, LineLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { buildCruiseArcsLayer } from "../../layers/cruiseArcsLayer";

export interface TripGroup {
  flights: Flight[];
  cruises: Cruise[];
}

export function groupByTripId(
  flights: readonly Flight[],
  cruises: readonly Cruise[],
): Record<string, TripGroup> {
  const out: Record<string, TripGroup> = {};
  for (const f of flights) {
    const tid = (f as unknown as { tripId: string | null }).tripId;
    if (!tid) continue;
    if (!out[tid]) out[tid] = { flights: [], cruises: [] };
    out[tid].flights.push(f);
  }
  for (const c of cruises) {
    if (!c.tripId) continue;
    if (!out[c.tripId]) out[c.tripId] = { flights: [], cruises: [] };
    out[c.tripId].cruises.push(c);
  }
  return out;
}

export function buildJourneyLayers(
  flights: readonly Flight[],
  cruises: readonly Cruise[],
  selectedTripId: string | null,
): Layer[] {
  const groups = groupByTripId(flights, cruises);
  const pickTrip = (): TripGroup | null => {
    if (selectedTripId && groups[selectedTripId]) return groups[selectedTripId];
    const keys = Object.keys(groups);
    return keys.length > 0 ? groups[keys[0]] : null;
  };
  const trip = pickTrip();
  if (!trip) return [];

  const layers: Layer[] = [];
  if (trip.cruises.length > 0) {
    layers.push(buildCruiseArcsLayer(trip.cruises));
  }
  if (trip.flights.length > 0) {
    layers.push(
      new ArcLayer({
        id: "journey-flight-arcs",
        data: trip.flights,
        getSourcePosition: (f: unknown) => {
          const flight = f as Flight;
          return [flight.departureAirport?.lon ?? 0, flight.departureAirport?.lat ?? 0];
        },
        getTargetPosition: (f: unknown) => {
          const flight = f as Flight;
          return [flight.arrivalAirport?.lon ?? 0, flight.arrivalAirport?.lat ?? 0];
        },
        getSourceColor: [245, 158, 11, 220],
        getTargetColor: [245, 158, 11, 220],
        getWidth: 2,
      }),
    );
  }
  return layers;
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Wire into AllTab**

Replace the `journey` branch in `AllTab.tsx`:

```tsx
import { buildJourneyLayers } from "../modes/buildJourneyLayers";
// …
if (mode === "journey") {
  const layers = buildJourneyLayers(flights, cruises, null);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <MapContainer3D flights={[]} visMode="routes" extraLayers={layers} />
    </div>
  );
}
```

- [ ] **Step 6: Compile + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Dashboard/modes/ frontend/src/components/Dashboard/tabs/AllTab.tsx
git commit -m "feat(dashboard): journey mode — cross-domain trip visualisation"
```

---

## Task 17: Filter dropdown with time-range slider + domain sections

**Files:**
- Create: `frontend/src/components/Dashboard/DashboardFilterDropdown.tsx`
- Modify: `frontend/src/components/Dashboard/DashboardLayout.tsx`

- [ ] **Step 1: Implement the dropdown**

```tsx
// frontend/src/components/Dashboard/DashboardFilterDropdown.tsx
import { useRef, useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";

interface DashboardFilterDropdownProps {
  tab: DashboardTab;
  open: boolean;
  onClose(): void;
}

export function DashboardFilterDropdown({
  tab,
  open,
  onClose,
}: DashboardFilterDropdownProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  const containerRef = useRef<HTMLDivElement>(null);

  const time = useDashboardFilterStore((s) => s.time);
  const setTimeRange = useDashboardFilterStore((s) => s.setTimeRange);
  const flight = useDashboardFilterStore((s) => s.flight);
  const setFlightFilter = useDashboardFilterStore((s) => s.setFlightFilter);
  const cruise = useDashboardFilterStore((s) => s.cruise);
  const setCruiseFilter = useDashboardFilterStore((s) => s.setCruiseFilter);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 48,
        left: 120,
        zIndex: 40,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: 16,
        width: 320,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
          {t("dashboard:filter.timeFrom")}
        </label>
        <input
          type="date"
          value={time.from ?? ""}
          onChange={(e) => setTimeRange(e.target.value || null, time.to)}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
          {t("dashboard:filter.timeTo")}
        </label>
        <input
          type="date"
          value={time.to ?? ""}
          onChange={(e) => setTimeRange(time.from, e.target.value || null)}
          style={{ width: "100%" }}
        />
      </div>

      {tab === "flight" && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
            {t("dashboard:filter.airline")}
          </label>
          <input
            type="text"
            value={flight.airline ?? ""}
            onChange={(e) => setFlightFilter({ airline: e.target.value || undefined })}
            style={{ width: "100%" }}
          />
        </div>
      )}

      {tab === "cruise" && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
            {t("dashboard:filter.cruiseLine")}
          </label>
          <input
            type="text"
            value={cruise.cruiseLine ?? ""}
            onChange={(e) => setCruiseFilter({ cruiseLine: e.target.value || undefined })}
            style={{ width: "100%" }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into DashboardLayout**

Add state + pass `onFilterOpen` to the controls bar:

```tsx
// In DashboardLayout.tsx — add near the top:
import { useState } from "react";
import { DashboardFilterDropdown } from "./DashboardFilterDropdown";

// Inside the component:
const [filterOpen, setFilterOpen] = useState(false);

// In the JSX, wrap ControlsBar + Dropdown:
<div style={{ position: "relative" }}>
  <DashboardControlsBar
    ...
    onFilterOpen={() => setFilterOpen((p) => !p)}
    ...
  />
  <DashboardFilterDropdown tab={tab} open={filterOpen} onClose={() => setFilterOpen(false)} />
</div>
```

- [ ] **Step 3: Add i18n keys**

`frontend/src/i18n/resources/de/dashboard.json`:
```json
  "filter": {
    "timeFrom": "Von",
    "timeTo": "Bis",
    "airline": "Airline",
    "cruiseLine": "Reederei",
    "category": "Kategorie"
  },
```

`frontend/src/i18n/resources/en/dashboard.json`:
```json
  "filter": {
    "timeFrom": "From",
    "timeTo": "To",
    "airline": "Airline",
    "cruiseLine": "Cruise line",
    "category": "Category"
  },
```

- [ ] **Step 4: Compile + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Dashboard/DashboardFilterDropdown.tsx frontend/src/components/Dashboard/DashboardLayout.tsx frontend/src/i18n/resources/
git commit -m "feat(dashboard): filter dropdown — time range + per-domain sections"
```

---

## Task 18: Sidebars per tab (list + activity feed)

**Files:**
- Create: `frontend/src/components/Dashboard/sidebars/CruiseListPanel.tsx`
- Create: `frontend/src/components/Dashboard/sidebars/UnifiedActivityPanel.tsx`
- Modify: `frontend/src/components/Dashboard/DashboardLayout.tsx`
- Reuse: existing `FlightPanel` for the Flights tab

- [ ] **Step 1: Build CruiseListPanel**

```tsx
// frontend/src/components/Dashboard/sidebars/CruiseListPanel.tsx
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import type { Cruise } from "../../../types/cruise";

interface CruiseListPanelProps {
  cruises: Cruise[];
  isOpen: boolean;
  onClose(): void;
}

export function CruiseListPanel({ cruises, isOpen, onClose }: CruiseListPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 320,
        background: "rgba(22,27,34,0.95)",
        borderRight: "1px solid var(--color-border)",
        zIndex: 20,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <strong>{t("dashboard:sidebar.cruises")}</strong>
        <button onClick={onClose}>×</button>
      </div>
      {cruises.length === 0 ? (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.emptyCruises")}
        </p>
      ) : (
        cruises.map((c) => (
          <Link
            key={c.id}
            to={`/cruises/${c.id}`}
            style={{
              display: "block",
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border)",
              color: "var(--text-primary)",
              textDecoration: "none",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "Cruise"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {c.startDate?.slice(0, 10) ?? "—"} · {c.stops.length} {t("dashboard:sidebar.ports")}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build UnifiedActivityPanel**

```tsx
// frontend/src/components/Dashboard/sidebars/UnifiedActivityPanel.tsx
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { Flight } from "../../../types";
import type { Cruise } from "../../../types/cruise";

interface ActivityItem {
  id: string;
  kind: "flight" | "cruise";
  label: string;
  date: string;
}

interface UnifiedActivityPanelProps {
  flights: Flight[];
  cruises: Cruise[];
  isOpen: boolean;
  onClose(): void;
}

export function UnifiedActivityPanel({
  flights,
  cruises,
  isOpen,
  onClose,
}: UnifiedActivityPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  if (!isOpen) return null;

  const items: ActivityItem[] = [
    ...flights.map((f) => ({
      id: `f-${f.id}`,
      kind: "flight" as const,
      label: `${f.departureIata ?? "?"} → ${f.arrivalIata ?? "?"}`,
      date: (f as unknown as { date: string }).date ?? "",
    })),
    ...cruises.map((c) => ({
      id: `c-${c.id}`,
      kind: "cruise" as const,
      label: c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "Cruise",
      date: c.startDate?.slice(0, 10) ?? "",
    })),
  ]
    .filter((x) => x.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 50);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 320,
        background: "rgba(22,27,34,0.95)",
        borderRight: "1px solid var(--color-border)",
        zIndex: 20,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <strong>{t("dashboard:sidebar.activity")}</strong>
        <button onClick={onClose}>×</button>
      </div>
      {items.length === 0 ? (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.emptyActivity")}
        </p>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 13,
            }}
          >
            <span style={{ marginRight: 8 }}>{item.kind === "flight" ? "✈" : "⚓"}</span>
            <strong>{item.label}</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>· {item.date}</span>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add i18n keys**

`frontend/src/i18n/resources/de/dashboard.json`:
```json
  "sidebar": {
    "cruises": "Kreuzfahrten",
    "activity": "Aktivität",
    "ports": "Häfen",
    "emptyCruises": "Noch keine Kreuzfahrten.",
    "emptyActivity": "Noch keine Aktivität."
  },
```

`frontend/src/i18n/resources/en/dashboard.json`:
```json
  "sidebar": {
    "cruises": "Cruises",
    "activity": "Activity",
    "ports": "ports",
    "emptyCruises": "No cruises yet.",
    "emptyActivity": "No activity yet."
  },
```

- [ ] **Step 4: Wire sidebars into each tab**

Each tab component accepts a shared `isSidebarOpen` / `onSidebarClose` pair. Add the sidebar inside the tab render at position:absolute top-0 left-0. Already provided by the panel components above.

- [ ] **Step 5: Compile + tests**

```bash
cd frontend && npx tsc --noEmit && npx vitest --run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Dashboard/sidebars/ frontend/src/components/Dashboard/ frontend/src/i18n/resources/
git commit -m "feat(dashboard): cruise list + unified activity sidebars"
```

---

## Task 19: Retire the global `VisMode` type

**Files:**
- Delete: `frontend/src/types/visMode.ts`
- Update: every importer found by grep

- [ ] **Step 1: Find callers**

```bash
grep -rn "from \"./types/visMode\"\|from \"../types/visMode\"\|from \"../../types/visMode\"" frontend/src
```

- [ ] **Step 2: Replace `VisMode` imports with the local per-tab types**

Inside MapContainer3D, the `visMode` prop is still used — keep an internal `type LegacyVisMode = 'routes' | 'heatmap' | 'trips' | 'globe'` to preserve the internal switch statement. Remove cases for `hexagon`, `columns`, `contour`, `trip-routes` from that internal switch.

- [ ] **Step 3: Delete the file**

```bash
rm frontend/src/types/visMode.ts
```

- [ ] **Step 4: Compile**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(dashboard): retire global VisMode type"
```

---

## Task 20: E2E Playwright tests

**Files:**
- Create: `frontend/tests/e2e/dashboard-multi-domain.spec.ts` (or appropriate existing e2e directory)

- [ ] **Step 1: Locate existing Playwright suite**

```bash
find . -path '*node_modules*' -prune -o -name 'playwright.config*' -print
```

- [ ] **Step 2: Write the e2e spec**

```typescript
// frontend/tests/e2e/dashboard-multi-domain.spec.ts (adjust path per existing layout)
import { test, expect } from "@playwright/test";

test.describe("Multi-domain dashboard", () => {
  test("default lands on All tab with overview mode", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("tab", { name: /all/i })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("deep link to /dashboard/cruise?mode=itinerary renders that view", async ({ page }) => {
    await page.goto("/dashboard/cruise?mode=itinerary");
    await expect(page.getByRole("tab", { name: /cruise/i })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: /Itinerar|Itinerary/i })).toBeVisible();
  });

  test("mode change updates URL and persists across reload", async ({ page }) => {
    await page.goto("/dashboard/flight");
    await page.getByRole("button", { name: /Routen|Routes/i }).click();
    await page.getByRole("menuitem", { name: /Heatmap/i }).click();
    await expect(page).toHaveURL(/mode=heatmap/);

    await page.reload();
    await expect(page).toHaveURL(/mode=heatmap/);
  });

  test("tab switch preserves URL+localStorage round-trip", async ({ page }) => {
    await page.goto("/dashboard/flight?mode=heatmap");
    await page.getByRole("tab", { name: /cruise/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/cruise$/);
    await page.getByRole("tab", { name: /flight/i }).click();
    // Mode last used for flights was heatmap — should reappear.
    await expect(page).toHaveURL(/\/dashboard\/flight/);
  });

  test("All tab + button opens the domain picker", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Hinzufügen|Add/i }).click();
    await expect(page.getByRole("menuitem", { name: /Flug|Flight/i })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run Playwright**

```bash
cd frontend && npx playwright test dashboard-multi-domain.spec.ts
```
Expected: all green (requires backend + frontend dev servers running, or Playwright webServer config).

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/e2e/dashboard-multi-domain.spec.ts
git commit -m "test(dashboard): e2e — default, deep link, mode persistence, tab switch, add picker"
```

---

## Task 21: Update CLAUDE.md + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the cruise gotcha paragraph**

Replace the existing "Cruise sea-routes" block in `CLAUDE.md` with a short paragraph that also mentions the tab structure:

```md
- **Cruise sea-routes** — `backend/src/services/seaRouter.ts` runs the Hybrid v2 pipeline. The dashboard renders cruises on the map via the Cruises tab (mode `sea-routes`). `buildCruiseArc` on the frontend is still the last-resort fallback when the backend returns no geometry for a leg.
- **Dashboard is multi-domain** — `frontend/src/pages/DashboardPage.tsx` is a thin shell; per-domain tabs live in `frontend/src/components/Dashboard/tabs/`. Modes are domain-scoped via `frontend/src/types/dashboard.ts`. URL carries tab + mode; localStorage remembers last mode per domain.
```

- [ ] **Step 2: Final test sweep**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

All must pass.

- [ ] **Step 3: Manual smoke on dev**

Spin backend + frontend dev servers (same commands as Task 10 step 4). Check each tab:
- `/dashboard` → All, overview shows flights + cruises layered
- `/dashboard/flight` → flight arcs, mode dropdown lists 4 modes
- `/dashboard/cruise` → sea-routes, switch to itinerary shows numbered ports
- `/dashboard/poi` → coming-soon card (if POI domain disabled)
- Tab-Strip shows counts; clicking cycles between tabs; reload restores URL

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update cruise + dashboard gotchas for multi-domain redesign"
```

---

## Task 22: Final merge-readiness check

- [ ] **Step 1: Confirm branch is ready**

```bash
git status
git log --oneline dev/multi-domain-v1 -20
```

- [ ] **Step 2: Run the full backend build-check suite** (required per CLAUDE.md before any deploy)

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
```

- [ ] **Step 3: Run the full frontend build-check suite**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

- [ ] **Step 4: Report status to the user**

Summary message listing:
- Total commits since branch start
- Test pass counts
- Manual smoke outcome per tab
- Any deferred items for follow-up

Stop. Do NOT merge to main automatically — user does that after review.

---

## Self-review checklist (completed inline during authoring)

- Every referenced symbol is defined in this plan or the codebase (checked)
- No "TBD" / "TODO" / "similar to Task N" placeholders (checked)
- Every task lists exact files, exact code, exact commands, expected output
- Commit message ladder is consistent (`feat(dashboard): …`, `chore(…)`, `refactor(…)`, `test(…)`, `docs(…)`)
- Task dependency graph is acyclic and each task is self-contained for a fresh subagent
