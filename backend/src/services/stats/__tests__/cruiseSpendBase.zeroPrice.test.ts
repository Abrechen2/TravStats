import { cruiseTotalSpendBase, isPricedCruise } from "../cruiseSpendBase";
import type { CruiseStatsRow } from "../cruiseStatsData";

const row = (price: number | null, currency: string | null = "EUR"): CruiseStatsRow =>
  ({
    id: `c-${String(price)}`,
    label: "Test",
    shipName: null,
    startDate: null,
    companions: [],
    price,
    currency,
    priceBase: null,
    fxBaseCurrency: null,
    input: {},
  }) as unknown as CruiseStatsRow;

/**
 * `isPricedCruise` read `price > 0`, so a cruise saved at 0 EUR counted as
 * unpriced — the collapse flights shed on 2026-09-21. null is "no price
 * recorded"; 0 is a price.
 */
describe("cruise spend: a recorded 0 is a price", () => {
  it("treats 0 as priced and null as unpriced", () => {
    expect(isPricedCruise(row(0))).toBe(true);
    expect(isPricedCruise(row(null))).toBe(false);
  });

  it("answers 0 for a logbook of free sailings instead of abstaining", () => {
    expect(cruiseTotalSpendBase([row(0), row(0)], "EUR")).toEqual({
      value: 0,
      excludedCount: 0,
      currency: "EUR",
    });
  });

  it("still abstains when no cruise carries a price at all", () => {
    expect(cruiseTotalSpendBase([row(null)], "EUR").value).toBeNull();
  });

  it("counts a free sailing in a foreign currency as excluded, not as silence", () => {
    expect(cruiseTotalSpendBase([row(0, "USD"), row(500)], "EUR")).toEqual({
      value: 500,
      excludedCount: 1,
      currency: "EUR",
    });
  });
});
