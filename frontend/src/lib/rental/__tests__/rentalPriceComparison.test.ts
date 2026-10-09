import { describe, expect, it } from "vitest";
import { rentalPriceComparison } from "../rentalPriceComparison";
import { makeRental } from "../../../components/rental/__tests__/rentalFixture";

describe("rentalPriceComparison (forgejo#237)", () => {
  it("puts booked and final side by side with their difference, counting the final once", () => {
    const c = rentalPriceComparison(
      makeRental({
        price: 120,
        currency: "EUR",
        priceSource: "booking",
        finalAmount: 150.5,
        finalCurrency: "EUR",
        finalAmountSource: "invoice",
        cost: { amount: 150.5, currency: "EUR", source: "final" },
      })
    );
    expect(c.booked).toEqual({ amount: 120, currency: "EUR", source: "booking" });
    expect(c.final?.source).toBe("invoice");
    expect(c.difference).toEqual({ amount: 30.5, currency: "EUR" });
    expect(c.counts).toBe("final");
  });

  it("computes no difference across two currencies and converts nothing", () => {
    const c = rentalPriceComparison(
      makeRental({ price: 120, currency: "EUR", finalAmount: 140, finalCurrency: "USD" })
    );
    expect(c.difference).toBeNull();
    expect(c.noDifference).toBe("currency");
  });

  it("waits for both amounts", () => {
    const c = rentalPriceComparison(makeRental({ price: 120, currency: "EUR" }));
    expect(c.final).toBeNull();
    expect(c.noDifference).toBe("missing");
  });
});
