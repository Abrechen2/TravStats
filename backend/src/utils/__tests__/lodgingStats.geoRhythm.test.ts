import { calculateLodgingStats, type LodgingStayData } from "../lodgingStats";

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

const geo = (stays: LodgingStayData[]) =>
  calculateLodgingStats(stays, "EUR", undefined, NOW).geo;
const rhythm = (stays: LodgingStayData[], now: Date = NOW) =>
  calculateLodgingStats(stays, "EUR", undefined, now).rhythm;

describe("lodging geography", () => {
  it("names the northernmost and southernmost stay", () => {
    const g = geo([
      stay({ lodgingName: "Berlin", lat: 52.5, lon: 13.4 }),
      stay({ lodgingId: "l2", lodgingName: "Tromsø", lat: 69.6, lon: 18.9, country: "NO" }),
      stay({ lodgingId: "l3", lodgingName: "Kapstadt", lat: -33.9, lon: 18.4, country: "ZA" }),
    ]);
    expect(g.northernmost?.lodgingName).toBe("Tromsø");
    expect(g.southernmost?.lodgingName).toBe("Kapstadt");
  });

  it("resolves continents from the country, not from a coordinate box", () => {
    const g = geo([
      stay({ country: "DE" }),
      stay({ lodgingId: "l2", country: "ZA", lat: -33.9, lon: 18.4 }),
      stay({ lodgingId: "l3", country: "JP", lat: 35.7, lon: 139.7 }),
    ]);
    expect(g.continents).toEqual(["Africa", "Asia", "Europe"]);
    expect(g.continentsCount).toBe(3);
  });

  it("puts the centre of gravity near the dateline, not in the Atlantic", () => {
    // Two nights either side of the antimeridian. Averaging the longitudes
    // arithmetically gives ~0° — the Gulf of Guinea. On the sphere it stays
    // where the traveller actually was.
    const g = geo([
      stay({ lat: 0, lon: 179, country: "FJ" }),
      stay({ lodgingId: "l2", lat: 0, lon: -179, country: "FJ" }),
    ]);
    expect(Math.abs(g.centreOfGravity!.lon)).toBeGreaterThan(179);
  });

  it("weights the centre by nights, not by stay count", () => {
    // One night at the equator, ten nights at 50°N. The centre must sit far
    // closer to 50 than to 25.
    const g = geo([
      stay({ lat: 0, lon: 0, checkIn: new Date("2024-01-01"), checkOut: new Date("2024-01-02") }),
      stay({
        lodgingId: "l2",
        lat: 50,
        lon: 0,
        checkIn: new Date("2024-02-01"),
        checkOut: new Date("2024-02-11"),
      }),
    ]);
    expect(g.centreOfGravity!.lat).toBeGreaterThan(43);
  });

  it("counts a stay without coordinates instead of silently dropping it", () => {
    const g = geo([stay({ lat: null, lon: null })]);
    expect(g.unlocatedStays).toBe(1);
    expect(g.centreOfGravity).toBeNull();
    // The country still places it on a continent — coordinates are not needed for that.
    expect(g.continents).toEqual(["Europe"]);
  });

  it("ranks cities by nights, not by number of stays", () => {
    const g = geo([
      stay({ city: "Berlin", checkIn: new Date("2024-01-01"), checkOut: new Date("2024-01-02") }),
      stay({
        lodgingId: "l2",
        city: "Berlin",
        checkIn: new Date("2024-03-01"),
        checkOut: new Date("2024-03-02"),
      }),
      stay({
        lodgingId: "l3",
        city: "Wien",
        checkIn: new Date("2024-05-01"),
        checkOut: new Date("2024-05-11"),
      }),
    ]);
    expect(g.topCities[0]).toEqual({ key: "Wien", nights: 10, stays: 1 });
    expect(g.topCities[1]).toEqual({ key: "Berlin", nights: 2, stays: 2 });
  });

  it("returns empty structures rather than nulls-in-arrays for no stays", () => {
    const g = geo([]);
    expect(g.continents).toEqual([]);
    expect(g.northernmost).toBeNull();
    expect(g.topCities).toEqual([]);
  });
});

describe("lodging rhythm", () => {
  it("treats two touching stays as one unbroken run away", () => {
    // Check out Friday, check in Friday — the user never went home.
    const r = rhythm([
      stay({ checkIn: new Date("2024-03-01"), checkOut: new Date("2024-03-04") }),
      stay({
        lodgingId: "l2",
        checkIn: new Date("2024-03-04"),
        checkOut: new Date("2024-03-07"),
      }),
    ]);
    expect(r.longestStreakNights).toBe(6);
    expect(r.longestStreak).toEqual({ start: "2024-03-01", end: "2024-03-06" });
  });

  it("never counts an overlapping night twice", () => {
    // Two rooms over the same nights — one trip, not two nights per night.
    const r = rhythm([
      stay({ checkIn: new Date("2024-03-01"), checkOut: new Date("2024-03-04") }),
      stay({
        lodgingId: "l2",
        checkIn: new Date("2024-03-02"),
        checkOut: new Date("2024-03-04"),
      }),
    ]);
    expect(r.nightsAway).toBe(3);
    expect(r.longestStreakNights).toBe(3);
  });

  it("measures the longest stretch at home only between recorded nights", () => {
    const r = rhythm([
      stay({ checkIn: new Date("2024-01-01"), checkOut: new Date("2024-01-02") }),
      stay({
        lodgingId: "l2",
        checkIn: new Date("2024-01-12"),
        checkOut: new Date("2024-01-13"),
      }),
    ]);
    // Away 01-01, away 01-12 -> ten nights at home in between.
    expect(r.longestGapDays).toBe(10);
  });

  it("buckets nights by weekday with Sunday at index 0", () => {
    // 2024-03-04 is a Monday; two nights means Monday and Tuesday.
    const r = rhythm([stay({ checkIn: new Date("2024-03-04"), checkOut: new Date("2024-03-06") })]);
    expect(r.nightsByWeekday[1]).toBe(1);
    expect(r.nightsByWeekday[2]).toBe(1);
    expect(r.nightsByWeekday[0]).toBe(0);
  });

  it("aggregates a month across all years, unlike nightsByMonth", () => {
    const r = rhythm([
      stay({ checkIn: new Date("2023-07-01"), checkOut: new Date("2023-07-03") }),
      stay({
        lodgingId: "l2",
        checkIn: new Date("2024-07-01"),
        checkOut: new Date("2024-07-03"),
      }),
    ]);
    expect(r.nightsByMonthOfYear[6]).toBe(4);
    expect(r.nightsBySeason.summer).toBe(4);
  });

  it("divides the current year by the days elapsed, not by 365", () => {
    // 10 nights by 15 August. Against 365 that is 2.7%; against the 227 days
    // elapsed it is 4.4% — and only the second is a fair read in August.
    const r = rhythm([
      stay({ checkIn: new Date("2026-01-01"), checkOut: new Date("2026-01-11") }),
    ]);
    expect(r.awayShareByYear["2026"]).toBeCloseTo(10 / 227, 3);
  });

  it("divides a past year by its real length, leap years included", () => {
    const r = rhythm([
      stay({ checkIn: new Date("2024-01-01"), checkOut: new Date("2024-01-11") }),
    ]);
    expect(r.awayShareByYear["2024"]).toBeCloseTo(10 / 366, 4);
  });

  it("returns zeroes rather than NaN for no stays", () => {
    const r = rhythm([]);
    expect(r.nightsAway).toBe(0);
    expect(r.longestStreakNights).toBe(0);
    expect(r.longestStreak).toBeNull();
    expect(r.longestGapDays).toBe(0);
    expect(r.nightsByWeekday).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
