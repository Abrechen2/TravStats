import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CrossDomainKpis from "../CrossDomainKpis";
import type { YearScopedAgg } from "../../../../lib/stats/domain-stats";

const baseAgg: YearScopedAgg = {
  totalEvents: 42,
  perDomainEvents: { flight: 30, cruise: 12 },
  countriesCount: 18,
  activeDays: 95,
};

// The selected year narrowed to the comparison window. It is deliberately
// SMALLER than `baseAgg`: the tile's big number describes the whole year, the
// delta describes this, and a test where the two coincided would pass whether
// or not the component kept them apart.
const windowedAgg: YearScopedAgg = {
  totalEvents: 33,
  perDomainEvents: { flight: 24, cruise: 9 },
  countriesCount: 16,
  activeDays: 80,
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
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={null}
          prevAgg={null}
          selectedYear={null}
          compareYear={null}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("formats the per-domain breakdown into the experiences hint", () => {
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={null}
          prevAgg={null}
          selectedYear={null}
          compareYear={null}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/30/)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it("does not render delta badges when compareEnabled is false", () => {
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText(/yearFilter\.vs/)).not.toBeInTheDocument();
  });

  it("reads the delta from the windowed pair, never from the headline", () => {
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={true}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    const ggBadges = screen.getAllByText(/yearFilter\.vs/);
    expect(ggBadges.length).toBeGreaterThan(0);
    // 33 - 30 = +3 from the windowed pair. The headline says 42; a delta of
    // +12 would mean the component had subtracted eight months from twelve.
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getAllByText(/\+3/).length).toBeGreaterThan(0);
  });

  // A same-period delta under "ggü. 2023" would be a second, quieter lie than
  // the unequal comparison it replaces: the reader would take eight months for
  // a year. The label travels with the number.
  it("names the same period in the label when the year is still running", () => {
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={true}
          comparisonKind="samePeriod"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getAllByText(/yearFilter\.vsSamePeriod/).length).toBe(2);
    // The exact old key, not a pattern: `/yearFilter\.vs/` also matches
    // `vsSamePeriod`, so it would pass however the label came out.
    expect(screen.queryByText("stats:yearFilter.vs")).not.toBeInTheDocument();
  });

  // The country index is year-keyed and mostly server-sent, so there is no day
  // to cut it on. Withholding the delta is the rule this codebase already has:
  // a value that cannot be derived is absent, never a wrong one.
  // A badge that vanishes without a word reads as a badge that was forgotten.
  it("says in words why the country comparison is missing", () => {
    const { rerender } = render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={true}
          comparisonKind="samePeriod"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("stats:overviewKpis.countriesNoComparison")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={true}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText("stats:overviewKpis.countriesNoComparison")).not.toBeInTheDocument();
  });

  it("withholds the country delta under a same-period window", () => {
    const { rerender } = render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={true}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getAllByText(/yearFilter\.vs/).length).toBe(3);
    rerender(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={windowedAgg}
          prevAgg={prevAgg}
          selectedYear={2024}
          compareYear={2023}
          compareEnabled={true}
          comparisonKind="samePeriod"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getAllByText(/yearFilter\.vs/).length).toBe(2);
  });

  it("renders achievements card with unlocked count when summary present", () => {
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={null}
          prevAgg={null}
          selectedYear={null}
          compareYear={null}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={{
            totalAchievements: 100,
            unlockedAchievements: 73,
            totalPoints: 850,
            categories: {},
          }}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("73")).toBeInTheDocument();
  });

  it("falls back to zero achievements when summary is null", () => {
    render(
      <MemoryRouter>
        <CrossDomainKpis
          agg={baseAgg}
          currentAgg={null}
          prevAgg={null}
          selectedYear={null}
          compareYear={null}
          compareEnabled={false}
          comparisonKind="fullYear"
          achievements={null}
          foldedDomains={["flight", "cruise"]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
