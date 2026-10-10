import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";
import { evidenceOpenedBy } from "../../__tests__/evidenceKeysOpened";

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
  cancellationFees: [],
};

describe("RentalStatsSection", () => {
  beforeEach(() => stats.mockReset());

  it("says the load failed instead of drawing zeros", async () => {
    stats.mockRejectedValueOnce(new Error("down"));
    render(
      <MemoryRouter>
        <RentalStatsSection scope={{ year: null, compareYear: null }} />
      </MemoryRouter>
    );
    expect(await screen.findByText("rental:stats.loadError")).toBeTruthy();
  });

  it("shows unknown km and an unknown cost as a dash, with how many rentals the km cover", async () => {
    stats.mockResolvedValueOnce(STATS);
    render(
      <MemoryRouter>
        <RentalStatsSection scope={{ year: null, compareYear: null }} />
      </MemoryRouter>
    );
    const km = await screen.findByTestId("rental-stat-km");
    expect(km.textContent).toContain("–");
    expect(km.textContent).toContain('"covered":0');
    expect(screen.getByTestId("rental-stat-cost").textContent).toContain("–");
    expect(screen.getByTestId("rental-stat-days").textContent).toContain("7");
    expect(screen.queryByTestId("rental-stats-fees")).toBeNull();
  });

  it("shows cancellation fees apart from the cost per day", async () => {
    stats.mockResolvedValueOnce({
      ...STATS,
      cancellationFees: [{ currency: "EUR", amount: 45.5, rentals: 1 }],
    });
    render(
      <MemoryRouter>
        <RentalStatsSection scope={{ year: null, compareYear: null }} />
      </MemoryRouter>
    );
    const fees = await screen.findByTestId("rental-stats-fees");
    expect(fees.textContent).toContain("rental:stats.cancellationFees");
    expect(fees.textContent).toContain('"count":1');
    expect(screen.getByTestId("rental-stat-cost").textContent).toContain("–");
  });

  // forgejo#262 / #265: a year set against another is compared over the same
  // span when it is still running, as the rail tab does (acceptance D11).
  it("compares a running year with the same span of the other", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 26, 12)));
    try {
      stats.mockResolvedValue(STATS);
      render(
        <MemoryRouter>
          <RentalStatsSection scope={{ year: 2026, compareYear: 2025 }} />
        </MemoryRouter>
      );
      await screen.findByTestId("rental-stat-days");
      expect(stats).toHaveBeenCalledWith(2026, "09-26");
      expect(stats).toHaveBeenCalledWith(2025, "09-26");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says which data would fill an empty tab instead of drawing zeros", async () => {
    stats.mockResolvedValueOnce({ ...STATS, rentals: 0, days: 0, providers: [] });
    render(
      <MemoryRouter>
        <RentalStatsSection scope={{ year: null, compareYear: null }} />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("rental-stats-empty")).toHaveTextContent("rental:stats.empty");
  });

  // forgejo#262 — the km and cost-per-day tiles opened nothing.
  it("opens the rentals behind days, km and cost per day", async () => {
    stats.mockResolvedValue(STATS);
    const { opened } = await evidenceOpenedBy(
      <RentalStatsSection scope={{ year: null, compareYear: null }} />,
      () => screen.findByTestId("rental-stat-km")
    );
    const keys = opened.map((o) => o.key);
    expect(keys).toEqual(
      expect.arrayContaining(["rentalDaysTotal", "rentalKmTotal", "rentalCostedCount"])
    );
    expect(keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1)).toEqual([]);
  });
});
