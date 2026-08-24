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
  it("says package when the price lives on the booking", () => {
    expect(priceCellState({ price: null, bookingId: "b1" })).toBe("package");
    expect(priceCellState({ price: 0, bookingId: "b1" })).toBe("package");
  });

  it("says unknown only when there is neither a price nor a booking", () => {
    expect(priceCellState({ price: null, bookingId: null })).toBe("unknown");
    expect(priceCellState({})).toBe("unknown");
  });
});
