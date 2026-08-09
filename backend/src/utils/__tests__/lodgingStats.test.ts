import { calculateLodgingStats, LodgingStayData } from "../lodgingStats";

const stay = (o: Partial<LodgingStayData>): LodgingStayData => ({
  lodgingId: "l1",
  type: "hotel",
  country: "DE",
  city: "Berlin",
  chainId: 1,
  checkIn: new Date("2024-05-14T00:00:00Z"),
  checkOut: new Date("2024-05-16T00:00:00Z"),
  status: "completed",
  totalPriceBase: 190,
  // Every fixture snapshots into EUR by default so pre-existing tests that
  // don't pass a `currentBaseCurrency` (defaulting to "EUR") keep matching
  // their original spendBaseTotal expectations.
  fxBaseCurrency: "EUR",
  currency: "EUR",
  totalPrice: 190,
  isAwardStay: false,
  ratingOverall: 4,
  ...o,
});

describe("calculateLodgingStats", () => {
  it("sums nights and base spend, excluding cancelled", () => {
    const s = calculateLodgingStats([
      stay({}),
      stay({ status: "cancelled", totalPriceBase: 999 }),
    ]);
    expect(s.totalNights).toBe(2);
    expect(s.staysCount).toBe(1);
    expect(s.spendBaseTotal).toBe(190);
  });

  it("keeps a per-currency breakdown of originals", () => {
    const s = calculateLodgingStats([
      stay({ currency: "EUR", totalPrice: 190, totalPriceBase: 190 }),
      stay({
        lodgingId: "l2",
        currency: "CHF",
        totalPrice: 420,
        totalPriceBase: 424,
      }),
    ]);
    expect(s.spendByCurrency).toEqual({ EUR: 190, CHF: 420 });
    expect(s.spendBaseTotal).toBe(614);
  });

  it("allocates nights across a year boundary to each year", () => {
    const s = calculateLodgingStats([
      stay({
        checkIn: new Date("2023-12-30T00:00:00Z"),
        checkOut: new Date("2024-01-02T00:00:00Z"),
      }),
    ]);
    expect(s.totalNights).toBe(3);
    expect(s.nightsByYear["2023"]).toBe(2); // nights of Dec 30, Dec 31
    expect(s.nightsByYear["2024"]).toBe(1); // night of Jan 1
  });

  it("returns sane zero/null values for an empty input", () => {
    const s = calculateLodgingStats([]);
    expect(s.lodgingsCount).toBe(0);
    expect(s.staysCount).toBe(0);
    expect(s.totalNights).toBe(0);
    expect(s.nightsByYear).toEqual({});
    expect(s.nightsByMonth).toEqual({});
    expect(s.longestStayNights).toBe(0);
    expect(s.chainsUnique).toBe(0);
    expect(s.citiesUnique).toBe(0);
    expect(s.countries.size).toBe(0);
    expect(s.countriesCount).toBe(0);
    expect(s.spendBaseTotal).toBe(0);
    expect(s.spendByCurrency).toEqual({});
    expect(s.spendBaseByCurrency).toEqual({});
    expect(s.awardNights).toBe(0);
    expect(s.nightsByType).toEqual({});
    expect(s.avgRatingOverall).toBeNull();
    expect(s.chainLoyaltyMax).toBe(0);
    expect(s.sameHotelRepeatMax).toBe(0);
  });

  it("handles a failed FX lookup (totalPriceBase null) without poisoning the sum", () => {
    const s = calculateLodgingStats([
      stay({ totalPriceBase: null, currency: "JPY", totalPrice: 15000 }),
      stay({
        lodgingId: "l2",
        totalPriceBase: 200,
        currency: "EUR",
        totalPrice: 200,
      }),
    ]);
    expect(s.spendByCurrency).toEqual({ JPY: 15000, EUR: 200 });
    expect(s.spendBaseTotal).toBe(200);
    expect(Number.isNaN(s.spendBaseTotal)).toBe(false);
  });

  it("never mixes totalPriceBase amounts snapshotted into different base currencies (finding 2)", () => {
    // Stay 1 was snapshotted while the user's base currency was EUR; stay 2
    // was snapshotted AFTER the user switched their base currency to CHF.
    // The old EUR snapshot is a permanent historical record — it must never
    // be silently added into a "CHF" total just because CHF is now current.
    const s = calculateLodgingStats(
      [
        stay({ lodgingId: "l1", fxBaseCurrency: "EUR", totalPriceBase: 190 }),
        stay({ lodgingId: "l2", fxBaseCurrency: "CHF", totalPriceBase: 424 }),
      ],
      "CHF",
    );
    expect(s.spendBaseTotal).toBe(424); // ONLY the CHF-snapshotted stay
    expect(s.spendBaseByCurrency).toEqual({ EUR: 190, CHF: 424 });
  });

  it("defaults currentBaseCurrency to EUR when the caller omits it", () => {
    const s = calculateLodgingStats([
      stay({ lodgingId: "l1", fxBaseCurrency: "EUR", totalPriceBase: 100 }),
      stay({ lodgingId: "l2", fxBaseCurrency: "CHF", totalPriceBase: 500 }),
    ]);
    expect(s.spendBaseTotal).toBe(100);
    expect(s.spendBaseByCurrency).toEqual({ EUR: 100, CHF: 500 });
  });

  it("counts a same-day check-in/check-out as 0 nights", () => {
    const s = calculateLodgingStats([
      stay({
        checkIn: new Date("2024-05-14T00:00:00Z"),
        checkOut: new Date("2024-05-14T00:00:00Z"),
      }),
    ]);
    expect(s.totalNights).toBe(0);
    expect(s.nightsByYear).toEqual({});
    expect(s.nightsByMonth).toEqual({});
  });

  it("is null (not 0/NaN) when no stays are rated", () => {
    const s = calculateLodgingStats([stay({ ratingOverall: null })]);
    expect(s.avgRatingOverall).toBeNull();
  });

  it("attributes a late-evening check-in to the correct day/month/year bucket, timezone-safe", () => {
    // Check-in at 23:30 UTC on Dec 31 must not spill the night into Jan 1.
    const s = calculateLodgingStats([
      stay({
        checkIn: new Date("2024-12-31T23:30:00Z"),
        checkOut: new Date("2025-01-01T23:30:00Z"),
      }),
    ]);
    expect(s.totalNights).toBe(1);
    expect(s.nightsByYear["2024"]).toBe(1);
    expect(s.nightsByYear["2025"]).toBeUndefined();
    expect(s.nightsByMonth["2024-12"]).toBe(1);
  });

  it("computes chainLoyaltyMax and sameHotelRepeatMax with repeats", () => {
    const s = calculateLodgingStats([
      stay({ lodgingId: "l1", chainId: 1 }),
      stay({ lodgingId: "l1", chainId: 1 }),
      stay({ lodgingId: "l2", chainId: 1 }),
      stay({ lodgingId: "l3", chainId: 2 }),
    ]);
    expect(s.chainLoyaltyMax).toBe(3); // chain 1: l1 twice + l2 once
    expect(s.sameHotelRepeatMax).toBe(2); // l1 twice
  });

  it("does not leak a null country/city/chain into a Set or count", () => {
    const s = calculateLodgingStats([
      stay({ country: null, city: null, chainId: null }),
    ]);
    expect(s.countries.size).toBe(0);
    expect(s.countriesCount).toBe(0);
    expect(s.citiesUnique).toBe(0);
    expect(s.chainsUnique).toBe(0);
  });

  it("does not mutate the input array", () => {
    const stays = [stay({}), stay({ lodgingId: "l2" })];
    const frozenCopy = JSON.parse(
      JSON.stringify(
        stays.map((s) => ({
          ...s,
          checkIn: s.checkIn.toISOString(),
          checkOut: s.checkOut.toISOString(),
        })),
      ),
    );
    calculateLodgingStats(stays);
    const afterCopy = JSON.parse(
      JSON.stringify(
        stays.map((s) => ({
          ...s,
          checkIn: s.checkIn.toISOString(),
          checkOut: s.checkOut.toISOString(),
        })),
      ),
    );
    expect(afterCopy).toEqual(frozenCopy);
  });

  it("counts a lodging with zero stays via the optional lodgings param", () => {
    // Owner-decision fix: lodgingsCount/chainsUnique must reflect hotels the
    // user HAS, including ones with no stay yet (a newly added hotel).
    const lodgings = [
      { id: "l1", chainId: 1, type: "hotel", country: "DE", city: "Berlin" },
      { id: "l2-no-stay", chainId: 2, type: "hotel", country: "AT", city: "Vienna" },
    ];
    const s = calculateLodgingStats([stay({ lodgingId: "l1", chainId: 1 })], "EUR", lodgings);
    expect(s.lodgingsCount).toBe(2);
    expect(s.chainsUnique).toBe(2);
    // The stay-less hotel's country/city count even before any stay exists.
    expect(s.countries.has("AT")).toBe(true);
    expect(s.citiesUnique).toBe(2);
  });

  it("falls back to stay-derived counting when lodgings is omitted (back-compat)", () => {
    const s = calculateLodgingStats([stay({ lodgingId: "l1", chainId: 1 })]);
    expect(s.lodgingsCount).toBe(1);
    expect(s.chainsUnique).toBe(1);
  });

  it("does not double-count a lodging that both has a stay and appears in the lodgings list", () => {
    const lodgings = [{ id: "l1", chainId: 1, type: "hotel", country: "DE", city: "Berlin" }];
    const s = calculateLodgingStats(
      [stay({ lodgingId: "l1", chainId: 1 }), stay({ lodgingId: "l1", chainId: 1 })],
      "EUR",
      lodgings,
    );
    expect(s.lodgingsCount).toBe(1);
    expect(s.chainsUnique).toBe(1);
  });

  it("tracks nights by type (award/hotel/campsite) and longest stay", () => {
    const s = calculateLodgingStats([
      stay({
        lodgingId: "l1",
        type: "hotel",
        isAwardStay: true,
        checkIn: new Date("2024-01-01T00:00:00Z"),
        checkOut: new Date("2024-01-04T00:00:00Z"),
      }),
      stay({
        lodgingId: "l2",
        type: "campsite",
        isAwardStay: false,
        checkIn: new Date("2024-02-01T00:00:00Z"),
        checkOut: new Date("2024-02-02T00:00:00Z"),
      }),
    ]);
    expect(s.longestStayNights).toBe(3);
    expect(s.awardNights).toBe(3);
    expect(s.nightsByType).toEqual({ hotel: 3, campsite: 1 });
  });

  it("tracks nights by type for every lodging type in the vocabulary, not just hotel/campsite", () => {
    const s = calculateLodgingStats([
      stay({
        lodgingId: "l1",
        type: "guesthouse",
        checkIn: new Date("2024-01-01T00:00:00Z"),
        checkOut: new Date("2024-01-03T00:00:00Z"),
      }),
      stay({
        lodgingId: "l2",
        type: "apartment",
        checkIn: new Date("2024-02-01T00:00:00Z"),
        checkOut: new Date("2024-02-05T00:00:00Z"),
      }),
      stay({
        lodgingId: "l3",
        type: "hostel",
        checkIn: new Date("2024-03-01T00:00:00Z"),
        checkOut: new Date("2024-03-02T00:00:00Z"),
      }),
    ]);
    expect(s.nightsByType).toEqual({ guesthouse: 2, apartment: 4, hostel: 1 });
  });

  it("omits a type entirely from nightsByType when its only stay has 0 nights", () => {
    const s = calculateLodgingStats([
      stay({
        type: "hostel",
        checkIn: new Date("2024-05-14T00:00:00Z"),
        checkOut: new Date("2024-05-14T00:00:00Z"),
      }),
    ]);
    expect(s.nightsByType).toEqual({});
  });
});
