import {
  computeBookingSplit,
  minorDigits,
  readBookingSplit,
  splitMinorUnits,
} from "../bookingPriceSplit";

/**
 * forgejo#219 — a booking total split across its segments keeps every cent:
 * largest remainder on exact integers, in the currency's own minor unit.
 */
describe("splitMinorUnits", () => {
  it("never loses or invents a cent", () => {
    for (const [total, weights] of [
      [10000, [1, 1, 1]],
      [1, [1, 1, 1]],
      [99999, [3, 7, 11, 13]],
      [48000, [304, 6200]],
      [0, [1, 1]],
    ] as Array<[number, number[]]>) {
      const shares = splitMinorUnits(total, weights);
      expect(shares.reduce((a, s) => a + s, 0)).toBe(total);
      expect(shares.every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
    }
  });

  it("hands the leftover cent to the largest remainder, ties to the earlier segment", () => {
    expect(splitMinorUnits(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(splitMinorUnits(10, [1, 2])).toEqual([3, 7]);
  });
});

describe("minorDigits", () => {
  it("reads the currency's own minor unit", () => {
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("BHD")).toBe(3);
    expect(minorDigits(null)).toBe(2);
    expect(minorDigits("NOTACODE")).toBe(2);
  });
});

describe("computeBookingSplit", () => {
  const booking = { price: 100, currency: "EUR", otherEntries: 0 };
  const segs = [
    { id: "a", routeDistance: 304.4 },
    { id: "b", routeDistance: 6200.2 },
    { id: "c", routeDistance: 6200.2 },
  ];

  it("splits equally to the cent, summing to the total", () => {
    const out = computeBookingSplit(booking, segs, "equal");
    expect(out).toEqual({
      split: {
        method: "equal",
        price: 100,
        currency: "EUR",
        shares: [
          { flightId: "a", amount: 33.34 },
          { flightId: "b", amount: 33.33 },
          { flightId: "c", amount: 33.33 },
        ],
      },
    });
  });

  it("splits by distance, and yen stay whole", () => {
    const out = computeBookingSplit(
      { ...booking, price: 50001, currency: "JPY" },
      segs,
      "distance"
    );
    if (!("split" in out)) throw new Error("expected a split");
    const amounts = out.split.shares.map((s) => s.amount);
    expect(amounts.every(Number.isInteger)).toBe(true);
    expect(amounts.reduce((a, s) => a + s, 0)).toBe(50001);
    expect(amounts[0]).toBeLessThan(amounts[1]);
  });

  it("refuses what it cannot split honestly", () => {
    expect(computeBookingSplit({ ...booking, price: null }, segs, "equal")).toEqual({
      refusal: "BOOKING_PRICE_MISSING",
    });
    expect(computeBookingSplit({ ...booking, otherEntries: 1 }, segs, "equal")).toEqual({
      refusal: "BOOKING_SPLIT_MIXED",
    });
    expect(computeBookingSplit(booking, segs.slice(0, 1), "equal")).toEqual({
      refusal: "BOOKING_SPLIT_SINGLE_SEGMENT",
    });
    expect(
      computeBookingSplit(booking, [...segs, { id: "d", routeDistance: null }], "distance")
    ).toEqual({ refusal: "BOOKING_SPLIT_DISTANCE_UNKNOWN" });
  });
});

describe("readBookingSplit", () => {
  const stored = {
    method: "equal",
    price: 100,
    currency: "EUR",
    shares: [
      { flightId: "a", amount: 50 },
      { flightId: "b", amount: 50 },
    ],
  };

  it("is current while price, currency and segments are as they were", () => {
    expect(readBookingSplit(stored, { price: 100, currency: "EUR" }, ["b", "a"])).toMatchObject({
      staleReason: null,
    });
  });

  it("says what changed since", () => {
    expect(readBookingSplit(stored, { price: 120, currency: "EUR" }, ["a", "b"])?.staleReason).toBe(
      "price"
    );
    expect(readBookingSplit(stored, { price: 100, currency: "USD" }, ["a", "b"])?.staleReason).toBe(
      "currency"
    );
    expect(
      readBookingSplit(stored, { price: 100, currency: "EUR" }, ["a", "b", "c"])?.staleReason
    ).toBe("segments");
  });

  it("reads nothing stored, or something unreadable, as no split", () => {
    expect(readBookingSplit(null, { price: 100, currency: "EUR" }, [])).toBeNull();
    expect(readBookingSplit({ junk: true }, { price: 100, currency: "EUR" }, [])).toBeNull();
  });
});
