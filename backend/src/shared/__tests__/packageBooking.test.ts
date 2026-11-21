import { computeDedupedTotalCost, type CostFlight } from "../../utils/stats/dedupedCost";
import { calculateBusinessStats } from "../../utils/stats/businessStats";
import type { FlightData } from "../../utils/stats/types";
import { tripCostItems, type TripCostInput } from "../tripCost";
import { ownOrPackagePrice, packageEntryShare, validSplitShare } from "../packageBooking";
import { computePackageSplit } from "../../services/booking/packageSplit";
import { readBookingSplit } from "../../services/flights/bookingPriceSplit";

/**
 * forgejo#430 — a package (one price for a flight and a hotel) must never be
 * read as a flight price, never be counted twice, and never be summed across
 * currencies.
 */

const PACKAGE_COUNT = { flights: 2, lodgingStays: 1 };
const pkgBooking = (over: Partial<NonNullable<CostFlight["booking"]>> = {}) => ({
  price: 2870.96,
  currency: "EUR",
  priceBase: 2870.96,
  fxBaseCurrency: "EUR",
  priceSplit: null as unknown,
  _count: PACKAGE_COUNT,
  ...over,
});
const flight = (
  id: string,
  booking: CostFlight["booking"],
  own: number | null = null
): CostFlight => ({
  id,
  price: own,
  taxes: null,
  fees: null,
  currency: "EUR",
  priceBase: own,
  fxBaseCurrency: own === null ? null : "EUR",
  bookingId: booking ? "b1" : null,
  booking,
});
const splitOf = (shares: [string, string, number][], price = 2870.96, currency = "EUR") => ({
  method: "manual",
  price,
  currency,
  shares: shares.map(([kind, id, amount]) => ({ kind, id, amount })),
});

describe("package bookings in the flight statistics (forgejo#430)", () => {
  it("a flights-only booking still counts its price once, as a flight price", () => {
    const b = pkgBooking({ _count: { flights: 2 } });
    const cost = computeDedupedTotalCost([flight("f1", b), flight("f2", b)], "EUR");
    expect(cost.base).toBe(2870.96);
    expect(cost.packagedFlights).toBe(0);
  });

  it("an unsplit package's flights abstain — not 0, not the package price, not unpriced", () => {
    const b = pkgBooking();
    const cost = computeDedupedTotalCost([flight("f1", b), flight("f2", b)], "EUR");
    expect(cost.base).toBeNull();
    expect(cost.packagedFlights).toBe(2);
    expect(cost.unpricedFlights).toBe(0);
    expect(cost.pricedFlights).toBe(0);
  });

  it("a split package's flights count their own shares only", () => {
    const b = pkgBooking({
      priceSplit: splitOf([
        ["flight", "f1", 600],
        ["flight", "f2", 600],
        ["stay", "s1", 1670.96],
      ]),
    });
    const cost = computeDedupedTotalCost([flight("f1", b), flight("f2", b)], "EUR");
    expect(cost.base).toBe(1200);
    expect(cost.perFlightBaseContribution).toEqual([600, 600]);
  });

  it("a split made for an older price abstains instead of misstating", () => {
    const b = pkgBooking({
      price: 3000,
      priceSplit: splitOf([
        ["flight", "f1", 600],
        ["stay", "s1", 2270.96],
      ]),
    });
    expect(computeDedupedTotalCost([flight("f1", b)], "EUR").packagedFlights).toBe(1);
  });

  it("keeps a foreign-currency share apart instead of summing it as euros", () => {
    const b = pkgBooking({
      currency: "USD",
      priceBase: null,
      fxBaseCurrency: null,
      _count: { flights: 1, lodgingStays: 1 },
      priceSplit: splitOf(
        [
          ["flight", "f1", 1000],
          ["stay", "s1", 1870.96],
        ],
        2870.96,
        "USD"
      ),
    });
    const cost = computeDedupedTotalCost([flight("f1", b), flight("f9", null, 100)], "EUR");
    expect(cost.base).toBe(100);
    expect(cost.unconvertedByCurrency).toEqual({ USD: 1000 });
  });

  it("converts a share through the booking's own snapshot ratio", () => {
    const share = packageEntryShare(
      {
        price: 1000,
        currency: "USD",
        priceBase: 900,
        fxBaseCurrency: "EUR",
        priceSplit: splitOf(
          [
            ["flight", "f1", 400],
            ["stay", "s1", 600],
          ],
          1000,
          "USD"
        ),
        _count: { flights: 1, lodgingStays: 1 },
      },
      "flight",
      "f1"
    );
    expect(share).toEqual({
      amount: 400,
      currency: "USD",
      amountBase: 360,
      snapshotCurrency: "EUR",
    });
  });

  it("reads a version-1 flight split (forgejo#219) as flight shares", () => {
    const v1 = {
      method: "equal",
      price: 1000,
      currency: "EUR",
      shares: [
        { flightId: "f1", amount: 500 },
        { flightId: "f2", amount: 500 },
      ],
    };
    const booking = { price: 1000, currency: "EUR", _count: { flights: 2 } };
    expect(validSplitShare(v1, booking, "flight", "f1")).toBe(500);
  });

  it("an item added after the split makes the package abstain, not undercount", () => {
    const b = pkgBooking({
      _count: { flights: 2, lodgingStays: 1, rentals: 1 },
      priceSplit: splitOf([
        ["flight", "f1", 600],
        ["flight", "f2", 600],
        ["stay", "s1", 1670.96],
      ]),
    });
    const cost = computeDedupedTotalCost([flight("f1", b), flight("f2", b)], "EUR");
    expect(cost.base).toBeNull();
    expect(cost.packagedFlights).toBe(2);
  });

  it("cost per km leaves an unsplit package flight out of numerator and denominator", () => {
    const base: Omit<FlightData, "id" | "booking" | "bookingId"> = {
      status: "flown",
      depLat: 50,
      depLon: 8,
      arrLat: 40,
      arrLon: -73,
      departureTime: new Date("2025-01-01T08:00:00Z"),
      arrivalTime: new Date("2025-01-01T16:00:00Z"),
      createdAt: new Date(),
      currency: "EUR",
    } as Omit<FlightData, "id" | "booking" | "bookingId">;
    const stats = calculateBusinessStats(
      [
        {
          ...base,
          id: "f1",
          bookingId: "b1",
          booking: { id: "b1", ...pkgBooking() },
        } as FlightData,
      ],
      "EUR"
    );
    expect(stats.totalCost ?? null).toBeNull();
    expect(stats.costPerKm).toBeNull();
    expect(stats.packagedFlights).toBe(1);
  });
});

describe("package bookings in the trip cost (forgejo#430)", () => {
  const priced = { price: 7238, currency: "EUR", priceBase: 7238, fxBaseCurrency: "EUR" };
  const input = (rentalBooked: boolean): TripCostInput => ({
    bookings: [{ ...priced, segmentCount: 3 }],
    flights: [
      {
        status: "flown",
        bookingId: "b1",
        booking: priced,
        price: null,
        currency: "EUR",
        priceBase: null,
        fxBaseCurrency: null,
        taxes: null,
        fees: null,
      },
    ],
    cruises: [],
    stays: [
      {
        status: "completed",
        bookingId: "b1",
        booking: priced,
        totalPrice: 900,
        currency: "EUR",
        totalPriceBase: 900,
        fxBaseCurrency: "EUR",
      },
    ],
    rail: [],
    rentals: [
      {
        status: "completed",
        price: 300,
        currency: "EUR",
        priceBase: 300,
        fxBaseCurrency: "EUR",
        finalAmount: null,
        finalCurrency: null,
        finalAmountBase: null,
        finalFxBaseCurrency: null,
        ...(rentalBooked ? { bookingId: "b1", booking: priced } : {}),
      },
    ],
    expenses: [],
  });

  it("counts the package price once across flight, stay and rental — nothing on top", () => {
    const { items, unpricedEntries } = tripCostItems(input(true));
    expect(items.map((i) => [i.source, i.amount])).toEqual([["flight", 7238]]);
    expect(unpricedEntries).toBe(0);
  });

  it("a cancelled rental in the package still costs its cancellation fee", () => {
    const base = input(true);
    const trip: TripCostInput = {
      ...base,
      rentals: [
        {
          ...base.rentals[0],
          status: "cancelled",
          finalAmount: 50,
          finalCurrency: "EUR",
          finalAmountBase: 50,
          finalFxBaseCurrency: "EUR",
        },
      ],
    };
    expect(tripCostItems(trip).items.map((i) => [i.source, i.amount])).toEqual([
      ["flight", 7238],
      ["rental", 50],
    ]);
  });

  it("a rental on no booking still costs its own price", () => {
    const { items } = tripCostItems(input(false));
    expect(items.map((i) => [i.source, i.amount])).toEqual([
      ["flight", 7238],
      ["rental", 300],
    ]);
  });
});

describe("splitting a package price (forgejo#430)", () => {
  const items = [
    { kind: "flight" as const, id: "f1" },
    { kind: "stay" as const, id: "s1" },
    { kind: "rental" as const, id: "r1" },
  ];

  it("equal shares sum to the price to the cent", () => {
    const r = computePackageSplit({ price: 7238, currency: "EUR" }, items, { method: "equal" });
    if (!("split" in r)) throw new Error("refused");
    const sum = r.split.shares.reduce((a, s) => a + Math.round(s.amount * 100), 0);
    expect(sum).toBe(723800);
    expect(r.split.shares.map((s) => s.amount)).toEqual([2412.67, 2412.67, 2412.66]);
    expect(r.split.shares[0]).toMatchObject({ kind: "flight", id: "f1", flightId: "f1" });
  });

  it("manual amounts must add up to the price exactly", () => {
    const body = (a: number) => ({
      method: "manual" as const,
      shares: [
        { kind: "flight" as const, id: "f1", amount: 2000 },
        { kind: "stay" as const, id: "s1", amount: 5000 },
        { kind: "rental" as const, id: "r1", amount: a },
      ],
    });
    expect(computePackageSplit({ price: 7238, currency: "EUR" }, items, body(237.99))).toEqual({
      refusal: "BOOKING_SPLIT_SUM",
    });
    const ok = computePackageSplit({ price: 7238, currency: "EUR" }, items, body(238));
    expect("split" in ok && ok.split.method).toBe("manual");
  });

  it("manual amounts must name every paying item once", () => {
    const r = computePackageSplit({ price: 100, currency: "EUR" }, items, {
      method: "manual",
      shares: [
        { kind: "flight", id: "f1", amount: 50 },
        { kind: "stay", id: "s1", amount: 50 },
      ],
    });
    expect(r).toEqual({ refusal: "BOOKING_SPLIT_ITEMS" });
  });

  it("refuses a booking with no price", () => {
    expect(
      computePackageSplit({ price: null, currency: "EUR" }, items, { method: "equal" })
    ).toEqual({
      refusal: "BOOKING_PRICE_MISSING",
    });
  });

  it("a package split read against its items is current; one item gone makes it stale", () => {
    const r = computePackageSplit({ price: 90, currency: "EUR" }, items, { method: "equal" });
    if (!("split" in r)) throw new Error("refused");
    const booking = { price: 90, currency: "EUR" };
    expect(
      readBookingSplit(r.split, booking, ["flight:f1", "stay:s1", "rental:r1"])?.staleReason
    ).toBeNull();
    expect(readBookingSplit(r.split, booking, ["flight:f1", "stay:s1"])?.staleReason).toBe(
      "segments"
    );
  });
});

describe("own price or package share for lodging and cruise statistics (forgejo#430)", () => {
  const none = { price: null, currency: "EUR", priceBase: null, fxBaseCurrency: null };
  const booking = {
    price: 1000,
    currency: "EUR",
    priceBase: 1000,
    fxBaseCurrency: "EUR",
    _count: { flights: 1, lodgingStays: 1 },
  };

  it("an unsplit package leaves the stay unpriced — null, never 0 or the package price", () => {
    expect(ownOrPackagePrice(none, booking, "stay", "s1").price).toBeNull();
  });

  it("a split package gives the stay its share", () => {
    const split = splitOf(
      [
        ["flight", "f1", 400],
        ["stay", "s1", 600],
      ],
      1000
    );
    expect(ownOrPackagePrice(none, { ...booking, priceSplit: split }, "stay", "s1")).toEqual({
      price: 600,
      currency: "EUR",
      priceBase: 600,
      fxBaseCurrency: "EUR",
    });
  });

  it("the stay's own recorded price wins", () => {
    const own = { price: 80, currency: "EUR", priceBase: 80, fxBaseCurrency: "EUR" };
    expect(ownOrPackagePrice(own, booking, "stay", "s1")).toBe(own);
  });
});
