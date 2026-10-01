import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const stats = vi.fn();
vi.mock("../../../../lib/api/rentalLinks", () => ({
  rentalLinksApi: { stats: (...a: unknown[]) => stats(...a) },
}));

import RentalStatsSection from "../RentalStatsSection";

const STATS = {
  rentals: 2,
  days: 7,
  oneWay: 1,
  byYear: [{ year: 2025, rentals: 2, days: 7 }],
  providers: [{ provider: "Testcar", rentals: 2, days: 7 }],
  brokers: [],
  countries: ["DE"],
  costPerDay: [],
  km: { total: null, covered: 0, of: 2 },
};

describe("RentalStatsSection", () => {
  beforeEach(() => stats.mockReset());

  it("says the load failed instead of drawing zeros", async () => {
    stats.mockRejectedValueOnce(new Error("down"));
    render(<RentalStatsSection year={null} />);
    expect(await screen.findByText("rental:stats.loadError")).toBeTruthy();
  });

  it("shows unknown km and an unknown cost as a dash, with how many rentals the km cover", async () => {
    stats.mockResolvedValueOnce(STATS);
    render(<RentalStatsSection year={null} />);
    const km = await screen.findByTestId("rental-stat-km");
    expect(km.textContent).toContain("–");
    expect(km.textContent).toContain('"covered":0');
    expect(screen.getByTestId("rental-stat-cost").textContent).toContain("–");
    expect(screen.getByTestId("rental-stat-days").textContent).toContain("7");
  });
});
