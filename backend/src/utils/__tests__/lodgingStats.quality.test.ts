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

const ratings = (stays: LodgingStayData[]) =>
  calculateLodgingStats(stays, "EUR", undefined, NOW).ratings;

describe("lodging rating statistics", () => {
  it("averages each of the four columns on its own denominator", () => {
    // Only one of the two stays rated breakfast. Averaging it over both would
    // silently halve it.
    const r = ratings([
      stay({ ratingOverall: 4, ratingRoom: 4, ratingBreakfast: 5, ratingService: 3 }),
      stay({ lodgingId: "l2", ratingOverall: 2, ratingRoom: 2, ratingService: 1 }),
    ]);
    expect(r.avgOverall).toBe(3);
    expect(r.avgRoom).toBe(3);
    expect(r.avgBreakfast).toBe(5);
    expect(r.avgService).toBe(2);
  });

  it("reports how many stays are rated and how many are not", () => {
    const r = ratings([
      stay({ ratingOverall: 4 }),
      stay({ lodgingId: "l2", ratingOverall: null }),
      stay({ lodgingId: "l3", ratingOverall: null }),
    ]);
    expect(r.ratedStays).toBe(1);
    expect(r.unratedStays).toBe(2);
  });

  it("counts a stay rated only on breakfast as unrated overall", () => {
    // The headline figure is the overall rating; a stay without one leaves it
    // blank however much else was filled in.
    const r = ratings([stay({ ratingOverall: null, ratingBreakfast: 5 })]);
    expect(r.unratedStays).toBe(1);
    expect(r.avgOverall).toBeNull();
    expect(r.avgBreakfast).toBe(5);
  });

  it("ranks chains best-first", () => {
    const r = ratings([
      stay({ chainName: "Kempinski", ratingOverall: 3 }),
      stay({ lodgingId: "l2", chainName: "Motel One", ratingOverall: 5 }),
    ]);
    expect(r.byChain.map((g) => g.key)).toEqual(["Motel One", "Kempinski"]);
    expect(r.byChain[0].stays).toBe(1);
  });

  it("keeps the star buckets in scale order, not in ranking order", () => {
    // Read along an axis 1..5 — sorting these by average would scramble it.
    const r = ratings([
      stay({ stars: 5, ratingOverall: 2 }),
      stay({ lodgingId: "l2", stars: 3, ratingOverall: 5 }),
      stay({ lodgingId: "l3", stars: 4, ratingOverall: 4 }),
    ]);
    expect(r.byStars.map((g) => g.key)).toEqual(["3", "4", "5"]);
    expect(r.byStars.find((g) => g.key === "5")?.avgOverall).toBe(2);
  });

  it("leaves a house with no official star count out of the star comparison", () => {
    const r = ratings([stay({ stars: null, ratingOverall: 5 })]);
    expect(r.byStars).toEqual([]);
    expect(r.avgOverall).toBe(5);
  });

  it("ranks best value by rating per unit of price per night", () => {
    // 5 stars at 50/night beats 5 stars at 200/night.
    const r = ratings([
      stay({ lodgingName: "Teuer", ratingOverall: 5, totalPriceBase: 400 }),
      stay({
        lodgingId: "l2",
        lodgingName: "Günstig",
        ratingOverall: 5,
        totalPriceBase: 100,
      }),
    ]);
    expect(r.bestValue[0].lodgingName).toBe("Günstig");
    expect(r.bestValue[0].pricePerNight).toBe(50);
  });

  it("keeps a stay without a comparable price out of the value ranking", () => {
    const r = ratings([
      stay({ ratingOverall: 5, totalPriceBase: null }),
      stay({ lodgingId: "l2", ratingOverall: 5, fxBaseCurrency: "USD" }),
    ]);
    expect(r.bestValue).toEqual([]);
    // …but they still count toward the averages, which need no price.
    expect(r.ratedStays).toBe(2);
  });

  it("returns nulls rather than NaN for an empty input", () => {
    const r = ratings([]);
    expect(r.avgOverall).toBeNull();
    expect(r.avgBreakfast).toBeNull();
    expect(r.byChain).toEqual([]);
    expect(r.bestValue).toEqual([]);
  });

  it("ignores a cancelled stay's ratings", () => {
    const r = ratings([
      stay({ ratingOverall: 5 }),
      stay({ lodgingId: "l2", status: "cancelled", ratingOverall: 1 }),
    ]);
    expect(r.avgOverall).toBe(5);
    expect(r.ratedStays).toBe(1);
  });
});
