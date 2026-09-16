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

// ONE translation object, as the real hook hands out. The section's fetch
// effect depends on `t`, so a fresh function per render re-fetched on every
// state change — invisible until a test counted the requests.
const translation = vi.hoisted(() => ({ t: (k: string) => k, i18n: { language: "de" } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => translation,
}));

import CruiseStatsSection from "../CruiseStatsSection";
import { ALL_VISIBLE, hiding } from "./sectionVisibilityStub";

const LIFETIME = { year: null, compareYear: null };

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
    render(<CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />);
    // 2 (DE, US) — not 3, which counting the raw names would give.
    const tile = await screen.findByText("stats:cruiseSection.countries");
    expect(tile.parentElement?.textContent).toContain("2");
  });

  it("still lists the full names in the tag cloud", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(<CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />);
    expect(await screen.findByText("United States of America")).toBeInTheDocument();
  });

  it("falls back to the names when an older backend sends no folded list", async () => {
    api.getCruiseStats.mockResolvedValue({ ...base, countriesIso: undefined });
    render(<CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />);
    const tile = await screen.findByText("stats:cruiseSection.countries");
    expect(tile.parentElement?.textContent).toContain("3");
  });
});

// Owner review 2026-09-15: the overview said "no cruises in 2026" while this
// tab showed every cruise ever sailed. The tab now answers for the page's year.
describe("CruiseStatsSection under the page's period", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("asks the server for the chosen year, and for nothing else", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(
      <CruiseStatsSection scope={{ year: 2024, compareYear: null }} visibility={ALL_VISIBLE} />
    );
    await screen.findByText("stats:cruiseSection.countries");
    expect(api.getCruiseStats).toHaveBeenCalledTimes(1);
    expect(api.getCruiseStats).toHaveBeenCalledWith({ year: 2024 });
  });

  it("asks for the lifetime view when no year is chosen", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(<CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />);
    await screen.findByText("stats:cruiseSection.countries");
    expect(api.getCruiseStats).toHaveBeenCalledWith(undefined);
  });

  it("sets the year against the compare year with a second request", async () => {
    api.getCruiseStats.mockImplementation(async (params?: { year?: number }) =>
      params?.year === 2023 ? { ...base, cruisesCount: 1 } : base
    );
    render(
      <CruiseStatsSection scope={{ year: 2024, compareYear: 2023 }} visibility={ALL_VISIBLE} />
    );
    expect(await screen.findByText("stats:yearFilter.vs")).toBeInTheDocument();
    expect(api.getCruiseStats).toHaveBeenCalledWith({ year: 2023 });
  });

  it("names the year when it had no cruise, instead of inviting a first one", async () => {
    api.getCruiseStats.mockResolvedValue({ ...base, cruisesCount: 0 });
    render(
      <CruiseStatsSection scope={{ year: 2019, compareYear: null }} visibility={ALL_VISIBLE} />
    );
    expect(await screen.findByText("stats:period.emptyYear")).toBeInTheDocument();
    expect(screen.queryByText("stats:cruiseSection.emptyTitle")).not.toBeInTheDocument();
  });
});

// The section menu reached every tab on 2026-09-16. Before, a cruise tab's cost
// block could not be hidden at all.
describe("CruiseStatsSection hides the blocks the reader switched off", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  it("drops a hidden block and keeps the rest", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    render(<CruiseStatsSection scope={LIFETIME} visibility={hiding("regions", "tags")} />);
    // The depth grid still draws, so the section did render.
    expect(await screen.findByText("stats:cruiseSection.countries")).toBeInTheDocument();
    expect(screen.queryByText("stats:cruiseSection.regionsHeading")).not.toBeInTheDocument();
    expect(screen.queryByText("United States of America")).not.toBeInTheDocument();
  });
});
