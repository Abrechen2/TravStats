import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import DomainSummaryCard from "../DomainSummaryCard";
import type { DomainStats } from "../../../../lib/stats/domain-stats";

// The card's "Details" is a router link now (B04), so it needs a router.
const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: MemoryRouter });

const cruiseStats: DomainStats = {
  domain: "cruise",
  hasData: true,
  summaryByYear: {
    2023: {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.cruiseNights", value: 21 },
        { labelKey: "overviewCard.kpi.seaDays", value: 9 },
        { labelKey: "overviewCard.kpi.ports", value: 11 },
      ],
      topItems: {
        titleKey: "overviewCard.topItems.cruiseLines",
        items: [{ label: "TUI", value: 4 }],
      },
    },
  },
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
    // No year chosen is "all years", said out loud so the tab it opens agrees.
    expect(detailsLink).toHaveAttribute("href", "/stats?tab=cruise&year=all");
  });

  // CT106 audit, B04: year 2005 → "Details" opened the tab on 2026.
  it("carries the selected year into the tab it opens", () => {
    render(
      <DomainSummaryCard
        domain="cruise"
        stats={cruiseStats}
        selectedYear={2005}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/stats?tab=cruise&year=2005");
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

  // CT106 audit B03: "Scope: 2005 · 1 flight" over the lifetime distance.
  describe("under a selected year", () => {
    const renderYear = (year: number): void => {
      render(
        <DomainSummaryCard
          domain="cruise"
          stats={cruiseStats}
          selectedYear={year}
          compareYear={null}
          compareEnabled={false}
        />
      );
    };

    it("shows that year's figures and top items, not the lifetime ones", () => {
      renderYear(2023);
      expect(screen.getByText("21")).toBeInTheDocument();
      expect(screen.getByText("9")).toBeInTheDocument();
      expect(screen.getByText("TUI")).toBeInTheDocument();
      expect(screen.queryByText("28,400 stats:overviewCard.unit.km")).toBeNull();
      expect(screen.queryByText("AIDA")).toBeNull();
    });

    it("says there is nothing in a year without events instead of printing zeros", () => {
      renderYear(2024);
      expect(screen.getByText("stats:overviewCard.noEventsInYear")).toBeInTheDocument();
      expect(screen.queryByText("84")).toBeNull();
    });

    it("labels all-years badges as all-years", () => {
      renderYear(2023);
      expect(screen.getByText(/stats:overviewCard\.allYearsOnly/)).toBeInTheDocument();
    });
  });

  // CT106 audit B11: the places card printed "viewpoint".
  it("translates top items that are codes, not names", () => {
    const poiStats: DomainStats = {
      ...cruiseStats,
      domain: "poi",
      summary: {
        headlineKpis: [],
        topItems: {
          titleKey: "overviewCard.topItems.categories",
          items: [{ label: "viewpoint", value: 2 }],
          labelKeyPrefix: "places:categories",
        },
        detailRoute: "/stats?tab=poi",
      },
    } as DomainStats;
    render(
      <DomainSummaryCard
        domain="poi"
        stats={poiStats}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );
    expect(screen.getByText("places:categories.viewpoint")).toBeInTheDocument();
  });
});
