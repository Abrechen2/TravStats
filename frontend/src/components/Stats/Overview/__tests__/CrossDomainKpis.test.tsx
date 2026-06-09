import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CrossDomainKpis from "../CrossDomainKpis";
import type { YearScopedAgg } from "../../../../lib/stats/domain-stats";

const baseAgg: YearScopedAgg = {
  totalEvents: 42,
  perDomainEvents: { flight: 30, cruise: 12 },
  countriesCount: 18,
  activeDays: 95,
};

const prevAgg: YearScopedAgg = {
  totalEvents: 30,
  perDomainEvents: { flight: 22, cruise: 8 },
  countriesCount: 15,
  activeDays: 70,
};

describe("CrossDomainKpis", () => {
  it("renders the four headline numbers from the aggregate", () => {
    render(
      <CrossDomainKpis
        agg={baseAgg}
        prevAgg={null}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
        achievements={null}
      />
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("formats the per-domain breakdown into the experiences hint", () => {
    render(
      <CrossDomainKpis
        agg={baseAgg}
        prevAgg={null}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
        achievements={null}
      />
    );
    expect(screen.getByText(/30/)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it("does not render delta badges when compareEnabled is false", () => {
    render(
      <CrossDomainKpis
        agg={baseAgg}
        prevAgg={prevAgg}
        selectedYear={2024}
        compareYear={2023}
        compareEnabled={false}
        achievements={null}
      />
    );
    expect(screen.queryByText(/ggü/)).not.toBeInTheDocument();
  });

  it("renders delta badges when compare is enabled and year is set", () => {
    render(
      <CrossDomainKpis
        agg={baseAgg}
        prevAgg={prevAgg}
        selectedYear={2024}
        compareYear={2023}
        compareEnabled={true}
        achievements={null}
      />
    );
    const ggBadges = screen.getAllByText(/ggü/);
    expect(ggBadges.length).toBeGreaterThan(0);
  });

  it("renders achievements card with unlocked count when summary present", () => {
    render(
      <CrossDomainKpis
        agg={baseAgg}
        prevAgg={null}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
        achievements={{
          totalAchievements: 100,
          unlockedAchievements: 73,
          totalPoints: 850,
          categories: {},
        }}
      />
    );
    expect(screen.getByText("73")).toBeInTheDocument();
  });

  it("falls back to zero achievements when summary is null", () => {
    render(
      <CrossDomainKpis
        agg={baseAgg}
        prevAgg={null}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
        achievements={null}
      />
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
