import { describe, expect, it } from "vitest";
import { ECB_CURRENCIES, ISO_4217, isCurrencyCode, minorUnits } from "../currencies";

describe("currency registry", () => {
  it("accepts real ISO-4217 codes and rejects near-misses", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("NOK")).toBe(true);
    expect(isCurrencyCode("EGP")).toBe(true);
    // The three shapes a user or a bad parse actually produces.
    expect(isCurrencyCode("EURO")).toBe(false);
    expect(isCurrencyCode("CH")).toBe(false);
    expect(isCurrencyCode("eur")).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });

  it("carries minor units, because not every currency has two", () => {
    expect(minorUnits("EUR")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
    // An unknown code must not silently claim to know: default to 2.
    expect(minorUnits("XXX")).toBe(2);
  });

  it("lists the ECB set as a strict subset of ISO-4217", () => {
    expect(ECB_CURRENCIES).toContain("EUR");
    expect(ECB_CURRENCIES).toContain("NOK");
    expect(ECB_CURRENCIES).not.toContain("EGP");
    expect(ECB_CURRENCIES).toHaveLength(30);
    for (const code of ECB_CURRENCIES) expect(ISO_4217[code]).toBeDefined();
  });
});
