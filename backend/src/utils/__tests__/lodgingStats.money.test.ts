import { calculateLodgingStats, type LodgingStayData } from "../lodgingStats";

/** Fixed clock — every fixture below is in the past relative to it. */
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
  ...o,
});

const price = (stays: LodgingStayData[], base = "EUR") =>
  calculateLodgingStats(stays, base, undefined, NOW).price;

describe("lodging price statistics", () => {
  it("averages per NIGHT, not per stay", () => {
    // 200 over 2 nights and 300 over 3 nights is 100/night either way.
    const p = price([
      stay({ totalPriceBase: 200, checkOut: new Date("2024-05-16T00:00:00Z") }),
      stay({
        lodgingId: "l2",
        totalPriceBase: 300,
        checkIn: new Date("2024-06-01T00:00:00Z"),
        checkOut: new Date("2024-06-04T00:00:00Z"),
      }),
    ]);
    expect(p.avgPricePerNight).toBe(100);
    expect(p.pricedNights).toBe(5);
    expect(p.pricedStays).toBe(2);
  });

  it("weights the median by nights, so a long stay is not outvoted by a short one", () => {
    // One night at 500, four nights at 100. A median over STAYS would be 300;
    // over nights it is 100, which is what a typical night actually cost.
    const p = price([
      stay({
        totalPriceBase: 500,
        checkIn: new Date("2024-01-01T00:00:00Z"),
        checkOut: new Date("2024-01-02T00:00:00Z"),
      }),
      stay({
        lodgingId: "l2",
        totalPriceBase: 400,
        checkIn: new Date("2024-02-01T00:00:00Z"),
        checkOut: new Date("2024-02-05T00:00:00Z"),
      }),
    ]);
    expect(p.medianPricePerNight).toBe(100);
  });

  it("leaves out a stay snapshotted under a different base currency", () => {
    const p = price([
      stay({ totalPriceBase: 200 }),
      stay({ lodgingId: "l2", totalPriceBase: 9999, fxBaseCurrency: "USD" }),
    ]);
    expect(p.avgPricePerNight).toBe(100);
    expect(p.pricedStays).toBe(1);
    expect(p.unpricedStays).toBe(1);
  });

  it("does not count an unpriced stay as a gap — it was never a money question", () => {
    const p = price([
      stay({ totalPriceBase: 200 }),
      stay({ lodgingId: "l2", totalPriceBase: null, totalPrice: null }),
    ]);
    expect(p.unpricedStays).toBe(0);
  });

  it("never divides by zero nights on a same-day stay", () => {
    const p = price([
      stay({
        checkIn: new Date("2024-05-14T00:00:00Z"),
        checkOut: new Date("2024-05-14T00:00:00Z"),
        totalPriceBase: 120,
      }),
    ]);
    expect(p.avgPricePerNight).toBeNull();
    expect(Number.isFinite(p.avgPricePerNight ?? 0)).toBe(true);
  });

  it("names the cheapest and dearest night with the house and the date", () => {
    const p = price([
      stay({ totalPriceBase: 200 }),
      stay({
        lodgingId: "l2",
        lodgingName: "Pension Seeblick",
        city: "Rostock",
        totalPriceBase: 60,
        checkIn: new Date("2024-07-01T00:00:00Z"),
        checkOut: new Date("2024-07-02T00:00:00Z"),
      }),
    ]);
    expect(p.cheapestNight?.lodgingName).toBe("Pension Seeblick");
    expect(p.cheapestNight?.pricePerNight).toBe(60);
    expect(p.cheapestNight?.checkIn).toBe("2024-07-01T00:00:00.000Z");
    expect(p.dearestNight?.pricePerNight).toBe(100);
  });

  it("groups by year oldest-first and by country most-nights-first", () => {
    const p = price([
      stay({
        country: "IT",
        checkIn: new Date("2023-03-01T00:00:00Z"),
        checkOut: new Date("2023-03-02T00:00:00Z"),
        totalPriceBase: 80,
      }),
      stay({
        lodgingId: "l2",
        country: "DE",
        checkIn: new Date("2024-03-01T00:00:00Z"),
        checkOut: new Date("2024-03-06T00:00:00Z"),
        totalPriceBase: 500,
      }),
    ]);
    expect(p.byYear.map((g) => g.key)).toEqual(["2023", "2024"]);
    expect(p.byYear[0].avgPerNight).toBe(80);
    expect(p.byCountry[0].key).toBe("DE");
    expect(p.byCountry[0].nights).toBe(5);
  });

  it("values award nights at the average PAID rate, ignoring the free ones", () => {
    // 2 paid nights at 100, plus 3 award nights that cost nothing. The award
    // nights are worth 3 x 100 — not 3 x (300/5), which would value them
    // against an average they themselves dragged down.
    const p = price([
      stay({ totalPriceBase: 200 }),
      stay({
        lodgingId: "l2",
        isAwardStay: true,
        totalPriceBase: 0,
        totalPrice: 0,
        checkIn: new Date("2024-09-01T00:00:00Z"),
        checkOut: new Date("2024-09-04T00:00:00Z"),
      }),
    ]);
    expect(p.awardNightsValue).toBe(300);
  });

  it("has no award value when nothing was ever paid to derive a rate from", () => {
    const p = price([
      stay({ isAwardStay: true, totalPriceBase: 0, totalPrice: 0 }),
    ]);
    expect(p.awardNightsValue).toBeNull();
  });

  it("returns nulls rather than NaN for an empty input", () => {
    const p = price([]);
    expect(p.avgPricePerNight).toBeNull();
    expect(p.medianPricePerNight).toBeNull();
    expect(p.cheapestNight).toBeNull();
    expect(p.byYear).toEqual([]);
  });

  it("splits spending by board type", () => {
    const p = price([
      stay({ board: "breakfast", totalPriceBase: 200 }),
      stay({
        lodgingId: "l2",
        board: "all_inclusive",
        totalPriceBase: 600,
        checkIn: new Date("2024-08-01T00:00:00Z"),
        checkOut: new Date("2024-08-04T00:00:00Z"),
      }),
    ]);
    const ai = p.byBoard.find((g) => g.key === "all_inclusive");
    expect(ai?.nights).toBe(3);
    expect(ai?.avgPerNight).toBe(200);
  });
});
