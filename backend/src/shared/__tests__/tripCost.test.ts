import {
  tripBaseTotal,
  tripCostItems,
  tripSpend,
  type StoredPrice,
  type TripCostInput,
} from "../tripCost";

/**
 * The server's one trip-cost rule (forgejo#274). Each case is a way the travel
 * account and the "most expensive trip" superlative used to disagree, or a
 * way a shared rule could quietly lose an amount.
 */

const none: StoredPrice = { price: null, currency: null, priceBase: null, fxBaseCurrency: null };
const eur = (price: number | null, priceBase: number | null = null): StoredPrice => ({
  price,
  currency: "EUR",
  priceBase,
  fxBaseCurrency: priceBase === null ? null : "EUR",
});

const flight = (o: Partial<TripCostInput["flights"][number]> = {}) => ({
  status: "flown",
  ...none,
  taxes: null,
  fees: null,
  bookingId: null,
  booking: null,
  ...o,
});
const cruise = (o: Partial<TripCostInput["cruises"][number]> = {}) => ({
  status: "completed",
  ...none,
  bookingId: null,
  booking: null,
  ...o,
});
const stay = (o: Partial<TripCostInput["stays"][number]> = {}) => ({
  status: "completed",
  totalPrice: null,
  currency: "EUR",
  totalPriceBase: null,
  fxBaseCurrency: null,
  bookingId: null,
  booking: null,
  ...o,
});

const ride = (o: Partial<TripCostInput["rail"][number]> = {}) => ({
  status: "completed",
  ...none,
  bookingId: null,
  booking: null,
  ...o,
});
const rental = (o: Partial<TripCostInput["rentals"][number]> = {}) => ({
  status: "completed",
  ...none,
  finalAmount: null,
  finalCurrency: null,
  finalAmountBase: null,
  finalFxBaseCurrency: null,
  ...o,
});

const trip = (o: Partial<TripCostInput> = {}): TripCostInput => ({
  bookings: [],
  flights: [],
  cruises: [],
  stays: [],
  rail: [],
  rentals: [],
  expenses: [],
  ...o,
});

const spend = (input: TripCostInput) => tripSpend(tripCostItems(input));

describe("tripCostItems — what an entry on a trip costs", () => {
  it("prices a flight as price + taxes + fees (counter-example 1: 130, not 100)", () => {
    const input = trip({ flights: [flight({ ...eur(100), taxes: 20, fees: 10 })] });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 130 });
  });

  it("falls back to the flight's own cost when its booking has no price (counter-example 2)", () => {
    const input = trip({
      flights: [flight({ ...eur(100), taxes: 20, fees: 10, bookingId: "b1", booking: eur(null) })],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: { EUR: 130 },
      spendBaseByCurrency: {},
      unpricedEntries: 0,
    });
  });

  it("counts a booking once and all-in, however many segments share it", () => {
    const booking = eur(300, 300);
    const input = trip({
      flights: [
        // Own columns beside a priced booking are not added on top.
        flight({ ...eur(80), taxes: 20, bookingId: "b1", booking }),
        flight({ bookingId: "b1", booking }),
      ],
    });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 300 });
    expect(spend(input).spendBaseByCurrency).toEqual({ EUR: 300 });
  });

  it("counts one booking once across domains — a flight and a cruise sold together", () => {
    const booking = eur(2000);
    const input = trip({
      flights: [flight({ bookingId: "pkg", booking })],
      cruises: [cruise({ bookingId: "pkg", booking })],
    });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 2000 });
  });

  it("keeps a booking recorded at 0 free: its segments do not fall back to their own prices", () => {
    const input = trip({
      flights: [flight({ ...eur(500), bookingId: "award", booking: eur(0) })],
      stays: [stay({ totalPrice: 90, bookingId: "award", booking: eur(0) })],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: { EUR: 0 },
      spendBaseByCurrency: {},
      unpricedEntries: 0,
    });
  });

  it("reports an entry with no price as unpriced, never as 0", () => {
    const input = trip({
      flights: [flight(), flight({ ...eur(50) })],
      cruises: [cruise()],
      stays: [stay()],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: { EUR: 50 },
      spendBaseByCurrency: {},
      unpricedEntries: 3,
    });
  });

  it("leaves cancelled entries out entirely — their money and their missing price", () => {
    const input = trip({
      flights: [flight({ status: "cancelled", ...eur(100) }), flight({ status: "cancelled" })],
      cruises: [cruise({ status: "cancelled", ...eur(900) })],
      stays: [stay({ status: "cancelled", totalPrice: 300 })],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: {},
      spendBaseByCurrency: {},
      unpricedEntries: 0,
    });
  });

  it("reads a segment-less booking attached to the trip, and only a segment-less one", () => {
    const input = trip({
      bookings: [
        { ...eur(400), segmentCount: 0 },
        // Its segments live elsewhere: it costs on THEIR trips, not here too.
        { ...eur(999), segmentCount: 2 },
      ],
    });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 400 });
  });

  it("adds trip expenses as their own items, with no snapshot", () => {
    const input = trip({
      stays: [stay({ totalPrice: 300, totalPriceBase: 300, fxBaseCurrency: "EUR" })],
      expenses: [
        { amount: 1290, currency: "NOK" },
        { amount: 12.5, currency: "EUR" },
      ],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: { EUR: 312.5, NOK: 1290 },
      spendBaseByCurrency: { EUR: 300 },
      unpricedEntries: 0,
    });
  });

  it("never assumes a currency: an amount without one is not spend, it is unpriced", () => {
    const input = trip({ flights: [flight({ price: 70, currency: null })] });
    expect(spend(input)).toEqual({
      spendByCurrency: {},
      spendBaseByCurrency: {},
      unpricedEntries: 1,
    });
  });
});

describe("tripCostItems — train rides and rentals (forgejo#275)", () => {
  it("prices a pure rail trip by its rides' own prices", () => {
    const input = trip({ rail: [ride({ ...eur(89.9) }), ride({ ...eur(29.9) })] });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 119.8 });
  });

  it("counts a connection sold on one booking once, not once per train", () => {
    const booking = eur(149, 149);
    const input = trip({
      rail: [
        ride({ bookingId: "con", booking }),
        ride({ bookingId: "con", booking }),
        ride({ bookingId: "con", booking }),
      ],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: { EUR: 149 },
      spendBaseByCurrency: { EUR: 149 },
      unpricedEntries: 0,
    });
  });

  it("prices a rental by its invoice when there is one, else by the booked price (D10 b)", () => {
    const invoiced = rental({
      ...eur(300, 300),
      finalAmount: 342.5,
      finalCurrency: "EUR",
      finalAmountBase: 342.5,
      finalFxBaseCurrency: "EUR",
    });
    expect(spend(trip({ rentals: [invoiced] }))).toEqual({
      spendByCurrency: { EUR: 342.5 },
      spendBaseByCurrency: { EUR: 342.5 },
      unpricedEntries: 0,
    });
    expect(spend(trip({ rentals: [rental({ ...eur(300, 300) })] })).spendByCurrency).toEqual({
      EUR: 300,
    });
  });

  it("takes the snapshot of the amount it chose, not the booked one", () => {
    const usd = rental({
      price: 400,
      currency: "USD",
      priceBase: 360,
      fxBaseCurrency: "EUR",
      finalAmount: 455,
      finalCurrency: "USD",
      finalAmountBase: 410,
      finalFxBaseCurrency: "EUR",
    });
    const { items } = tripCostItems(trip({ rentals: [usd] }));
    expect(tripBaseTotal(items, "EUR")).toEqual({ kind: "total", amount: 410 });
  });

  it("never sums a deposit, whatever a row may carry beside its price", () => {
    // `feat/ux-rental` adds deposit columns; this rule reads named amounts only.
    const withDeposit = { ...rental({ ...eur(300) }), depositAmount: 1000, depositCurrency: "EUR" };
    expect(spend(trip({ rentals: [withDeposit] })).spendByCurrency).toEqual({ EUR: 300 });
  });

  it("counts a cancelled rental's fee and nothing else; a cancelled ride not at all", () => {
    const input = trip({
      rentals: [
        rental({ status: "cancelled", ...eur(500), finalAmount: 45, finalCurrency: "EUR" }),
        rental({ status: "cancelled", ...eur(500) }),
      ],
      rail: [ride({ status: "cancelled", ...eur(120) }), ride({ status: "cancelled" })],
    });
    expect(spend(input)).toEqual({
      spendByCurrency: { EUR: 45 },
      spendBaseByCurrency: {},
      unpricedEntries: 0,
    });
  });

  it("reports a ride or rental with no price as unpriced", () => {
    const input = trip({ rail: [ride()], rentals: [rental()] });
    expect(spend(input)).toEqual({
      spendByCurrency: {},
      spendBaseByCurrency: {},
      unpricedEntries: 2,
    });
  });

  it("adds a mixed trip once per source: flight booking shared with a train, a rental, fuel", () => {
    const railAndFly = eur(250);
    const input = trip({
      flights: [flight({ bookingId: "rail-and-fly", booking: railAndFly })],
      rail: [ride({ bookingId: "rail-and-fly", booking: railAndFly })],
      rentals: [rental({ price: 210, currency: "CHF" })],
      expenses: [{ amount: 60, currency: "CHF" }],
    });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 250, CHF: 270 });
  });
});

describe("tripBaseTotal — one figure, only from stored snapshots", () => {
  const items = (input: TripCostInput) => tripCostItems(input).items;

  it("ranks counter-example 3 right: 130 incl. fees beats 120", () => {
    const a = items(trip({ flights: [flight({ ...eur(100), taxes: 20, fees: 10 })] }));
    const b = items(trip({ flights: [flight({ ...eur(120) })] }));
    expect(tripBaseTotal(a, "EUR")).toEqual({ kind: "total", amount: 130 });
    expect(tripBaseTotal(b, "EUR")).toEqual({ kind: "total", amount: 120 });
  });

  it("converts through a snapshot in the CURRENT base currency only", () => {
    const fresh = items(
      trip({
        cruises: [
          cruise({ price: 200000, currency: "KRW", priceBase: 130, fxBaseCurrency: "EUR" }),
        ],
      })
    );
    expect(tripBaseTotal(fresh, "EUR")).toEqual({ kind: "total", amount: 130 });
    expect(tripBaseTotal(fresh, "USD")).toEqual({ kind: "unconvertible" });
  });

  it("refuses a partial sum: one unconvertible item takes the trip out", () => {
    const mixed = items(
      trip({
        flights: [flight({ ...eur(100) })],
        expenses: [{ amount: 500, currency: "NOK" }],
      })
    );
    expect(tripBaseTotal(mixed, "EUR")).toEqual({ kind: "unconvertible" });
  });

  it("needs no rate for a 0, and answers none when nothing was recorded", () => {
    const free = items(trip({ cruises: [cruise({ price: 0, currency: "JPY" })] }));
    expect(tripBaseTotal(free, "EUR")).toEqual({ kind: "total", amount: 0 });
    expect(tripBaseTotal(items(trip({ flights: [flight()] })), "EUR")).toEqual({ kind: "none" });
  });

  it("does not read a missing currency as the base currency", () => {
    const unitless = items(trip({ flights: [flight({ price: 70, currency: null })] }));
    expect(tripBaseTotal(unitless, "EUR")).toEqual({ kind: "unconvertible" });
  });
});
