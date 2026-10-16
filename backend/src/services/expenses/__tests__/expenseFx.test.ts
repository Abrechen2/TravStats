import { describe, expect, it } from "@jest/globals";

import { expenseFxOnCreate } from "../expenseFx";

/**
 * A supplied rate re-prices the amount into the base currency's minor unit.
 * In binary floating point 1.005 × 100 is 100.49999999999999, so the old
 * `Math.round(amount * rate * factor)` turned a half cent DOWN — a different
 * base amount than every other price in the app (Decimal, half-up).
 */
describe("expenseFxOnCreate with a supplied rate", () => {
  const supplied = (rate: number, baseCurrency: string) =>
    ({ rate, baseCurrency, rateDate: "2025-05-01", source: "manual" }) as const;

  it("rounds a half cent up", async () => {
    const { columns } = await expenseFxOnCreate(
      "no-user-needed",
      { amount: 1.005, currency: "USD", date: null },
      supplied(1, "EUR")
    );
    expect(columns.amountBase?.toString()).toBe("1.01");
  });

  it("rounds to the base currency's own minor units", async () => {
    const { columns } = await expenseFxOnCreate(
      "no-user-needed",
      { amount: 10.5, currency: "EUR", date: null },
      supplied(162.1, "JPY")
    );
    // 1702.05 yen; a yen has no minor unit.
    expect(columns.amountBase?.toString()).toBe("1702");
  });
});
