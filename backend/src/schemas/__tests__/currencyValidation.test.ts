import { baseCurrencyField } from "../../routes/settings/general";
import { createStaySchema, currencyField, updateStaySchema } from "../lodging";

describe("currency validation at the boundary", () => {
  it("accepts any real ISO code, not just the old four", () => {
    for (const code of ["EUR", "NOK", "SGD", "AUD", "EGP", "AED"]) {
      expect(currencyField.parse(code)).toBe(code);
    }
  });

  it("still rejects what is not a currency", () => {
    for (const junk of ["EURO", "CH", "eur", ""]) {
      expect(() => currencyField.parse(junk)).toThrow();
    }
  });

  it("keeps the FX base currency to the ECB set, because everything converts INTO it", () => {
    expect(baseCurrencyField.parse("NOK")).toBe("NOK");
    expect(() => baseCurrencyField.parse("EGP")).toThrow();
  });
});

describe("a price needs its unit at the write boundary", () => {
  const stay = { checkIn: "2026-03-04T00:00:00.000Z", checkOut: "2026-03-08T00:00:00.000Z" };

  it("refuses a total price with no currency", () => {
    expect(() => createStaySchema.parse({ ...stay, totalPrice: 11662 })).toThrow();
  });

  it("refuses a per-night price with no currency — the total is derived from it", () => {
    expect(() => createStaySchema.parse({ ...stay, pricePerNight: 100 })).toThrow();
  });

  it("accepts the same stay once the currency is there", () => {
    const parsed = createStaySchema.parse({ ...stay, totalPrice: 11662, currency: "AED" });
    expect(parsed.currency).toBe("AED");
  });

  it("still accepts a stay carrying no price at all", () => {
    expect(() => createStaySchema.parse({ ...stay })).not.toThrow();
  });

  it("leaves a PATCH alone, because the stored row always has a currency", () => {
    // The column is NOT NULL, and a PATCH cannot clear it — so a price-only
    // update is not a unitless amount and must keep working.
    expect(() => updateStaySchema.parse({ totalPrice: 200 })).not.toThrow();
  });
});
