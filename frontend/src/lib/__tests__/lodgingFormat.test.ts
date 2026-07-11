import { describe, it, expect } from "vitest";
import {
  averageRatingsByCategory,
  formatStayPriceDisplay,
  hasAnyPrice,
  nightsBetween,
  otherCurrencySpend,
  singleOriginalCurrencySpend,
  type StayPriceSnapshot,
} from "../lodgingFormat";

function makeSnapshot(overrides: Partial<StayPriceSnapshot> = {}): StayPriceSnapshot {
  return {
    totalPrice: 840,
    currency: "CHF",
    totalPriceBase: 883,
    fxRate: 0.9895,
    fxRateDate: "2024-05-12T00:00:00.000Z",
    fxBaseCurrency: "EUR",
    ...overrides,
  };
}

describe("formatStayPriceDisplay", () => {
  it("renders the full FX readout when the snapshot is complete", () => {
    const result = formatStayPriceDisplay(makeSnapshot(), "de", "EZB");

    expect(result.fxReadout).not.toBeNull();
    expect(result.fxReadout).toContain("→");
    expect(result.fxReadout).toContain("0,9895");
    expect(result.fxReadout).toContain("EZB");
    expect(result.fxReadout).toContain("12.05.24");
    expect(result.original).not.toMatch(/null|NaN|undefined/);
  });

  it("renders the original price alone — no null/NaN/dangling arrow — when the FX snapshot is null", () => {
    const result = formatStayPriceDisplay(
      makeSnapshot({
        totalPriceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
      }),
      "de",
      "EZB"
    );

    expect(result.fxReadout).toBeNull();
    expect(result.original).not.toBe("");
    expect(result.original).not.toMatch(/null|NaN|undefined/);
    expect(result.original).not.toContain("→");
  });

  it("treats a partially-null snapshot (only some FX fields present) as absent, never a partial readout", () => {
    const result = formatStayPriceDisplay(
      makeSnapshot({ fxRate: null }), // totalPriceBase/fxRateDate/fxBaseCurrency still set
      "de",
      "EZB"
    );

    expect(result.fxReadout).toBeNull();
    expect(result.original).not.toMatch(/null|NaN|undefined/);
  });

  it("shows '—' for original price when there is no price at all, never blank/null/NaN", () => {
    const result = formatStayPriceDisplay(
      makeSnapshot({
        totalPrice: null,
        totalPriceBase: null,
        fxRate: null,
        fxRateDate: null,
        fxBaseCurrency: null,
      }),
      "de",
      "EZB"
    );

    expect(result.original).toBe("—");
    expect(result.fxReadout).toBeNull();
  });

  it("uses an en-US-ish rate format for the English locale", () => {
    const result = formatStayPriceDisplay(makeSnapshot(), "en", "ECB");
    expect(result.fxReadout).toContain("0.9895");
    expect(result.fxReadout).toContain("ECB");
  });
});

describe("nightsBetween", () => {
  it("computes whole nights between check-in and check-out", () => {
    expect(nightsBetween("2024-05-12T15:00:00.000Z", "2024-05-14T11:00:00.000Z")).toBe(2);
  });

  it("never returns a negative value for a malformed range", () => {
    expect(nightsBetween("2024-05-14T00:00:00.000Z", "2024-05-12T00:00:00.000Z")).toBe(0);
  });
});

describe("hasAnyPrice", () => {
  it("is false when every stay's totalPrice is null (nothing priced, or a cleared price)", () => {
    expect(hasAnyPrice([{ totalPrice: null, currency: "EUR" }])).toBe(false);
    expect(hasAnyPrice([])).toBe(false);
  });

  it("is true when at least one stay has a recorded price", () => {
    expect(
      hasAnyPrice([
        { totalPrice: null, currency: "EUR" },
        { totalPrice: 120, currency: "EUR" },
      ]),
    ).toBe(true);
  });
});

describe("singleOriginalCurrencySpend", () => {
  it("returns the summed original amount when every priced stay shares one non-base currency", () => {
    const result = singleOriginalCurrencySpend(
      [
        { totalPrice: 420, currency: "CHF" },
        { totalPrice: 420, currency: "CHF" },
      ],
      "EUR",
    );
    expect(result).toEqual({ amount: 840, currency: "CHF" });
  });

  it("returns null when the priced stays are already in the base currency", () => {
    expect(singleOriginalCurrencySpend([{ totalPrice: 100, currency: "EUR" }], "EUR")).toBeNull();
  });

  it("returns null when priced stays mix multiple currencies — no single honest original amount", () => {
    expect(
      singleOriginalCurrencySpend(
        [
          { totalPrice: 100, currency: "CHF" },
          { totalPrice: 50, currency: "USD" },
        ],
        "EUR",
      ),
    ).toBeNull();
  });

  it("returns null when nothing is priced", () => {
    expect(singleOriginalCurrencySpend([{ totalPrice: null, currency: "CHF" }], "EUR")).toBeNull();
  });

  it("ignores unpriced stays mixed in with a single-currency priced set", () => {
    const result = singleOriginalCurrencySpend(
      [
        { totalPrice: null, currency: "USD" }, // unpriced — currency irrelevant, must not count as "mixed"
        { totalPrice: 420, currency: "CHF" },
      ],
      "EUR",
    );
    expect(result).toEqual({ amount: 420, currency: "CHF" });
  });
});

describe("otherCurrencySpend", () => {
  it("derives the foreign-currency original amount(s) and their converted total via subtraction only", () => {
    // 1670 EUR (base-native) + 883 (converted CHF) = 2553 total base spend.
    const result = otherCurrencySpend({ EUR: 1670, CHF: 840 }, 2553, "EUR");
    expect(result).toEqual({
      currencies: [{ currency: "CHF", amount: 840 }],
      convertedTotal: 883,
    });
  });

  it("returns null when every currency present is the base currency", () => {
    expect(otherCurrencySpend({ EUR: 1234 }, 1234, "EUR")).toBeNull();
  });

  it("returns null when there's no base-currency-native spend at all but also no foreign entries", () => {
    expect(otherCurrencySpend({}, 0, "EUR")).toBeNull();
  });

  it("joins multiple foreign currencies and still derives one combined converted total", () => {
    const result = otherCurrencySpend({ EUR: 500, CHF: 420, USD: 100 }, 1020, "EUR");
    expect(result?.currencies).toEqual([
      { currency: "CHF", amount: 420 },
      { currency: "USD", amount: 100 },
    ]);
    expect(result?.convertedTotal).toBe(520);
  });

  it("returns null defensively when the derived converted total isn't positive", () => {
    // Pathological input (e.g. every foreign stay's FX lookup failed) —
    // must not render a nonsensical negative/zero sub-line.
    expect(otherCurrencySpend({ EUR: 1000, CHF: 200 }, 900, "EUR")).toBeNull();
  });
});

describe("averageRatingsByCategory", () => {
  it("averages each category independently, ignoring nulls per category", () => {
    const result = averageRatingsByCategory([
      { ratingRoom: 4, ratingBreakfast: 4, ratingService: 4 },
      { ratingRoom: 3, ratingBreakfast: null, ratingService: 5 },
    ]);
    expect(result.room).toBe(3.5);
    expect(result.breakfast).toBe(4);
    expect(result.service).toBe(4.5);
  });

  it("returns null for a category nobody rated", () => {
    const result = averageRatingsByCategory([{ ratingRoom: 4, ratingBreakfast: null, ratingService: null }]);
    expect(result.breakfast).toBeNull();
    expect(result.service).toBeNull();
  });
});
