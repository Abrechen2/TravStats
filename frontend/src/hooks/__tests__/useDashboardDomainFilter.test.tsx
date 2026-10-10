import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactNode } from "react";
import { useDashboardDomainFilter } from "../useDashboardDomainFilter";
import { useDashboardDomainFilterStore } from "../../store/dashboardDomainFilterStore";
import { useDashboardCountsStore } from "../../store/dashboardCountsStore";
import { useSettingsStore } from "../../store/settingsStore";

// Real stores: `enabledDomains`/`betaFeaturesEnabled` decide which of the seven
// rows exist at all, which is exactly what this suite is testing.
vi.unmock("../../store/settingsStore");

function wrapper(initialEntries: string[]): (props: { children: ReactNode }) => JSX.Element {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/dashboard" element={children} />
        </Routes>
      </MemoryRouter>
    );
  }
  return Wrapper;
}

describe("useDashboardDomainFilter", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDashboardDomainFilterStore.setState({ hidden: new Set(), linkHidden: null });
    useDashboardCountsStore.setState({
      counts: { flight: 3, cruise: 1, poi: 0, lodging: 2, roadtrip: 0, rail: 0 },
      scheduledCounts: { flight: 0, cruise: 0, lodging: 0 },
      countsLoaded: true,
    });
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi"],
      betaFeaturesEnabled: false,
    });
  });

  it("only lists rows for domains the user enabled — tour/roadtrip stay out while beta is off", () => {
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    const keys = result.current.rows.map((r) => r.key);
    expect(keys).toEqual(["flight", "cruise", "lodging", "poi"]);
  });

  it("adds tour and roadtrip once the roadtrips beta key and the domain are both on", () => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi", "roadtrip"],
      betaFeaturesEnabled: true,
    });
    const { result } = renderHook(() => useDashboardDomainFilter(4), {
      wrapper: wrapper(["/dashboard"]),
    });
    const keys = result.current.rows.map((r) => r.key);
    expect(keys).toEqual(["flight", "cruise", "lodging", "poi", "tour", "roadtrip"]);
    const tourRow = result.current.rows.find((r) => r.key === "tour");
    expect(tourRow?.count).toBe(4);
    expect(tourRow?.beta).toBe(true);
  });

  it("rail is the seventh row, last and beta-labelled, once its gate and the domain are on", () => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi", "roadtrip", "rail"],
      betaFeaturesEnabled: true,
    });
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    const keys = result.current.rows.map((r) => r.key);
    expect(keys).toEqual(["flight", "cruise", "lodging", "poi", "tour", "roadtrip", "rail"]);
    expect(result.current.rows.find((r) => r.key === "rail")?.beta).toBe(true);
  });

  it("rail stays out while its beta gate is closed, even when the domain is enabled", () => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "cruise", "lodging", "poi", "rail"],
      betaFeaturesEnabled: false,
    });
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.rows.map((r) => r.key)).not.toContain("rail");
  });

  it("a row with count 0 still appears, ticked", () => {
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    const poiRow = result.current.rows.find((r) => r.key === "poi");
    expect(poiRow?.count).toBe(0);
    expect(poiRow?.visible).toBe(true);
  });

  it("?domains= seeds a link selection without touching the reader's own storage", () => {
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard?domains=flight"]),
    });
    expect(result.current.isLinkMode).toBe(true);
    expect(result.current.isVisible("flight")).toBe(true);
    expect(result.current.isVisible("cruise")).toBe(false);
    expect(window.localStorage.getItem("travstats.dashboard.hiddenDomains.v1")).toBeNull();
  });

  it("no ?domains= param means the reader's own stored selection applies", () => {
    useDashboardDomainFilterStore.getState().toggle("cruise");
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.isLinkMode).toBe(false);
    expect(result.current.isVisible("cruise")).toBe(false);
  });

  it("isEmpty is true only when every available row is unticked", () => {
    useDashboardDomainFilterStore.getState().showNone();
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.visibleCount).toBe(0);
  });

  // forgejo#180: bus beside rail, behind its own beta gate and the user's domain.
  it("bus sits beside rail once its gate and the domain are on, with an unknown count", () => {
    useSettingsStore.setState({
      enabledDomains: ["flight", "rail", "bus"],
      betaFeaturesEnabled: true,
    });
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.rows.map((r) => r.key)).toEqual(["flight", "tour", "rail", "bus"]);
    const bus = result.current.rows.find((r) => r.key === "bus");
    expect(bus?.count).toBeNull();
    expect(bus?.beta).toBe(true);
  });

  it("bus stays out while its beta gate is closed", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "bus"], betaFeaturesEnabled: false });
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    expect(result.current.rows.map((r) => r.key)).not.toContain("bus");
  });

  it("isolating bus keeps the reader on 'Alle' with only bus visible — it has no view of its own", () => {
    useSettingsStore.setState({ enabledDomains: ["flight", "bus"], betaFeaturesEnabled: true });
    const { result } = renderHook(() => useDashboardDomainFilter(0), {
      wrapper: wrapper(["/dashboard"]),
    });
    act(() => result.current.isolate("bus"));
    expect(result.current.isVisible("bus")).toBe(true);
    expect(result.current.isVisible("flight")).toBe(false);
  });
});
