import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CrossDomainKpis from "../CrossDomainKpis";
import type { YearScopedAgg } from "../../../../lib/stats/domain-stats";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

function renderKpis(agg: YearScopedAgg): void {
  render(
    <MemoryRouter>
      <CrossDomainKpis
        agg={agg}
        currentAgg={null}
        prevAgg={null}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
        comparisonKind="fullYear"
        achievements={null}
        foldedDomains={["flight", "lodging", "cruise"]}
      />
    </MemoryRouter>
  );
}

/**
 * forgejo#160 — three experiences, one per domain, and the tile read
 * "1 Flüge · 1 Unterkünfte · 1 Kreuzfahrten": the breakdown glued the count
 * to the domain NAME, which is a plural noun.
 */
describe("CrossDomainKpis experiences breakdown, in German", () => {
  it("names one of each in the singular", () => {
    renderKpis({
      totalEvents: 3,
      perDomainEvents: { flight: 1, lodging: 1, cruise: 1 },
      countriesCount: 2,
      activeDays: 6,
    });
    expect(screen.getByText("1 Flug · 1 Unterkunft · 1 Kreuzfahrt")).toBeInTheDocument();
  });

  it("keeps the plural for more than one", () => {
    renderKpis({
      totalEvents: 7,
      perDomainEvents: { flight: 4, cruise: 3 },
      countriesCount: 2,
      activeDays: 6,
    });
    expect(screen.getByText("4 Flüge · 3 Kreuzfahrten")).toBeInTheDocument();
  });
});
