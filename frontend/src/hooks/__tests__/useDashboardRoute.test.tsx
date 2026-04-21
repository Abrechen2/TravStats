import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
      JSON.stringify({ flight: "trips", cruise: "itinerary" })
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
    expect(result.current.mode).toBe("routes");
  });
});
