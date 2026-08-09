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
      { label: "Distanz", value: "28.400 km" },
      { label: "Seetage", value: 84 },
      { label: "Häfen", value: 47 },
    ],
    topItems: {
      title: "Top-Reedereien",
      items: [
        { label: "AIDA", value: 1 },
        { label: "MSC", value: 1 },
      ],
    },
    badges: [
      { label: "Polar-Region", emoji: "🧊" },
      { label: "Suite", emoji: "👑" },
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
    expect(screen.getByText("28.400 km")).toBeInTheDocument();
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
    expect(screen.getByText("Polar-Region")).toBeInTheDocument();
    expect(screen.getByText("Suite")).toBeInTheDocument();
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
