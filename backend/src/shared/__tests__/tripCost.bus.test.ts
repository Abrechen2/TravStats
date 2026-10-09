import { tripCostItems, tripSpend, type StoredPrice, type TripCostInput } from "../tripCost";

/**
 * forgejo#263 — a bus ride costs on its trip by the train-ride rule: its own
 * price, or its booking's once and all-in, never both; a cancelled ride
 * costs nothing; an unpriced one is counted as such.
 */
const none: StoredPrice = { price: null, currency: null, priceBase: null, fxBaseCurrency: null };
const eur = (price: number | null): StoredPrice => ({
  price,
  currency: "EUR",
  priceBase: null,
  fxBaseCurrency: null,
});
const segment = (o: Record<string, unknown> = {}) => ({
  status: "completed",
  ...none,
  bookingId: null,
  booking: null,
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

describe("bus rides on a trip's bill", () => {
  it("adds a ride's own price, and counts an unpriced ride as unpriced, never 0", () => {
    expect(spend(trip({ bus: [segment(eur(29.99)), segment()] }))).toEqual({
      spendByCurrency: { EUR: 29.99 },
      spendBaseByCurrency: {},
      unpricedEntries: 1,
    });
  });

  it("bills a booking that sold a train and a coach once, all-in", () => {
    const booking = eur(80);
    const input = trip({
      rail: [segment({ ...eur(50), bookingId: "b1", booking })],
      bus: [segment({ ...eur(40), bookingId: "b1", booking })],
    });
    expect(spend(input).spendByCurrency).toEqual({ EUR: 80 });
  });

  it("charges nothing for a cancelled ride", () => {
    expect(spend(trip({ bus: [segment({ ...eur(30), status: "cancelled" })] }))).toEqual({
      spendByCurrency: {},
      spendBaseByCurrency: {},
      unpricedEntries: 0,
    });
  });

  it("is unchanged for a caller that never names bus", () => {
    expect(spend(trip({ rail: [segment(eur(10))] })).spendByCurrency).toEqual({ EUR: 10 });
  });
});
