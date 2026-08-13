import { describe, expect, it } from "vitest";
import { formatStayPriceDisplay } from "../lodgingFormat";

/**
 * A price is in one of three states, and the screen has to say which:
 * converted officially, converted by a rate the user typed, or not converted
 * at all. The third is not an error — it is a fact about the world, and the
 * amount stays visible in its own currency.
 */
const labels = { ecb: "EZB-Kurs vom", manual: "eigener Kurs", none: "kein Kurs" };

describe("the three states of a stay price", () => {
  it("labels an ECB conversion as such and shows no marker", () => {
    const d = formatStayPriceDisplay(
      {
        totalPrice: 1146.5,
        currency: "NOK",
        totalPriceBase: 97.2,
        fxRate: 0.0848,
        fxRateDate: "2024-09-17",
        fxBaseCurrency: "EUR",
        fxSource: "ecb",
      },
      "de",
      labels
    );
    expect(d.fxReadout).toContain("EZB-Kurs vom");
    expect(d.marker).toBeNull();
  });

  it("marks a manual conversion as the user's own, never as ECB", () => {
    const d = formatStayPriceDisplay(
      {
        totalPrice: 11662,
        currency: "EGP",
        totalPriceBase: 228,
        fxRate: 0.01955,
        fxRateDate: "2026-03-04",
        fxBaseCurrency: "EUR",
        fxSource: "manual",
      },
      "de",
      labels
    );
    expect(d.marker).toBe("eigener Kurs");
    expect(d.fxReadout).not.toContain("EZB");
    expect(d.fxReadout).toContain("eigener Kurs");
  });

  it("marks an unconverted amount, shows no readout, and keeps the amount", () => {
    const d = formatStayPriceDisplay(
      {
        totalPrice: 11662,
        currency: "AED",
        totalPriceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
        fxSource: null,
      },
      "de",
      labels
    );
    expect(d.marker).toBe("kein Kurs");
    expect(d.fxReadout).toBeNull();
    expect(d.original).toContain("11.662");
  });

  it("does not mark a stay that simply has no price", () => {
    // Nothing to convert is not the same as "could not convert" — a priceless
    // stay must not wear a warning badge.
    const d = formatStayPriceDisplay(
      {
        totalPrice: null,
        currency: "EUR",
        totalPriceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
        fxSource: null,
      },
      "de",
      labels
    );
    expect(d.marker).toBeNull();
    expect(d.fxReadout).toBeNull();
  });

  it("does not mark a stay already priced in the base currency", () => {
    // Its conversion is real but trivial, so there is no readout — and no
    // marker either, because nothing failed.
    const d = formatStayPriceDisplay(
      {
        totalPrice: 120,
        currency: "EUR",
        totalPriceBase: 120,
        fxRate: 1,
        fxRateDate: "2026-01-01",
        fxBaseCurrency: "EUR",
        fxSource: "ecb",
      },
      "de",
      labels
    );
    expect(d.marker).toBeNull();
    expect(d.fxReadout).toBeNull();
  });
});
