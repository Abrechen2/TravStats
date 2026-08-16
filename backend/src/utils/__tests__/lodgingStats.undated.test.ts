import { calculateLodgingStats, type LodgingStayData } from "../lodgingStats";

/**
 * Owner rule (2026-08-16): an undated stay counts in sums, rankings and
 * achievements — everything needing no calendar position — and never in a
 * calendar series or in trip gap analysis.
 *
 * These tests assert BOTH halves. Only asserting the first would let a
 * regression that quietly places an undated stay on 1 January pass.
 */
const NOW = new Date("2026-08-15T12:00:00Z");

const stay = (o: Partial<LodgingStayData>): LodgingStayData => ({
  lodgingId: "l1",
  lodgingName: "Hotel Adlon",
  type: "hotel",
  country: "DE",
  city: "Berlin",
  chainId: 1,
  chainName: "Kempinski",
  stars: 5,
  lat: 52.516,
  lon: 13.38,
  checkIn: new Date("2024-05-14T00:00:00Z"),
  checkOut: new Date("2024-05-16T00:00:00Z"),
  datePrecision: "DAY",
  nights: null,
  status: "completed",
  totalPriceBase: 200,
  fxBaseCurrency: "EUR",
  currency: "EUR",
  totalPrice: 200,
  board: "breakfast",
  isAwardStay: false,
  ratingOverall: null,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  programName: null,
  membershipTier: null,
  ...o,
});

/** "That hotel in Rome, some time, three nights, no idea when." */
const undated = (o: Partial<LodgingStayData> = {}): LodgingStayData =>
  stay({
    lodgingId: "l-undated",
    lodgingName: "Albergo Senza Data",
    city: "Rom",
    country: "IT",
    checkIn: null,
    checkOut: null,
    datePrecision: "NONE",
    nights: 3,
    ...o,
  });

const roll = (stays: LodgingStayData[]) => calculateLodgingStats(stays, "EUR", undefined, NOW);

describe("an undated stay", () => {
  it("counts as a stay and contributes its nights to the total", () => {
    const s = roll([undated()]);
    expect(s.staysCount).toBe(1);
    expect(s.totalNights).toBe(3);
    expect(s.undatedStays).toBe(1);
    expect(s.undatedNights).toBe(3);
  });

  it("never lands in a year or month series", () => {
    // The whole point. A stay placed on its placeholder would be
    // indistinguishable from one that really started there.
    const s = roll([undated()]);
    expect(s.nightsByYear).toEqual({});
    expect(s.nightsByMonth).toEqual({});
  });

  it("counts toward country, city, chain and continent rankings", () => {
    const s = roll([undated()]);
    expect(s.countries.has("IT")).toBe(true);
    expect(s.citiesUnique).toBe(1);
    expect(s.geo.continents).toEqual(["Europe"]);
    expect(s.geo.topCities[0]).toEqual({ key: "Rom", nights: 3, stays: 1 });
  });

  it("counts toward money and quality, which need no calendar", () => {
    const s = roll([undated({ totalPriceBase: 300, ratingOverall: 4, ratingBreakfast: 5 })]);
    expect(s.price.avgPricePerNight).toBe(100);
    expect(s.price.pricedStays).toBe(1);
    expect(s.ratings.avgOverall).toBe(4);
    expect(s.ratings.avgBreakfast).toBe(5);
    // …but the price trend line, which is read by year, has nothing for it.
    expect(s.price.byYear).toEqual([]);
    expect(s.price.byCountry[0].key).toBe("IT");
  });

  it("has a null check-in on a superlative rather than a fabricated date", () => {
    const s = roll([undated({ totalPriceBase: 300 })]);
    expect(s.price.cheapestNight?.lodgingName).toBe("Albergo Senza Data");
    expect(s.price.cheapestNight?.checkIn).toBeNull();
  });

  it("stays out of the rhythm figures entirely", () => {
    // No weekday, no season, and — importantly — it cannot bridge the gap
    // between two real runs that never touched.
    const s = roll([
      stay({ checkIn: new Date("2024-03-01"), checkOut: new Date("2024-03-03") }),
      undated({ nights: 30 }),
      stay({
        lodgingId: "l3",
        checkIn: new Date("2024-03-20"),
        checkOut: new Date("2024-03-22"),
      }),
    ]);
    expect(s.rhythm.nightsAway).toBe(4);
    expect(s.rhythm.longestStreakNights).toBe(2);
    expect(s.rhythm.nightsByWeekday.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("is left out of a programme year, because the status year IS the figure", () => {
    const s = roll([undated({ programName: "Bonvoy", membershipTier: "Gold" })]);
    expect(s.loyalty.programmeYears).toEqual([]);
    // The chain split needs no year, so it still counts there.
    expect(s.loyalty.chainNights).toBe(3);
  });

  it("counts as visited on its stored status, since there is no date to derive from", () => {
    const s = roll([undated({ status: "scheduled" })]);
    // "scheduled" with no dates stays planned — the user said it has not
    // happened, and nothing contradicts them.
    expect(s.staysCount).toBe(0);
    expect(s.plannedStaysCount).toBe(1);
  });

  it("separates a stay of unknown LENGTH from one of unknown DATE", () => {
    const s = roll([undated({ nights: null })]);
    expect(s.staysCount).toBe(1);
    expect(s.totalNights).toBe(0);
    expect(s.staysWithUnknownLength).toBe(1);
  });
});

describe("a month-precision stay", () => {
  const july2011 = stay({
    lodgingId: "l-july",
    checkIn: new Date("2011-07-01T00:00:00Z"),
    checkOut: null,
    datePrecision: "MONTH",
    nights: 5,
  });

  it("reaches the year and month series but not the weekday one", () => {
    const s = roll([july2011]);
    expect(s.nightsByYear["2011"]).toBe(5);
    expect(s.nightsByMonth["2011-07"]).toBe(5);
    // A placeholder day would have invented a weekday.
    expect(s.rhythm.nightsByWeekday.reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.undatedStays).toBe(0);
  });

  it("does not have its placeholder dates differenced into a night count", () => {
    const s = roll([{ ...july2011, nights: null }]);
    expect(s.totalNights).toBe(0);
    expect(s.staysWithUnknownLength).toBe(1);
  });
});

describe("a year-precision stay", () => {
  it("reaches the year series only", () => {
    // Stored as 1 January. A month bucket would report a January holiday the
    // user never took.
    const s = roll([
      stay({
        checkIn: new Date("2011-01-01T00:00:00Z"),
        checkOut: null,
        datePrecision: "YEAR",
        nights: 4,
      }),
    ]);
    expect(s.nightsByYear["2011"]).toBe(4);
    expect(s.nightsByMonth).toEqual({});
  });
});
