import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Cruise } from "../../../types/cruise";
import type { CruiseStatsResponse } from "../../../lib/api/stats";

/**
 * The money block answers for the population the SERVER answers for.
 *
 * This is the mismatch class the direct `CruiseMoneySection` suite cannot see:
 * that component is handed a fold, and the defect was in WHICH rows were
 * folded. `GET /stats/cruise` counts sailed cruises (`countableCruiseWhere`,
 * flown|historical) while the tab folds `cruiseApi.list()`, which applies no
 * status filter at all — so an account whose only priced cruise was a BOOKING
 * read its price in the per-currency rows and in the coverage line, with
 * "Gesamt in Basiswährung: 0 €" beside them. The rendering therefore starts
 * from a cruise LIST here, not from a hand-made rollup.
 *
 * The calendar and the fun blocks keep the unfiltered list on purpose, and the
 * last case pins that: a booked cruise is still part of the logbook, it is just
 * not money anyone has spent.
 */

const api = vi.hoisted(() => ({ getCruiseStats: vi.fn() }));
vi.mock("../../../lib/api/stats", () => ({ statsApi: api }));

const cruiseList = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../../lib/api/cruise", () => ({ cruiseApi: cruiseList }));

const translation = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) =>
    options === undefined ? key : `${key}(${JSON.stringify(options)})`,
  i18n: { language: "de" },
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => translation }));

import CruiseStatsSection from "../CruiseStatsSection";
import { ALL_VISIBLE } from "./sectionVisibilityStub";

const LIFETIME = { year: null, compareYear: null };

/** The rollup the server sends: ONE sailed cruise, 500 EUR converted. */
const rollup = {
  cruisesCount: 1,
  cruisePortsUnique: 0,
  cruisePortsSingleMax: 0,
  cruiseShipsUnique: 0,
  cruiseLines: [],
  cruiseLinesUnique: 0,
  cruiseLineLoyaltyMax: 0,
  resolvedPortCalls: 0,
  seaDays: 0,
  seaDaysStreak: 0,
  regions: [],
  regionVisitCounts: {},
  countries: [],
  countriesIso: [],
  totalDistanceKm: 0,
  longestLegKm: 0,
  totalPortCalls: 0,
  totalCruiseDays: 8,
  hasBalconyCabin: false,
  hasSuiteCabin: false,
  maxDeck: 0,
  hasCanalTransit: false,
  hasPolar: false,
  hasColdWater: false,
  hasDatelineCrossing: false,
  hasBirthdayAtSea: false,
  hasNewYearsAtSea: false,
  totalSpendBase: { value: 500, excludedCount: 0, currency: "EUR" },
} as unknown as CruiseStatsResponse;

const cruise = (over: Partial<Cruise> & { id: string }): Cruise =>
  ({
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-04-01",
    endDate: "2024-04-08",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...over,
  }) as unknown as Cruise;

/** One sailed cruise at 500 EUR, one BOOKED at 9000 EUR — the reported shape. */
const ROWS: Cruise[] = [
  cruise({ id: "sailed", price: 500, currency: "EUR" }),
  cruise({
    id: "booked",
    price: 9000,
    currency: "EUR",
    status: "scheduled",
    startDate: "2024-09-01",
    endDate: "2024-09-08",
  }),
];

async function renderTab(): Promise<void> {
  render(
    <MemoryRouter>
      <CruiseStatsSection scope={LIFETIME} visibility={ALL_VISIBLE} />
    </MemoryRouter>
  );
  await screen.findByText("cruise:stats.money.title");
}

describe("CruiseStatsSection money block population", () => {
  beforeEach(() => {
    api.getCruiseStats.mockReset();
    api.getCruiseStats.mockResolvedValue(rollup);
    cruiseList.list.mockReset();
    cruiseList.list.mockResolvedValue(ROWS);
  });

  it("puts only the sailed cruise in the per-currency rows", async () => {
    await renderTab();
    const rows = screen.getByText("cruise:stats.money.byCurrency").parentElement;
    expect(rows?.textContent).toMatch(/500/);
    // The booking's 9.000 belongs to no figure in this section. Both cruises
    // are priced in EUR, so folding the unfiltered list produces ONE row of
    // 9.500 rather than a second row — which is why the sum is excluded here
    // too, and why an assertion against 9.000 alone would have passed while
    // the defect was live.
    expect(rows?.textContent).not.toMatch(/9[.,]?000/);
    expect(rows?.textContent).not.toMatch(/9[.,]?500/);
  });

  it("counts the coverage line over the sailed cruises alone", async () => {
    await renderTab();
    expect(
      screen.getByText(/cruise:stats\.money\.coverage.*"priced":1.*"total":1/)
    ).toBeInTheDocument();
  });

  it("says how many booked cruises it left out", async () => {
    await renderTab();
    expect(
      screen.getByText(/cruise:stats\.money\.bookedNotCounted.*"count":1/)
    ).toBeInTheDocument();
  });

  it("agrees with the server's total instead of contradicting it", async () => {
    await renderTab();
    const tile = screen.getByText("cruise:stats.money.baseTotal").parentElement;
    expect(tile?.textContent).toMatch(/500/);
    expect(tile?.textContent).not.toMatch(/9[.,]?000/);
  });

  it("says nothing about bookings when every priced cruise sailed", async () => {
    cruiseList.list.mockResolvedValue([ROWS[0]]);
    await renderTab();
    expect(screen.queryByText(/bookedNotCounted/)).not.toBeInTheDocument();
  });

  /**
   * The filter is the MONEY block's, not the tab's. A booked cruise is still
   * part of the logbook — the calendar counts it, and moving the filter up
   * would quietly redefine every other figure on this tab.
   */
  it("leaves the calendar counting the booked cruise", async () => {
    await renderTab();
    expect(screen.getByText(/cruise:stats\.rhythm\.seasonDesc.*"count":1/)).toBeInTheDocument();
    // Two dated cruises went into the year chart, one of them the booking.
    expect(screen.getByTitle("2024: 2")).toBeInTheDocument();
  });
});
