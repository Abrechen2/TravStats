import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CruiseStatsResponse } from "../../../lib/api/stats";

const api = vi.hoisted(() => ({ getCruiseStats: vi.fn() }));

vi.mock("../../../lib/api/stats", () => ({ statsApi: api }));
// The insights block (forgejo#257) makes its own request and has its own suite
// (`insights/__tests__/CruiseInsightsSection.test.tsx`); this one is about the
// blocks above it, so it is left out rather than given a second fixture.
vi.mock("../insights/CruiseInsightsSection", () => ({ default: () => null }));

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
import { ALL_VISIBLE } from "./sectionVisibilityStub";

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

/**
 * "Seetage zählen" (forgejo#321): when the account leaves sea days out of the
 * day total, the tile says so in its label, and the sea-day share — a share of
 * a total that holds no sea days — is not drawn.
 */
describe("CruiseStatsSection — sea days counted or not", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
  });

  const renderTab = () =>
    render(
      <MemoryRouter>
        <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
      </MemoryRouter>
    );

  it("counted (and an older server that does not say): the plain label and the share", async () => {
    api.getCruiseStats.mockResolvedValue(base);
    renderTab();
    expect((await screen.findAllByText("stats:cruiseSection.totalDays")).length).toBeGreaterThan(0);
    expect(screen.queryByText("stats:cruiseSection.totalDaysNoSea")).toBeNull();
    expect(screen.getAllByText("stats:cruiseSection.seaDayShare").length).toBeGreaterThan(0);
  });

  it("not counted: the label names it, and the share is left out", async () => {
    api.getCruiseStats.mockResolvedValue({ ...base, seaDaysCounted: false, totalCruiseDays: 7 });
    renderTab();
    expect(
      (await screen.findAllByText("stats:cruiseSection.totalDaysNoSea")).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("stats:cruiseSection.totalDays")).toBeNull();
    expect(screen.queryByText("stats:cruiseSection.seaDayShare")).toBeNull();
    // The sea days themselves stay: the setting is about the total.
    expect(screen.getAllByText("stats:cruiseSection.seaDays").length).toBeGreaterThan(0);
  });
});
