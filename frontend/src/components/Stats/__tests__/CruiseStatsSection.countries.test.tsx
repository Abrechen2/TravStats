import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CruiseStatsResponse } from "../../../lib/api/stats";

/**
 * The port catalogue carries BOTH "United States" and "United States of
 * America", so counting raw names reported one country too many — and
 * disagreed with the cross-domain "countries visited" tile, which folds both
 * onto US. The tile counts the folded set; the tag cloud keeps the names.
 */
const api = vi.hoisted(() => ({ getCruiseStats: vi.fn() }));

vi.mock("../../../lib/api/stats", () => ({ statsApi: api }));

// The section reads the cruise ROWS as well as the rollup now — the calendar,
// the money and the firsts are not in the rollup and never were.
vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import CruiseStatsSection from "../CruiseStatsSection";

const base = {
  cruisesCount: 2,
  cruisePortsUnique: 4,
  cruisePortsSingleMax: 3,
  cruiseShipsUnique: 2,
  cruiseLines: [],
  cruiseLinesUnique: 0,
  cruiseLineLoyaltyMax: 0,
  seaDays: 3,
  seaDaysStreak: 2,
  regions: [],
  regionVisitCounts: {},
  countries: ["Germany", "United States", "United States of America"],
  countriesIso: ["DE", "US"],
  totalDistanceKm: 100,
  longestLegKm: 50,
  totalPortCalls: 4,
  totalCruiseDays: 10,
  hasBalconyCabin: false,
  hasSuiteCabin: false,
  maxDeck: 0,
  hasCanalTransit: false,
  hasPolar: false,
  hasColdWater: false,
  hasDatelineCrossing: false,
  hasBirthdayAtSea: false,
  hasNewYearsAtSea: false,
} as unknown as CruiseStatsResponse;

describe("CruiseStatsSection countries tile", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("counts the folded set, so a catalogue duplicate is not a second country", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(<CruiseStatsSection />);
    // 2 (DE, US) — not 3, which counting the raw names would give.
    const tile = await screen.findByText("stats:cruiseSection.countries");
    expect(tile.parentElement?.textContent).toContain("2");
  });

  it("still lists the full names in the tag cloud", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(<CruiseStatsSection />);
    expect(await screen.findByText("United States of America")).toBeInTheDocument();
  });

  it("falls back to the names when an older backend sends no folded list", async () => {
    api.getCruiseStats.mockResolvedValue({ ...base, countriesIso: undefined });
    render(<CruiseStatsSection />);
    const tile = await screen.findByText("stats:cruiseSection.countries");
    expect(tile.parentElement?.textContent).toContain("3");
  });
});
