import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// jsdom has no WebGL2, and without it the registry answers with each tab's
// FLAT fallback (see `defaultModeForTab`). Everything below is about the
// ruling's default, so the device says yes; the fallback has its own test in
// `types/__tests__/dashboard.test.ts`.
vi.mock("../../lib/webgl2", () => ({ webgl2Available: true }));
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useDashboardRoute } from "../useDashboardRoute";
import type { ReactNode } from "react";

const LAST_MODE_KEY = "travstats:dashboard:lastMode";

function wrapper(initialEntries: string[]): (props: { children: ReactNode }) => JSX.Element {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/dashboard" element={children} />
          <Route path="/dashboard/:tab" element={children} />
        </Routes>
      </MemoryRouter>
    );
  }
  return Wrapper;
}

describe("useDashboardRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  // Owner ruling 2026-09-20, from two screenshots of the same selection:
  // "Globus soll ueberall genutzt werden". So the sphere is what a tab opens
  // on when the reader has never said otherwise — and only then.
  it("defaults to the globe when nothing is stored", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.tab).toBe("all");
    expect(result.current.mode).toBe("globe");
  });

  it("defaults to the globe on every tab that offers one", () => {
    for (const tab of ["flight", "cruise", "lodging", "tour", "poi"]) {
      window.localStorage.clear();
      const { result } = renderHook(() => useDashboardRoute(), {
        wrapper: wrapper([`/dashboard/${tab}`]),
      });
      expect(result.current.mode, `${tab} should open on the globe`).toBe("globe");
    }
  });

  it("respects a stored FLAT choice over the globe default", () => {
    window.localStorage.setItem(LAST_MODE_KEY, JSON.stringify({ flight: "heatmap" }));
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    expect(result.current.mode).toBe("heatmap");
  });

  // The "Reise" view is a view, not a projection — picking it must not erase
  // which projection the reader last chose, or journey could never honour it.
  it("reports the projection behind the stored mode, and journey does not overwrite it", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard?mode=heatmap"]),
    });
    expect(result.current.projection).toBe("flat");

    act(() => {
      result.current.setMode("journey");
    });
    expect(result.current.projection).toBe("flat");
  });

  it("reports the globe projection when nothing has been chosen", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.projection).toBe("globe");
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
      JSON.stringify({ flight: "trips", cruise: "itinerary" })
    );
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    expect(result.current.mode).toBe("trips");
  });

  it("invalid URL mode for the active tab → tab default, no crash", () => {
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight?mode=sea-routes"]),
    });
    expect(result.current.mode).toBe("globe");
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
    expect(result.current.mode).toBe("heatmap");
  });

  it("setTab navigates to tab-specific URL, or /dashboard for 'all'", async () => {
    const { result, rerender } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    expect(result.current.tab).toBe("flight");
    act(() => {
      result.current.setTab("cruise");
    });
    rerender();
    expect(result.current.tab).toBe("cruise");

    act(() => {
      result.current.setTab("all");
    });
    rerender();
    expect(result.current.tab).toBe("all");
  });

  it("obsolete localStorage mode name ignored in favour of tab default", () => {
    window.localStorage.setItem(LAST_MODE_KEY, JSON.stringify({ flight: "hexagon" }));
    const { result } = renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight"]),
    });
    expect(result.current.mode).toBe("globe");
  });

  it("URL-set mode persists to localStorage so tab-switch round-trip restores it", () => {
    renderHook(() => useDashboardRoute(), {
      wrapper: wrapper(["/dashboard/flight?mode=heatmap"]),
    });
    const stored = JSON.parse(window.localStorage.getItem(LAST_MODE_KEY) ?? "{}");
    expect(stored.flight).toBe("heatmap");
  });
});
