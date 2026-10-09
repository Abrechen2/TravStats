import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { RentalPriceComparison } from "../RentalPriceComparison";
import { makeRental } from "./rentalFixture";

// forgejo#237: booked, final and difference side by side, each with its origin.
describe("RentalPriceComparison", () => {
  it("shows the three amounts with their origins and which one counts", () => {
    render(
      <RentalPriceComparison
        rental={makeRental({
          price: 120,
          currency: "EUR",
          priceSource: "booking",
          finalAmount: 150,
          finalCurrency: "EUR",
          finalAmountSource: "invoice",
          cost: { amount: 150, currency: "EUR", source: "final" },
        })}
      />
    );
    expect(screen.getByTestId("rental-price-booked").textContent).toContain(
      "rental:priceSource.booking"
    );
    expect(screen.getByTestId("rental-price-final").textContent).toContain(
      "rental:finalSource.invoice"
    );
    expect(screen.getByTestId("rental-price-difference").textContent).toMatch(/\+30/);
    expect(screen.getByTestId("rental-price-counts").textContent).toBe(
      "rental:detail.costCounts.final"
    );
  });

  it("says why there is no difference across currencies", () => {
    render(
      <RentalPriceComparison
        rental={makeRental({ price: 120, currency: "EUR", finalAmount: 150, finalCurrency: "USD" })}
      />
    );
    expect(screen.getByTestId("rental-price-difference").textContent).toContain(
      "rental:detail.differenceCurrencies"
    );
  });
});
