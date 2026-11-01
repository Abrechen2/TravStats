import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import type { CrossDomainStats } from "../../../../types/crossDomainStats";

const { getCrossDomainStats } = vi.hoisted(() => ({ getCrossDomainStats: vi.fn() }));
vi.mock("../../../../lib/api/stats", () => ({ statsApi: { getCrossDomainStats } }));

import CrossDomainSection from "../CrossDomainSection";

const empty: CrossDomainStats = {
  asOf: "2026-11-01",
  streaks: null,
  rhythm: null,
  timeShift: null,
  unseen: null,
  pricePerKm: null,
  nightsByCountry: null,
  schengen: null,
  photos: null,
  unavailable: [],
};

/**
 * forgejo#399 — a block the server could not derive draws no card (never a
 * zero), a block that failed to load is named, and a failed request says so.
 */
describe("CrossDomainSection", () => {
  it("draws nothing when every block abstains, instead of a wall of zeros", async () => {
    getCrossDomainStats.mockResolvedValueOnce(empty);
    const { container } = render(<CrossDomainSection />);
    await waitFor(() => expect(getCrossDomainStats).toHaveBeenCalled());
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  it("names a block whose load failed rather than hiding it as empty", async () => {
    getCrossDomainStats.mockResolvedValueOnce({ ...empty, unavailable: ["schengen"] });
    render(<CrossDomainSection />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/schengen\.value/)).toBeNull();
  });

  it("says so when the request itself fails", async () => {
    getCrossDomainStats.mockRejectedValueOnce(new Error("boom"));
    render(<CrossDomainSection />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows the Schengen counter and the price per km only in their own currency", async () => {
    getCrossDomainStats.mockResolvedValueOnce({
      ...empty,
      schengen: {
        asOf: "2026-11-01",
        windowDays: 180,
        allowedDays: 90,
        daysUsed: 6,
        daysRemaining: 84,
        windowFrom: "2026-05-06",
        lastDayUsed: "2026-10-25",
      },
      pricePerKm: {
        bookedRides: 2,
        blocks: [
          {
            domain: "rail",
            currency: "EUR",
            rides: 1,
            spend: 100,
            spendWithKm: 100,
            km: 500,
            pricePerKm: 0.2,
            ridesWithoutKm: 0,
          },
          {
            domain: "bus",
            currency: "CHF",
            rides: 1,
            spend: 30,
            spendWithKm: 0,
            km: null,
            pricePerKm: null,
            ridesWithoutKm: 1,
          },
        ],
      },
    });
    render(<CrossDomainSection />);
    expect(await screen.findByText(/schengen\.value/)).toBeTruthy();
    const card = screen.getByTestId("cross-domain-price-per-km");
    // One line per (domain, currency); the bus ride has a price and no distance,
    // so it gets the no-distance line and no rate is invented for it.
    const lines = [...card.querySelectorAll("p")].map((p) => p.textContent);
    expect(lines.filter((l) => l?.includes("pricePerKm.row"))).toHaveLength(1);
    expect(lines.filter((l) => l?.includes("pricePerKm.noKm"))).toHaveLength(1);
  });
});
