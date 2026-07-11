import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { DomainStatsMap, UseDomainStatsResult } from "../../../../lib/stats/domain-stats";

// Use the real settingsStore (not the global selector-only mock from
// setup.ts) so useEnabledDomains() returns real state we control below.
vi.unmock("../../../../store/settingsStore");

// useDomainStats fetches from statsApi/cruiseApi — replace with a
// controllable mock so each test can hand OverviewTab a fixed data set
// without a real network layer.
vi.mock("../../../../lib/stats/domain-stats", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../lib/stats/domain-stats")>(
      "../../../../lib/stats/domain-stats"
    );
  return { ...actual, useDomainStats: vi.fn() };
});

import OverviewTab from "../OverviewTab";
import { useSettingsStore } from "../../../../store/settingsStore";
import { useStatsCompareStore } from "../../../../store/statsCompareStore";
import { useDomainStats } from "../../../../lib/stats/domain-stats";

function flightStats(yearlyEvents: Record<number, number>): DomainStatsMap {
  const yearlyActiveDays = { ...yearlyEvents };
  return {
    flight: {
      domain: "flight",
      hasData: true,
      totalEvents: Object.values(yearlyEvents).reduce((a, b) => a + b, 0),
      countries: ["DE"],
      yearlyEvents,
      yearlyActiveDays,
      monthlyActiveDays: {},
      dailyActiveDays: {},
      weekdayEvents: {},
      summary: {
        headlineKpis: [],
        detailRoute: "/stats?tab=flight",
      },
    },
  };
}

function mockDomainStats(stats: DomainStatsMap): void {
  vi.mocked(useDomainStats).mockReturnValue({
    stats,
    errors: {},
    loading: false,
  } satisfies UseDomainStatsResult);
}

describe("OverviewTab — compare persistence (issue #188)", () => {
  beforeEach(() => {
    localStorage.clear();
    useStatsCompareStore.getState().reset();
    useSettingsStore.setState({ enabledDomains: ["flight"] });
    vi.mocked(useDomainStats).mockReset();
  });

  it("auto-picks comparison ON for a brand-new user with 2+ years of data", () => {
    mockDomainStats(flightStats({ 2023: 4, 2024: 6 }));
    render(<OverviewTab flights={[]} achievements={null} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(useStatsCompareStore.getState().compareYear).toBe(2023);
  });

  it("a user turning the toggle OFF stays off after remounting the tab", () => {
    mockDomainStats(flightStats({ 2023: 4, 2024: 6 }));
    const { unmount } = render(<OverviewTab flights={[]} achievements={null} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // User explicitly turns comparison off via the real UI control.
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    unmount();
    cleanup();

    // Remount — simulates navigating away from /stats and back.
    render(<OverviewTab flights={[]} achievements={null} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("a user-chosen comparison year stays selected after remounting the tab", () => {
    mockDomainStats(flightStats({ 2021: 2, 2022: 3, 2023: 4, 2024: 6 }));
    const { unmount } = render(<OverviewTab flights={[]} achievements={null} />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2021" } });
    expect(select.value).toBe("2021");
    unmount();
    cleanup();

    render(<OverviewTab flights={[]} achievements={null} />);
    const selectAfterRemount = screen.getByRole("combobox") as HTMLSelectElement;
    expect(selectAfterRemount.value).toBe("2021");
  });

  it("falls back gracefully (no crash) when a persisted compare year is no longer available", () => {
    // Simulate: user previously compared against 2023 on a richer
    // dataset; the dataset now only has 2024 (e.g. 2023 trips were
    // deleted, or this is a fresh install sharing the same browser).
    useStatsCompareStore.getState().setCompare(true, 2023);
    mockDomainStats(flightStats({ 2024: 6 }));

    expect(() => render(<OverviewTab flights={[]} achievements={null} />)).not.toThrow();

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    // No other year exists to compare against — comparison must turn
    // itself off rather than rendering a broken/empty comparison.
    expect(checkbox.checked).toBe(false);
    expect(useStatsCompareStore.getState().compareYear).toBeNull();
  });

  it("does not render a comparison on a brand-new install with only one year of data", () => {
    mockDomainStats(flightStats({ 2024: 3 }));
    render(<OverviewTab flights={[]} achievements={null} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    // Only one year exists — the auto-pick default (which would turn
    // comparison on with 2+ years) does not fire, so it stays off and
    // there is nothing to render a broken delta against.
    expect(checkbox.checked).toBe(false);
    expect(useStatsCompareStore.getState().compareYear).toBeNull();
  });
});
