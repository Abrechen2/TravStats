import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { LodgingStats } from "../../../../types/lodging";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";
import LodgingLoyaltySection from "../LodgingLoyaltySection";

/**
 * The status you hold TODAY is not the status you held in 2019.
 *
 * The per-year table printed the card's current tier beside every year, so a
 * row reading "Marriott Bonvoy · Gold · 2019" claimed a status that may not
 * have existed then. The backend type says so itself — "the card's current
 * tier, not the tier held during that year" — and the screen said the opposite
 * (Alex, 2026-08-29).
 *
 * There is no dated status history to draw on, and inventing one would be a
 * feature rather than a correction. So the tier is stated ONCE, as a fact about
 * now, and the year rows carry only what is genuinely per-year: nights and
 * stays.
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
