/**
 * The truth table for `lodgingBaseAmount` / `isUnconvertedSpend`.
 *
 * The backend carries the same suite beside its own copy of the module. The
 * two differ in exactly one line — this side's test runner is imported, the
 * other's is global — and assert the same rows otherwise, so a change made on
 * one side and forgotten on the other fails somewhere. Nothing CHECKS that
 * they agree; that is the convention for a mirrored rule here, not a guard,
 * and calling the files identical when they are not is how such a convention
 * quietly stops being true.
 */
import { describe, expect, it } from "vitest";
import { isUnconvertedSpend, lodgingBaseAmount, type LodgingStayFx } from "../lodgingSpendBase";

const stay = (o: Partial<LodgingStayFx>): LodgingStayFx => ({
  totalPrice: 100,
  currency: "EUR",
  totalPriceBase: null,
  fxBaseCurrency: null,
  ...o,
});

describe("lodgingBaseAmount", () => {
  it("counts a stay priced in the base currency at its own price, with no snapshot", () => {
    expect(lodgingBaseAmount(stay({ currency: "EUR", totalPrice: 190 }), "EUR")).toBe(190);
  });

  it("gives nothing for a foreign stay with no snapshot", () => {
    expect(lodgingBaseAmount(stay({ currency: "USD", totalPrice: 190 }), "EUR")).toBeNull();
  });

  it("counts a foreign stay at its snapshot, not at its price", () => {
    const s = stay({
      currency: "USD",
      totalPrice: 200,
      totalPriceBase: 184,
      fxBaseCurrency: "EUR",
    });
    expect(lodgingBaseAmount(s, "EUR")).toBe(184);
  });

  it("gives nothing for a snapshot taken in a base currency the account has left", () => {
    const s = stay({
      currency: "USD",
      totalPrice: 200,
      totalPriceBase: 184,
      fxBaseCurrency: "CHF",
    });
    expect(lodgingBaseAmount(s, "EUR")).toBeNull();
  });

  /** The price beats the snapshot: an account that switched away and back
   *  holds base-currency stays whose snapshot names the currency it left. */
  it("prefers the own price over a stale snapshot", () => {
    const s = stay({
      currency: "EUR",
      totalPrice: 190,
      totalPriceBase: 205,
      fxBaseCurrency: "USD",
    });
    expect(lodgingBaseAmount(s, "EUR")).toBe(190);
  });

  it("reads a missing currency as EUR, the column's own default", () => {
    expect(lodgingBaseAmount(stay({ currency: null, totalPrice: 50 }), "EUR")).toBe(50);
    expect(lodgingBaseAmount(stay({ currency: null, totalPrice: 50 }), "USD")).toBeNull();
  });

  /** A free award night is a price, and converts. Only `null` is "no price". */
  it("counts a real zero, and abstains on no price at all", () => {
    expect(lodgingBaseAmount(stay({ totalPrice: 0 }), "EUR")).toBe(0);
    expect(lodgingBaseAmount(stay({ totalPrice: null }), "EUR")).toBeNull();
  });
});

describe("isUnconvertedSpend", () => {
  it("is false for a stay priced in the base currency, snapshot or not", () => {
    expect(isUnconvertedSpend(stay({ currency: "EUR", totalPrice: 190 }), "EUR")).toBe(false);
  });

  it("is true for a foreign stay that nothing converted", () => {
    expect(isUnconvertedSpend(stay({ currency: "USD", totalPrice: 190 }), "EUR")).toBe(true);
  });

  /**
   * A stay converted under an OLDER base currency is NOT counted here: it has
   * a rate, and `spendBaseByCurrency` reports it under the currency it was
   * converted into. Counting it too would put one stay behind two hints.
   */
  it("is false for a stay converted under a base currency the account has left", () => {
    const s = stay({
      currency: "USD",
      totalPrice: 200,
      totalPriceBase: 184,
      fxBaseCurrency: "CHF",
    });
    expect(isUnconvertedSpend(s, "EUR")).toBe(false);
  });

  it("is false for a stay with no price — nothing was withheld", () => {
    expect(isUnconvertedSpend(stay({ currency: "USD", totalPrice: null }), "EUR")).toBe(false);
  });
});
