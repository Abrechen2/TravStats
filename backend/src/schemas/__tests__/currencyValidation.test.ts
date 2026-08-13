import { baseCurrencyField } from "../../routes/settings/general";
import { currencyField } from "../lodging";

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
