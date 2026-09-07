import { describe, it, expect } from "vitest";
import { COUNTRY_CURRENCY_TABLE, currencyForCountry } from "../countryCurrency";
import { ISO_4217 } from "../currencies";

describe("currencyForCountry", () => {
  // The table is only useful if every value round-trips through the currency
  // field the backend validates against — a typo here would reach the editor
  // as a currency the save then rejects.
  it("maps every country to a currency the API accepts", () => {
    const unknown = Object.entries(COUNTRY_CURRENCY_TABLE)
      .filter(([, currency]) => !(currency in ISO_4217))
      .map(([country, currency]) => `${country} -> ${currency}`);
    expect(unknown).toEqual([]);
  });

  it("answers for the countries the reporter named", () => {
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry("JP")).toBe("JPY");
  });

  it("accepts a lower-case or padded code", () => {
    expect(currencyForCountry("us")).toBe("USD");
    expect(currencyForCountry(" ch ")).toBe("CHF");
  });

  // Abstention is a result: an unknown country must not answer "EUR", because
  // the caller's own fallback (the account's base currency) is the better
  // answer and only the caller knows it.
  it("returns null rather than guessing for an unknown or absent country", () => {
    expect(currencyForCountry("ZZ")).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
    expect(currencyForCountry(undefined)).toBeNull();
    expect(currencyForCountry("")).toBeNull();
  });

  it("gives a territory its own answer rather than its parent's", () => {
    // A hotel in Guadeloupe carries "GP" and bills in euros; one in New
    // Caledonia carries "NC" and bills in CFP francs. Both would be wrong if
    // the table only knew "FR".
    expect(currencyForCountry("GP")).toBe("EUR");
    expect(currencyForCountry("NC")).toBe("XPF");
  });
});
