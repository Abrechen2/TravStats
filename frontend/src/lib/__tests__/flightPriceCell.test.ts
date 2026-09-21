import { describe, expect, it } from "vitest";
import { priceCellState } from "../flightPriceCell";

/** The rule the flight table's price column applies. */
describe("priceCellState", () => {
  it("shows the amount when the flight carries its own price", () => {
    expect(priceCellState({ price: 249.9, bookingId: null })).toBe("amount");
  });

  it("prefers the flight's own price over the booking", () => {
    expect(priceCellState({ price: 249.9, bookingId: "b1" })).toBe("amount");
  });

  // The defect: these rendered "k.A.", which claims the price is unknown.
  it("says package when the row carries no price of its own", () => {
    expect(priceCellState({ price: null, bookingId: "b1" })).toBe("package");
  });

  // SRV-STATS-ZERO-PRICE-001 / SRV-UI-001: `if (flight.price)` sent a stored
  // 0 to the fall-through, so the table said "k.A." about a row the detail
  // page rendered as "0 €". A recorded 0 is the row's own figure, and the
  // stated precedence — own price beats booking — applies to it like any
  // other number.
  it("shows a price explicitly recorded as 0 rather than calling it unknown", () => {
    expect(priceCellState({ price: 0, bookingId: null })).toBe("amount");
    expect(priceCellState({ price: 0, bookingId: "b1" })).toBe("amount");
  });

  it("says unknown only when there is neither a price nor a booking", () => {
    expect(priceCellState({ price: null, bookingId: null })).toBe("unknown");
    expect(priceCellState({})).toBe("unknown");
  });
});
