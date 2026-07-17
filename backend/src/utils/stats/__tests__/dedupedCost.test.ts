import { computeDedupedTotalCost, type CostFlight } from "../dedupedCost";

function f(over: Partial<CostFlight>): CostFlight {
  return { price: null, taxes: null, fees: null, bookingId: null, booking: null, ...over };
}

describe("computeDedupedTotalCost", () => {
  it("counts a booking price once across its segments (all-in: taxes/fees ignored)", () => {
    const shared = { bookingId: "b1", booking: { price: 500 } };
    expect(
      computeDedupedTotalCost([
        f({ ...shared, taxes: 50 }),
        f({ ...shared, fees: 20 }),
      ])
    ).toBe(500);
  });

  it("falls back to price + taxes + fees without a priced booking", () => {
    expect(computeDedupedTotalCost([f({ price: 100, taxes: 20, fees: 5 })])).toBe(125);
  });

  it("booking with null/zero price falls back per flight (truthiness semantics)", () => {
    expect(
      computeDedupedTotalCost([f({ bookingId: "b2", booking: { price: 0 }, price: 80 })])
    ).toBe(80);
    expect(
      computeDedupedTotalCost([f({ bookingId: "b3", booking: { price: null }, price: 60 })])
    ).toBe(60);
  });

  it("mixes booking-priced and fallback flights", () => {
    const shared = { bookingId: "b4", booking: { price: 300 } };
    expect(
      computeDedupedTotalCost([f(shared), f(shared), f({ price: 100 })])
    ).toBe(400);
  });

  it("returns 0 for empty input and rounds to cents", () => {
    expect(computeDedupedTotalCost([])).toBe(0);
    expect(computeDedupedTotalCost([f({ price: 0.105 }), f({ price: 0.105 })])).toBe(0.21);
  });
});
