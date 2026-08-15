import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LodgingStats } from "../../../../types/lodging";

vi.unmock("../../../../store/settingsStore");

import { useSettingsStore } from "../../../../store/settingsStore";
import LodgingMoneySection from "../LodgingMoneySection";
import LodgingQualitySection from "../LodgingQualitySection";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";

/**
 * The global setup mocks `t` to return the key verbatim, so anything the
 * translation layer would interpolate is untestable here by design. These
 * assertions therefore target two things: WHICH keys a state renders, and the
 * values the components format themselves (currency and star scores).
 */
const base: LodgingStats = {
  lodgingsCount: 2,
  staysCount: 3,
  totalNights: 11,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 4,
  chainsUnique: 1,
  citiesUnique: 2,
  countries: ["DE"],
  countriesCount: 1,
  spendBaseTotal: 1234,
  spendByCurrency: {},
  spendUnconvertedStays: 0,
  spendBaseByCurrency: { EUR: 1234 },
  awardNights: 0,
  nightsByType: { hotel: 11 },
  avgRatingOverall: 4.3,
  chainLoyaltyMax: 1,
  sameHotelRepeatMax: 1,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

const EUR = "EUR";

describe("LodgingMoneySection", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      baseCurrency: EUR,
      units: { distanceUnit: "kilometers", currency: EUR },
    });
  });

  it("states the basis of the averages instead of presenting them bare", () => {
    // An average over 2 of 9 stays reads exactly like an average over 9
    // unless the screen says which it is.
    render(
      <LodgingMoneySection
        stats={{
          ...base,
          price: {
            ...base.price,
            avgPricePerNight: 100,
            medianPricePerNight: 95,
            pricedStays: 2,
            pricedNights: 5,
            unpricedStays: 7,
          },
        }}
      />
    );
    expect(screen.getByText(/lodging:stats\.money\.basis/)).toBeTruthy();
    expect(screen.getByText(/lodging:stats\.money\.omitted/)).toBeTruthy();
  });

  it("says nothing about omitted stays when none were omitted", () => {
    render(
      <LodgingMoneySection
        stats={{
          ...base,
          price: { ...base.price, avgPricePerNight: 100, pricedStays: 2, pricedNights: 5 },
        }}
      />
    );
    expect(screen.queryByText(/lodging:stats\.money\.omitted/)).toBeNull();
  });

  it("shows a dash rather than a zero when nothing is priced", () => {
    // A 0 EUR average would read as "your nights were free".
    render(<LodgingMoneySection stats={base} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("hides the award-value card when there are no award nights", () => {
    render(<LodgingMoneySection stats={base} />);
    expect(screen.queryByText("lodging:stats.money.awardValue")).toBeNull();
  });

  it("shows the award-value card once award nights exist", () => {
    render(
      <LodgingMoneySection
        stats={{ ...base, awardNights: 3, price: { ...base.price, awardNightsValue: 300 } }}
      />
    );
    expect(screen.getByText("lodging:stats.money.awardValue")).toBeTruthy();
  });

  it("labels money with the base currency, not the independent units preference", () => {
    // Same trap LodgingStatStrip guards: `units.currency` is a display setting
    // used for flight costs and has nothing to do with what the backend
    // converted these amounts into.
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers", currency: "USD" },
    });
    render(
      <LodgingMoneySection
        stats={{
          ...base,
          price: { ...base.price, avgPricePerNight: 100, pricedStays: 1, pricedNights: 1 },
        }}
      />
    );
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.getAllByText(/CHF/).length).toBeGreaterThan(0);
  });
});

describe("LodgingQualitySection", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      baseCurrency: EUR,
      units: { distanceUnit: "kilometers", currency: EUR },
    });
  });

  it("shows each of the four rating columns on its own", () => {
    render(
      <LodgingQualitySection
        stats={{
          ...base,
          ratings: {
            ...base.ratings,
            avgOverall: 4.3,
            avgRoom: 4,
            avgBreakfast: 2.5,
            avgService: 5,
            ratedStays: 3,
            unratedStays: 1,
          },
        }}
      />
    );
    expect(screen.getByText("★ 4.3")).toBeTruthy();
    expect(screen.getByText("★ 4.0")).toBeTruthy();
    expect(screen.getByText("★ 2.5")).toBeTruthy();
    expect(screen.getByText("★ 5.0")).toBeTruthy();
  });

  it("shows a dash for a column nothing was rated on", () => {
    render(
      <LodgingQualitySection
        stats={{ ...base, ratings: { ...base.ratings, avgOverall: 4, ratedStays: 1 } }}
      />
    );
    // room / breakfast / service all null -> three dashes.
    expect(screen.getAllByText("—").length).toBe(3);
  });

  it("renders the star buckets in the order the backend supplied, not re-ranked", () => {
    // The backend emits these in SCALE order (1..5). Averages here descend
    // and then jump, so a component that re-sorted by average would produce a
    // different sequence.
    render(
      <LodgingQualitySection
        stats={{
          ...base,
          ratings: {
            ...base.ratings,
            avgOverall: 3.7,
            ratedStays: 3,
            byStars: [
              { key: "3", stays: 1, avgOverall: 2 },
              { key: "4", stays: 1, avgOverall: 5 },
              { key: "5", stays: 1, avgOverall: 4 },
            ],
          },
        }}
      />
    );
    const shown = screen
      .getAllByText(/^★ \d\.\d$/)
      .map((n) => n.textContent)
      .filter((txt): txt is string => txt !== null);
    // The four headline cards come first; the star list follows in order.
    expect(shown.slice(-3)).toEqual(["★ 2.0", "★ 5.0", "★ 4.0"]);
  });

  it("hides the best-value list when no stay has both a rating and a price", () => {
    render(<LodgingQualitySection stats={base} />);
    expect(screen.queryByText("lodging:stats.quality.bestValue")).toBeNull();
  });

  it("shows the best-value list with the price alongside the rating", () => {
    render(
      <LodgingQualitySection
        stats={{
          ...base,
          ratings: {
            ...base.ratings,
            avgOverall: 5,
            ratedStays: 1,
            bestValue: [
              {
                lodgingId: "l1",
                lodgingName: "Pension Seeblick",
                city: "Rostock",
                country: "DE",
                ratingOverall: 5,
                pricePerNight: 50,
                valueScore: 0.1,
              },
            ],
          },
        }}
      />
    );
    expect(screen.getByText("lodging:stats.quality.bestValue")).toBeTruthy();
    expect(screen.getByText(/Pension Seeblick/)).toBeTruthy();
  });
});
