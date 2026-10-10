import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StayNightPriceLine } from "../StayNightPriceLine";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const stay = (totalPrice: number | null, pricePerNight: number | null) => ({
  id: "s1",
  totalPrice,
  pricePerNight,
  currency: "EUR" as const,
});

/** forgejo#178: the invoice of the report — 3 × 120 € + 30 € + 12 € = 402 €. */
describe("StayNightPriceLine", () => {
  it("names the room rate and shows how the average is made", () => {
    render(<StayNightPriceLine stay={stay(402, 120)} nights={3} />);
    const line = screen.getByTestId("stay-night-price-s1").textContent ?? "";
    expect(line).toMatch(/Zimmer pro Nacht: 120\s€/);
    expect(line).toMatch(/Ø pro Nacht gesamt: 134\s€ \(402\s€ ÷ 3 Nächte = 134\s€\)/);
    expect(line).toMatch(/davon 42\s€ über den Zimmerpreis hinaus/);
    expect(line).toContain("nicht pro Person");
  });

  it("shows no average when the number of nights is unknown", () => {
    render(<StayNightPriceLine stay={stay(402, 120)} nights={null} />);
    const line = screen.getByTestId("stay-night-price-s1").textContent ?? "";
    expect(line).toMatch(/Zimmer pro Nacht/);
    expect(line).not.toMatch(/Ø pro Nacht/);
  });

  it("renders nothing without a room rate and with nothing to divide", () => {
    const { container } = render(<StayNightPriceLine stay={stay(90, null)} nights={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
