import { computeDedupedTotalCost, type CostFlight } from "../dedupedCost";

const BASE = "EUR";

/** A flight whose cost carries a valid EUR snapshot equal to its own amount. */
function f(over: Partial<CostFlight>): CostFlight {
  const own = (over.price ?? 0) + (over.taxes ?? 0) + (over.fees ?? 0);
  return {
    price: null,
    taxes: null,
    fees: null,
    currency: BASE,
    priceBase: own,
    fxBaseCurrency: BASE,
    bookingId: null,
    booking: null,
    ...over,
  };
}

/** A priced booking whose snapshot is in the base currency. */
function booking(price: number, over: Partial<NonNullable<CostFlight["booking"]>> = {}) {
  return { price, currency: BASE, priceBase: price, fxBaseCurrency: BASE, ...over };
}

describe("computeDedupedTotalCost", () => {
  it("counts a booking price once across its segments (all-in: taxes/fees ignored)", () => {
    const shared = { bookingId: "b1", booking: booking(500) };
    const out = computeDedupedTotalCost(
      [f({ ...shared, taxes: 50 }), f({ ...shared, fees: 20 })],
      BASE,
    );
    expect(out.base).toBe(500);
    expect(out.unconvertedByCurrency).toEqual({});
  });

  it("falls back to price + taxes + fees without a priced booking", () => {
    expect(computeDedupedTotalCost([f({ price: 100, taxes: 20, fees: 5 })], BASE).base).toBe(125);
  });

  it("booking with null/zero price falls back per flight (truthiness semantics)", () => {
    expect(
      computeDedupedTotalCost(
        [f({ bookingId: "b2", booking: booking(0), price: 80 })],
        BASE,
      ).base,
    ).toBe(80);
    expect(
      computeDedupedTotalCost(
        [f({ bookingId: "b3", booking: { ...booking(0), price: null }, price: 60 })],
        BASE,
      ).base,
    ).toBe(60);
  });

  it("mixes booking-priced and fallback flights", () => {
    const shared = { bookingId: "b4", booking: booking(300) };
    expect(computeDedupedTotalCost([f(shared), f(shared), f({ price: 100 })], BASE).base).toBe(400);
  });

  // forgejo#83: a year with no priced flight read "Gesamtkosten 0 €" — a
  // claim that the flights were free. Nothing recorded is null.
  it("abstains with null when no flight carries a price — a zero would read as a free year", () => {
    const out = computeDedupedTotalCost(
      [f({ price: null, taxes: null, fees: null }), f({ price: null })],
      "EUR",
    );
    expect(out.base).toBeNull();
    expect(out.pricedFlights).toBe(0);
    expect(out.unpricedFlights).toBe(2);
  });

  it("counts every segment of a priced booking as priced, and adds its amount once", () => {
    const out = computeDedupedTotalCost(
      [
        f({ price: null, bookingId: "b1", booking: booking(500) }),
        f({ price: null, bookingId: "b1", booking: booking(500) }),
        f({ price: null }),
      ],
      "EUR",
    );
    expect(out.base).toBe(500);
    expect(out.pricedFlights).toBe(2);
    expect(out.unpricedFlights).toBe(1);
  });

  it("returns null for empty input and rounds a real total to cents", () => {
    expect(computeDedupedTotalCost([], BASE).base).toBeNull();
    expect(computeDedupedTotalCost([f({ price: 0.105 }), f({ price: 0.105 })], BASE).base).toBe(0.21);
  });

  // #267 — the defect itself.
  describe("currencies", () => {
    it("never adds a foreign amount into the base total", () => {
      const out = computeDedupedTotalCost(
        [
          f({ price: 300 }),
          f({ price: 300, currency: "USD", priceBase: null, fxBaseCurrency: null }),
        ],
        BASE,
      );
      expect(out.base).toBe(300);
      expect(out.unconvertedByCurrency).toEqual({ USD: 300 });
    });

    it("uses the snapshot, not the raw amount, for a converted foreign price", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 300, currency: "USD", priceBase: 276.5, fxBaseCurrency: BASE })],
        BASE,
      );
      expect(out.base).toBe(276.5);
      expect(out.unconvertedByCurrency).toEqual({});
    });

    // A user who changes base currency has snapshots in the old one. Summing
    // those is the same lie wearing a different symbol.
    it("ignores a snapshot taken against a different base currency", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 300, currency: "USD", priceBase: 276.5, fxBaseCurrency: "CHF" })],
        BASE,
      );
      expect(out.base).toBeNull();
      expect(out.unconvertedByCurrency).toEqual({ USD: 300 });
    });

    // Never assumed to be the base currency: that assumption is how 11,662 AED
    // became €11,662 once already.
    it("buckets an amount with no recorded currency as unknown", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 120, currency: null, priceBase: null, fxBaseCurrency: null })],
        BASE,
      );
      expect(out.base).toBeNull();
      expect(out.unconvertedByCurrency).toEqual({ unknown: 120 });
    });

    // Every row written before #267 has a null snapshot. Without this rule the
    // arrival of FX would have silently emptied the cost total of every
    // existing logbook until a backfill ran.
    it("counts an amount already in the base currency without any snapshot", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 250, currency: BASE, priceBase: null, fxBaseCurrency: null })],
        BASE,
      );
      expect(out.base).toBe(250);
      expect(out.unconvertedByCurrency).toEqual({});
    });

    it("keeps an unconvertible booking price out of the total too", () => {
      const shared = {
        bookingId: "b9",
        booking: { price: 900, currency: "GBP", priceBase: null, fxBaseCurrency: null },
      };
      const out = computeDedupedTotalCost([f(shared), f(shared)], BASE);
      expect(out.base).toBeNull();
      expect(out.unconvertedByCurrency).toEqual({ GBP: 900 });
    });
  });
});
