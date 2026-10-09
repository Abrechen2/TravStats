import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const stats = vi.fn();
vi.mock("../../../../lib/api/rentalLinks", () => ({
  rentalLinksApi: { stats: (...a: unknown[]) => stats(...a) },
}));

import RentalStatsSection from "../RentalStatsSection";

const EMPTY = {
  rentals: 0,
  days: 0,
  oneWay: 0,
  byYear: [],
  providers: [],
  brokers: [],
  countries: [],
  costPerDay: [],
  km: { total: null, covered: 0, of: 0 },
  cancellationFees: [],
};

/**
 * forgejo#167 — with no costed rental the cost tile read "– / pro Tag ()":
 * the label interpolated the first currency, and there was none.
 */
describe("RentalStatsSection cost tile, in German (forgejo#167)", () => {
  beforeEach(() => stats.mockReset());

  it("labels an empty cost tile without empty brackets", async () => {
    stats.mockResolvedValueOnce(EMPTY);
    render(
      <MemoryRouter>
        <RentalStatsSection scope={{ year: null, compareYear: null }} />
      </MemoryRouter>
    );
    const cost = await screen.findByTestId("rental-stat-cost");
    expect(cost.textContent).toContain("–");
    expect(cost.textContent).not.toContain("()");
    expect(cost.textContent).toContain("Kosten pro Tag");
  });

  it("still names the currency when there is one", async () => {
    stats.mockResolvedValueOnce({
      ...EMPTY,
      rentals: 1,
      days: 3,
      costPerDay: [{ currency: "EUR", perDay: 50, rentals: 1, days: 3 }],
    });
    render(
      <MemoryRouter>
        <RentalStatsSection scope={{ year: null, compareYear: null }} />
      </MemoryRouter>
    );
    const cost = await screen.findByTestId("rental-stat-cost");
    expect(cost.textContent).toContain("pro Tag (EUR)");
  });
});
