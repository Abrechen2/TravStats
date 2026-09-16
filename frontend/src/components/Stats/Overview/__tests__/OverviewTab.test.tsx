import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DomainStatsMap } from "../../../../lib/stats/domain-stats";
import type { StatsPeriod } from "../../useStatsPeriod";
import type { SectionVisibility } from "../../../../hooks/useSectionVisibility";

// Use the real settingsStore (not the global selector-only mock from
// setup.ts) so useEnabledDomains() returns real state we control below.
vi.unmock("../../../../store/settingsStore");

import OverviewTab from "../OverviewTab";
import { useSettingsStore } from "../../../../store/settingsStore";
import { hiding } from "../../__tests__/sectionVisibilityStub";

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

// The period belongs to the page now; its behaviour is pinned in
// `Stats/__tests__/StatsPeriod.test.tsx`. Here it is only an input.
const period: StatsPeriod = {
  selectedYear: 2024,
  compareYear: null,
  compareEnabled: false,
  setSelectedYear: () => {},
  setCompareYear: () => {},
  setCompareEnabled: () => {},
  scope: { year: 2024, compareYear: null },
};

function renderOverview(visibility: SectionVisibility = hiding()): void {
  render(
    <OverviewTab
      stats={flightStats({ 2024: 6 })}
      loading={false}
      period={period}
      visibility={visibility}
      achievements={null}
    />
  );
}

// 2026-09-05, promote check with the beta flag off: the tab strip had learned
// to hide POI, the overview's chips and cards had not. Later the same day the
// domain left the switch altogether; what remains of the rule is the user's
// own domain choice, asked through the same `usePlacesAccess`.
describe("OverviewTab — the POI domain follows the user's domain choice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("draws no POI chip or card when the user has the domain off", () => {
    useSettingsStore.setState({ enabledDomains: ["flight"], betaFeaturesEnabled: true });
    renderOverview();
    expect(screen.queryAllByText("common:domain.poi")).toHaveLength(0);
    expect(screen.queryAllByText("common:domain.flight").length).toBeGreaterThan(0);
  });

  it.each([
    ["off", false],
    ["on", true],
  ])("draws them with the domain on, whatever the beta flag (%s) says", (_label, flag) => {
    useSettingsStore.setState({ enabledDomains: ["flight", "poi"], betaFeaturesEnabled: flag });
    renderOverview();
    expect(screen.queryAllByText("common:domain.poi").length).toBeGreaterThan(0);
  });
});

describe("OverviewTab hides the blocks the reader switched off", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ enabledDomains: ["flight"] });
  });

  it("drops the key figures and keeps the per-domain cards", () => {
    renderOverview(hiding("kpis"));
    expect(screen.queryByText("stats:overview.kpisLabel")).not.toBeInTheDocument();
    expect(screen.getByText("stats:overview.perDomainLabel")).toBeInTheDocument();
  });
});
