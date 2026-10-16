import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TravelComparison, { type TravelPerson } from "../TravelComparison";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

const person = (flights: unknown[]): TravelPerson =>
  ({
    id: "p",
    label: "Pat",
    data: {
      version: 2,
      asOf: "2026-01-01T00:00:00.000Z",
      scope: { year: null },
      snapshot: {},
      sections: { flights },
      assets: [],
      omitted: [],
    },
  }) as unknown as TravelPerson;

function cell(flights: unknown[], field: string, operation: string) {
  render(<TravelComparison people={[person(flights)]} />);
  fireEvent.change(screen.getByLabelText("e2e.field"), { target: { value: field } });
  fireEvent.change(screen.getByLabelText("e2e.operation"), { target: { value: operation } });
  const row = screen.getByRole("row", { name: /Pat/ });
  return within(row).getAllByRole("cell")[1].textContent;
}

describe("money cells in the all-travel comparison", () => {
  it("labels a base-currency amount with the base currency, not the booking currency", () => {
    // priceBase is converted into fxBaseCurrency; the cell printed the ticket's own currency.
    expect(
      cell(
        [
          { price: 100, currency: "USD", priceBase: 92, fxBaseCurrency: "EUR" },
          { price: 50, currency: "USD", priceBase: 46, fxBaseCurrency: "EUR" },
        ],
        "priceBase",
        "sum"
      )
    ).toBe("138 EUR");
  });
  it("refuses to add taxes or fees across currencies", () => {
    // The mixed-currency guard matched price|amount|cost only, so 10 EUR + 5 USD of taxes was 15.
    expect(
      cell(
        [
          { taxes: 10, fees: 2, currency: "EUR" },
          { taxes: 5, fees: 1, currency: "USD" },
        ],
        "taxes",
        "sum"
      )
    ).toBe("e2e.mixedCurrencies");
  });
});
