import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { LodgingInsights } from "../../../../types/statsInsights";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#5ec2b2" }),
}));
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const lodging = vi.fn();
vi.mock("../../../../lib/api/statsInsights", () => ({
  statsInsightsApi: { lodging: (...a: unknown[]) => lodging(...a) },
}));

import LodgingInsightsSection from "../LodgingInsightsSection";

const EMPTY: LodgingInsights = {
  sleepStyle: { byYear: [], unplacedNights: 0, unknownLengthStays: 0 },
  revisits: { houses: [], longestGap: null, sameHouseYearsMax: 0, returnedHouses: 0 },
  tripBases: { trips: [], staysWithoutTrip: 0, undatedTripStays: 0, typesPerCompletedTripMax: 0 },
  priceTrends: {
    groups: [],
    singlePricedStays: 0,
    unpricedStays: 0,
    awardStays: 0,
    undatedPricedStays: 0,
  },
  weekRhythm: {
    byYear: [],
    weekendNights: 0,
    weekdayNights: 0,
    businessNights: 0,
    unlabelledNights: 0,
    notWalkableNights: 0,
  },
  calendar: { byYear: [], fullYears: [], monthsInYearMax: 0 },
  plannedStays: 0,
  totals: {},
};

const FULL: LodgingInsights = {
  ...EMPTY,
  sleepStyle: {
    byYear: [
      { year: 2024, nightsByType: { hotel: 6, campsite: 2 }, nights: 8 },
      { year: 2025, nightsByType: { apartment: 4 }, nights: 4 },
    ],
    unplacedNights: 1,
    unknownLengthStays: 3,
  },
  revisits: {
    houses: [{ lodgingId: "h1", name: "Gasthof Linde", years: [2021, 2024], stays: 2 }],
    longestGap: {
      lodgingId: "h1",
      name: "Gasthof Linde",
      days: 1000,
      fromStayId: "a",
      toStayId: "b",
      from: "2021-05-02",
      to: "2024-01-27",
    },
    sameHouseYearsMax: 2,
    returnedHouses: 1,
  },
  priceTrends: {
    groups: [
      {
        lodgingId: "h1",
        name: "Gasthof Linde",
        roomCategory: "Doppel",
        board: "breakfast",
        currency: "CHF",
        stays: 2,
        first: { stayId: "a", date: "2021-05-01", perNight: 100 },
        last: { stayId: "b", date: "2024-01-27", perNight: 110 },
        changePct: 10,
        thin: true,
      },
    ],
    singlePricedStays: 0,
    unpricedStays: 2,
    awardStays: 1,
    undatedPricedStays: 0,
  },
  weekRhythm: {
    ...EMPTY.weekRhythm,
    byYear: [
      {
        year: 2024,
        weekendNights: 2,
        weekdayNights: 6,
        businessNights: 0,
        nightsBySeason: { summer: 8 },
      },
      {
        year: 2025,
        weekendNights: 1,
        weekdayNights: 3,
        businessNights: 3,
        nightsBySeason: { winter: 4 },
      },
    ],
    notWalkableNights: 5,
  },
  calendar: { byYear: [{ year: 2024, months: [3, 7] }], fullYears: [], monthsInYearMax: 2 },
  totals: {
    lodgingWeekendNights: { allTime: 3, byYear: { "2024": 2, "2025": 1 } },
    lodgingWeekdayNights: { allTime: 9, byYear: { "2024": 6, "2025": 3 } },
    lodgingBusinessNights: { allTime: 3, byYear: { "2025": 3 } },
    lodgingReturnHouseCount: { allTime: 1, byYear: {} },
  },
};

function Url(): JSX.Element {
  return <span data-testid="url">{useLocation().search}</span>;
}

function renderAt(year: number | null): void {
  render(
    <MemoryRouter>
      <LodgingInsightsSection year={year} />
      <Url />
    </MemoryRouter>
  );
}

describe("LodgingInsightsSection (forgejo#258)", () => {
  beforeEach(() => lodging.mockReset());

  it("shows the period's slice: weekend against weekday nights of the chosen year", async () => {
    lodging.mockResolvedValueOnce(FULL);
    renderAt(2025);
    const week = await screen.findByTestId("insight-week");
    expect(week.textContent).toContain("1 / 3");
    // The business tile reads the year, not the lifetime total.
    expect(screen.getByTestId("insight-business").textContent).toContain("3");
  });

  it("explains every figure on request: unit, time rule, source, coverage, exclusions", async () => {
    lodging.mockResolvedValueOnce(FULL);
    renderAt(null);
    const help = await screen.findByTestId("insight-sleep-style-help");
    const text = help.textContent ?? "";
    for (const label of ["Zähleinheit", "Zeitregel", "Quelle", "Abdeckung", "Nicht enthalten"]) {
      expect(text).toContain(label);
    }
    // Coverage names the stays that are in no share, with the real numbers.
    expect(text).toContain("3 Aufenthalte ohne bekannte Nächtezahl");
    expect(text).toContain("1 Nächte ohne Jahr");
    // A native disclosure: reachable by keyboard and by tap without hover.
    expect(help.tagName).toBe("DETAILS");
  });

  it("opens the evidence panel for the weekend nights, a served measure", async () => {
    lodging.mockResolvedValueOnce(FULL);
    renderAt(null);
    const week = await screen.findByTestId("insight-week");
    fireEvent.click(within(week).getByRole("button", { name: "Wochenendnächte" }));
    expect(screen.getByTestId("url").textContent).toContain(
      "evidence=metric%3AlodgingWeekendNights"
    );
    expect(EVIDENCE_MEASURES.lodgingWeekendNights?.servedIn).toBe(1);
  });

  it("keeps a price comparison in its own currency and marks a thin sample", async () => {
    lodging.mockResolvedValueOnce(FULL);
    renderAt(null);
    const prices = await screen.findByTestId("insight-prices");
    const text = prices.textContent ?? "";
    expect(text).toContain("CHF");
    expect(text).not.toContain("€");
    expect(text).toContain("dünne Stichprobe");
    expect(text).toContain("Prämiennächte (1)");
  });

  it("links the longest break to the house it happened at", async () => {
    lodging.mockResolvedValueOnce(FULL);
    renderAt(null);
    const gap = await screen.findByTestId("insight-revisits-gap");
    expect(within(gap).getByRole("link", { name: "Gasthof Linde" }).getAttribute("href")).toBe(
      "/lodging/h1"
    );
  });

  it("says which existing data would answer an empty figure, never shows a 0", async () => {
    lodging.mockResolvedValueOnce(EMPTY);
    renderAt(null);
    const empty = await screen.findByTestId("insight-trip-bases-empty");
    expect(empty.textContent).toContain("einer Reise zugeordnet");
    expect(screen.getByTestId("insight-business-empty").textContent).toContain("Geschäftlich");
    expect(screen.getByTestId("insight-trip-bases").textContent).not.toMatch(/\b0 Wechsel/);
  });
});
