/**
 * forgejo#249: the price help sat INSIDE the price label, so its button was
 * read into the field's name — "Preis Hilfe anzeigen". The other CostFields
 * tests stub the help away, which is why none of them could see it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CostFields from "../CostFields";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../../ReceiptUpload", () => ({ default: () => null }));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

describe("CostFields price help", () => {
  it("leaves the price field named by its label alone, and opens the help on a tap", async () => {
    render(
      <CostFields
        value={{ price: 10, currency: "EUR", taxes: undefined, fees: undefined, receiptUrl: "" }}
        onChange={() => {}}
        showBreakdown={false}
        priceHelp={{ content: "Gesamtpreis inklusive Steuern" }}
      />
    );
    expect(screen.getByRole("spinbutton", { name: "flights:form.price" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "help.about" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Gesamtpreis inklusive Steuern");
  });
});
