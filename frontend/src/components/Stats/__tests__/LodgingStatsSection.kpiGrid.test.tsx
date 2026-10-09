import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LodgingStats } from "../../../types/lodging";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../types/lodgingStatsFixture";
import { STAT_CARD_CLASS } from "../StatCard";

const stats: LodgingStats = {
  lodgingsCount: 4,
  staysCount: 4,
  totalNights: 2,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 1,
  chainsUnique: 1,
  citiesUnique: 2,
  countries: ["DE"],
  countriesCount: 1,
  countriesByYear: {},
  spendBaseTotal: 0,
  spendByCurrency: {},
  spendUnconvertedStays: 0,
  spendBaseByCurrency: {},
  awardNights: 0,
  nightsByType: { hotel: 2 },
  avgRatingOverall: null,
  chainLoyaltyMax: 1,
  sameHotelRepeatMax: 1,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

// The insights block (forgejo#258) loads on its own endpoint and has its own
// suite; here it stays pending so this test reaches no network.
vi.mock("../../../lib/api/statsInsights", () => ({
  statsInsightsApi: { lodging: () => new Promise(() => {}) },
}));
vi.mock("../../../lib/api/lodging", () => ({
  getLodgingStats: vi.fn(async () => stats),
}));
// The blocks below the KPIs have tests of their own; only the KPIs are read here.
vi.mock("../lodging/LodgingMoneySection", () => ({ default: () => null }));
vi.mock("../lodging/LodgingQualitySection", () => ({ default: () => null }));
vi.mock("../lodging/LodgingGeoSection", () => ({ default: () => null }));
vi.mock("../lodging/LodgingRhythmSection", () => ({ default: () => null }));
vi.mock("../lodging/LodgingLoyaltySection", () => ({ default: () => null }));
vi.mock("../lodging/LodgingRecordsSection", () => ({ default: () => null }));

import LodgingStatsSection from "../LodgingStatsSection";
import { ALL_VISIBLE } from "./sectionVisibilityStub";

/**
 * Tester 2026-09-26 (beta.16, statistics → Unterkünfte, 2026 chosen): the six
 * KPIs stood in ONE column down the page, while every other domain tab draws
 * its KPIs as a grid of cards. The cells were evidence buttons carrying
 * `width: 100%` inside a wrapping flex row, so each one took a whole line.
 */
describe("LodgingStatsSection KPI block", () => {
  it.each([
    ["a chosen year", { year: 2026, compareYear: null }],
    ["the lifetime view", { year: null, compareYear: null }],
  ])("draws the KPIs as a grid of cards under %s, like the other tabs", async (_, scope) => {
    render(
      <MemoryRouter>
        <LodgingStatsSection scope={scope} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );
    const block = await screen.findByTestId("lodging-stat-strip");
    // A responsive grid, not a wrapping row of full-width buttons.
    expect(block.className).toMatch(/\bgrid\b/);
    expect(block.className).toMatch(/\blg:grid-cols-3\b/);
    // Each KPI is a card of the same shell the other tabs use.
    const cards = [...block.children];
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      for (const cls of STAT_CARD_CLASS.split(" ")) expect(card).toHaveClass(cls);
    }
    expect(within(block).getByText("dashboard:lodgingTab.stats.noRating")).toBeInTheDocument();
  });
});
