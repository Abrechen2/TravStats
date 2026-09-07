import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DomainSummaryCard from "../DomainSummaryCard";
import type { DomainStats } from "../../../../lib/stats/domain-stats";

const cruiseStats: DomainStats = {
  domain: "cruise",
  hasData: true,
  totalEvents: 12,
  totalDistanceKm: 28_400,
  countries: ["IT", "ES", "FR"],
  yearlyEvents: { 2023: 4, 2024: 8 },
  yearlyActiveDays: { 2023: 28, 2024: 56 },
  monthlyActiveDays: {},
  dailyActiveDays: {},
  weekdayEvents: {},
  summary: {
    headlineKpis: [
      { labelKey: "overviewCard.kpi.distance", value: 28_400, unit: "km" as const },
      { labelKey: "overviewCard.kpi.seaDays", value: 84 },
      { labelKey: "overviewCard.kpi.ports", value: 47 },
    ],
    topItems: {
      titleKey: "overviewCard.topItems.cruiseLines",
      items: [
        { label: "AIDA", value: 1 },
        { label: "MSC", value: 1 },
      ],
    },
    badges: [
      { labelKey: "overviewCard.badge.polar", emoji: "🧊" },
      { labelKey: "overviewCard.badge.suiteCabin", emoji: "👑" },
    ],
    detailRoute: "/stats?tab=cruise",
  },
};

describe("DomainSummaryCard", () => {
  it("renders placeholder when stats hasData=false", () => {
    render(
      <DomainSummaryCard
        domain="lodging"
        stats={{ domain: "lodging", hasData: false }}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByText(/comingSoon|noDataYet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Details/)).not.toBeInTheDocument();
  });

  it("renders placeholder when stats is undefined (failed adapter)", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={undefined}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByText(/comingSoon|noDataYet/i)).toBeInTheDocument();
  });

  it("renders headline KPIs and Details link when hasData=true", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    // The suite's language is English (src/__tests__/setup.ts), so the
    // thousands separator must be a comma. The adapters used to format with a
    // hardcoded de-DE, which put "28.400" on an English page (#319). The unit
    // renders as its key here because the fake `t` returns keys.
    expect(screen.getByText("28,400 stats:overviewCard.unit.km")).toBeInTheDocument();
    expect(screen.getByText("84")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    const detailsLink = screen.getByRole("link");
    expect(detailsLink).toHaveAttribute("href", "/stats?tab=cruise");
  });

  it("renders top-items chips", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByText("AIDA")).toBeInTheDocument();
    expect(screen.getByText("MSC")).toBeInTheDocument();
  });

  it("renders badges with their emojis", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    // The fake `t` returns the key, so seeing the KEY is the proof the badge
    // goes through translation at all — a literal "Polar-Region" here would be
    // the #319 bug, an English page reading German.
    expect(screen.getByText("stats:overviewCard.badge.polar")).toBeInTheDocument();
    expect(screen.getByText("stats:overviewCard.badge.suiteCabin")).toBeInTheDocument();
  });

  it("uses year-scoped count i18n key when a year is selected", () => {
    // The global t() mock echoes the i18n key without interpolation, so
    // we assert by which key the component reaches for: the year-scoped
    // path vs the lifetime path.
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={2024}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByText("stats:overviewCard.yearScopedCount")).toBeInTheDocument();
    expect(screen.queryByText("stats:overviewCard.lifetimeCount")).not.toBeInTheDocument();
  });

  it("uses lifetime count i18n key when no year is selected", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByText("stats:overviewCard.lifetimeCount")).toBeInTheDocument();
    expect(screen.queryByText("stats:overviewCard.yearScopedCount")).not.toBeInTheDocument();
  });

  it("renders delta badge when compareEnabled and selectedYear are set", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={2024}
        compareYear={2023}
        compareEnabled={true}
      />
    );
    expect(screen.getByText(/yearFilter\.vs/)).toBeInTheDocument();
  });
});
