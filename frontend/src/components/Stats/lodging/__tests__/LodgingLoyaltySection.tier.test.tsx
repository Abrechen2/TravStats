import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { LodgingStats } from "../../../../types/lodging";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";
import LodgingLoyaltySection from "../LodgingLoyaltySection";

const beta = vi.hoisted(() => ({ on: true }));
vi.mock("../../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: beta.on,
    isFeatureVisible: (key: string) => key === "loyaltyCenter" && beta.on,
  }),
}));

/**
 * The status you hold TODAY is not the status you held in 2019.
 *
 * The per-year table printed the card's current tier beside every year, so a
 * row reading "Marriott Bonvoy · Gold · 2019" claimed a status that may not
 * have existed then. The backend type says so itself — "the card's current
 * tier, not the tier held during that year" — and the screen said the opposite
 * (Alex, 2026-08-29).
 *
 * So today's tier is stated ONCE, as a fact about now. A year names a tier
 * only from the card's dated status history (loyalty-status-history-dated,
 * 2.7) — the last block below.
 */
const stats = (): LodgingStats =>
  ({
    ...EMPTY_LODGING_STATS_BLOCKS,
    lodgingsCount: 2,
    staysCount: 6,
    totalNights: 20,
    countries: ["DE"],
    countriesCount: 1,
    loyalty: {
      ...EMPTY_LODGING_STATS_BLOCKS.loyalty,
      chainNights: 20,
      independentNights: 0,
      programmeYears: [
        { programme: "Marriott Bonvoy", tier: "Gold", year: "2019", nights: 8, stays: 3 },
        { programme: "Marriott Bonvoy", tier: "Gold", year: "2024", nights: 12, stays: 3 },
      ],
    },
  }) as unknown as LodgingStats;

describe("LodgingLoyaltySection — the tier is about today, not about 2019", () => {
  it("does not put the tier inside a year row", () => {
    render(<LodgingLoyaltySection stats={stats()} />);

    const row2019 = screen.getByText("2019").closest("tr");
    expect(row2019).not.toBeNull();
    expect(within(row2019 as HTMLElement).queryByText(/Gold/)).toBeNull();
  });

  it("still names the tier, once, as the status held now", () => {
    render(<LodgingLoyaltySection stats={stats()} />);

    // The label matters as much as the value: "Gold" on its own beside a table
    // of years is exactly the claim being removed.
    expect(screen.getByText(/lodging:stats.loyalty.currentTier/)).toBeInTheDocument();
    expect(screen.getAllByText(/Gold/)).toHaveLength(1);
  });

  it("keeps the per-year figures, which really are per year", () => {
    render(<LodgingLoyaltySection stats={stats()} />);

    const row2019 = screen.getByText("2019").closest("tr") as HTMLElement;
    expect(within(row2019).getByText("8")).toBeInTheDocument();
    expect(within(row2019).getByText("3")).toBeInTheDocument();
  });
});

describe("LodgingLoyaltySection — a year's tier from the dated history", () => {
  beforeEach(() => {
    beta.on = true;
  });

  const withHistory = (): LodgingStats => {
    const base = stats();
    return {
      ...base,
      loyalty: {
        ...base.loyalty,
        programmeYears: [
          { ...base.loyalty.programmeYears[0], tiersHeld: [] },
          { ...base.loyalty.programmeYears[1], tiersHeld: ["Silver", "Gold"] },
        ],
      },
    } as LodgingStats;
  };

  it("names the tiers each year held, and a dash for a year the history leaves out", () => {
    render(<LodgingLoyaltySection stats={withHistory()} />);
    expect(screen.getByText("lodging:stats.loyalty.tierHeld")).toBeInTheDocument();
    const row2024 = screen.getByText("2024").closest("tr") as HTMLElement;
    expect(within(row2024).getByText("Silver → Gold")).toBeInTheDocument();
    const row2019 = screen.getByText("2019").closest("tr") as HTMLElement;
    expect(within(row2019).getByText("—")).toBeInTheDocument();
  });

  it("draws no such column when no card has a history", () => {
    render(<LodgingLoyaltySection stats={stats()} />);
    expect(screen.queryByText("lodging:stats.loyalty.tierHeld")).toBeNull();
  });

  // The history is edited on the loyalty page, behind the loyaltyCenter
  // switch since 2026-09-26; the column that reads it goes with it. The
  // per-year nights and stays (2.6) stay.
  it("hides the 'Status damals' column while the loyalty gate is closed", () => {
    beta.on = false;
    render(<LodgingLoyaltySection stats={withHistory()} />);
    expect(screen.queryByText("lodging:stats.loyalty.tierHeld")).toBeNull();
    expect(screen.queryByText("Silver → Gold")).toBeNull();
    const row2024 = screen.getByText("2024").closest("tr") as HTMLElement;
    expect(within(row2024).getByText("12")).toBeInTheDocument();
  });
});
