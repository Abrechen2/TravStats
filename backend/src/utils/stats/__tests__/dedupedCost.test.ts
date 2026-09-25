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
      BASE
    );
    expect(out.base).toBe(500);
    expect(out.unconvertedByCurrency).toEqual({});
  });

  describe("perFlightBaseContribution / perFlightPriced (task-7-brief.md)", () => {
    it("attributes a booking's amount to its FIRST segment only, index-aligned with the input", () => {
      const shared = { bookingId: "b1", booking: booking(500) };
      const out = computeDedupedTotalCost([f({ ...shared }), f({ ...shared })], BASE);
      expect(out.perFlightBaseContribution).toEqual([500, 0]);
      // Both segments of a priced booking are priced, even though only the
      // first carries the amount — this used to be exactly the distinction
      // `pricedFlights`/`unpricedFlights` already drew in aggregate.
      expect(out.perFlightPriced).toEqual([true, true]);
    });

    it("gives 0, not the raw amount, to a row whose currency could not convert", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 300, currency: "USD", priceBase: null, fxBaseCurrency: null })],
        BASE
      );
      expect(out.base).toBeNull();
      expect(out.perFlightBaseContribution).toEqual([0]);
      // Still priced — the amount exists, it simply never reached `base`.
      expect(out.perFlightPriced).toEqual([true]);
    });

    it("sums per-row to the same total the aggregate reports", () => {
      const rows = [f({ price: 100, taxes: 20 }), f({ price: 50 }), f({ price: null })];
      const out = computeDedupedTotalCost(rows, BASE);
      const total = out.perFlightBaseContribution.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(out.base);
      expect(out.perFlightPriced).toEqual([true, true, false]);
    });
  });

  it("falls back to price + taxes + fees without a priced booking", () => {
    expect(computeDedupedTotalCost([f({ price: 100, taxes: 20, fees: 5 })], BASE).base).toBe(125);
  });

  // SRV-STATS-ZERO-PRICE-001: this used to read `if (booking.price)`, so a
  // booking someone recorded as free fell back to the segment's own column
  // and reported 80 for a booking whose stated price was 0. Only an ABSENT
  // booking amount is a reason to fall back.
  it("keeps a booking recorded at 0 instead of falling back to the segment's own price", () => {
    expect(
      computeDedupedTotalCost([f({ bookingId: "b2", booking: booking(0), price: 80 })], BASE).base
    ).toBe(0);
  });

  it("falls back per flight when the booking carries no amount at all", () => {
    expect(
      computeDedupedTotalCost(
        [f({ bookingId: "b3", booking: { ...booking(0), price: null }, price: 60 })],
        BASE
      ).base
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
      "EUR"
    );
    expect(out.base).toBeNull();
    expect(out.pricedFlights).toBe(0);
    expect(out.unpricedFlights).toBe(2);
  });

  // SRV-STATS-ZERO-PRICE-001 (audit 2026-09-20). A single flight saved at
  // 0 EUR answered `totalCost: null` / `unpricedFlights: 1`, so the overview
  // said "Kein Preis erfasst" about a price the user had typed in.
  describe("a price of 0 is a measurement, not a missing value", () => {
    it("reports 0, not null, for a year whose only flight was recorded as free", () => {
      const out = computeDedupedTotalCost([f({ price: 0 })], BASE);
      expect(out.base).toBe(0);
      expect(out.pricedFlights).toBe(1);
      expect(out.unpricedFlights).toBe(0);
    });

    it("counts one unpriced flight in the audit's mixed year, not four", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 0 }), f({ price: 0 }), f({ price: 0 }), f({ price: 123.45 }), f({})],
        BASE
      );
      expect(out.base).toBe(123.45);
      expect(out.pricedFlights).toBe(4);
      expect(out.unpricedFlights).toBe(1);
    });

    it("does not park a recorded 0 in the unconvertible bucket for want of a rate", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 0, currency: "USD", priceBase: null, fxBaseCurrency: null })],
        BASE
      );
      expect(out.base).toBe(0);
      expect(out.unconvertedByCurrency).toEqual({});
    });

    it("still abstains when the only amounts are foreign and unconvertible", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 300, currency: "USD", priceBase: null, fxBaseCurrency: null })],
        BASE
      );
      expect(out.base).toBeNull();
    });

    // A later segment of an already-counted booking contributes nothing. It
    // must not be mistaken for a recorded zero, or an all-unconvertible
    // logbook would report a total of 0 instead of abstaining.
    it("keeps a second segment of an unconvertible booking out of the total", () => {
      const shared = {
        bookingId: "b9",
        booking: { price: 500, currency: "USD", priceBase: null, fxBaseCurrency: null },
      };
      const out = computeDedupedTotalCost([f(shared), f(shared)], BASE);
      expect(out.base).toBeNull();
      expect(out.unconvertedByCurrency).toEqual({ USD: 500 });
    });
  });

  it("counts every segment of a priced booking as priced, and adds its amount once", () => {
    const out = computeDedupedTotalCost(
      [
        f({ price: null, bookingId: "b1", booking: booking(500) }),
        f({ price: null, bookingId: "b1", booking: booking(500) }),
        f({ price: null }),
      ],
      "EUR"
    );
    expect(out.base).toBe(500);
    expect(out.pricedFlights).toBe(2);
    expect(out.unpricedFlights).toBe(1);
  });

  it("returns null for empty input and rounds a real total to cents", () => {
    expect(computeDedupedTotalCost([], BASE).base).toBeNull();
    expect(computeDedupedTotalCost([f({ price: 0.105 }), f({ price: 0.105 })], BASE).base).toBe(
      0.21
    );
  });

  // #267 — the defect itself.
  describe("currencies", () => {
    it("never adds a foreign amount into the base total", () => {
      const out = computeDedupedTotalCost(
        [
          f({ price: 300 }),
          f({ price: 300, currency: "USD", priceBase: null, fxBaseCurrency: null }),
        ],
        BASE
      );
      expect(out.base).toBe(300);
      expect(out.unconvertedByCurrency).toEqual({ USD: 300 });
    });

    it("uses the snapshot, not the raw amount, for a converted foreign price", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 300, currency: "USD", priceBase: 276.5, fxBaseCurrency: BASE })],
        BASE
      );
      expect(out.base).toBe(276.5);
      expect(out.unconvertedByCurrency).toEqual({});
    });

    // A user who changes base currency has snapshots in the old one. Summing
    // those is the same lie wearing a different symbol.
    it("ignores a snapshot taken against a different base currency", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 300, currency: "USD", priceBase: 276.5, fxBaseCurrency: "CHF" })],
        BASE
      );
      expect(out.base).toBeNull();
      expect(out.unconvertedByCurrency).toEqual({ USD: 300 });
    });

    // Never assumed to be the base currency: that assumption is how 11,662 AED
    // became €11,662 once already.
    it("buckets an amount with no recorded currency as unknown", () => {
      const out = computeDedupedTotalCost(
        [f({ price: 120, currency: null, priceBase: null, fxBaseCurrency: null })],
        BASE
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
        BASE
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
