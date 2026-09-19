import { seedFxColumns } from "../seedDemo/stayFx";

/**
 * Finding B4 of the independent review of 2026-09-17: every seeded stay
 * carried a `currency` and a `totalPrice` and no FX snapshot, so the lodging
 * money statistics — which only sum `totalPriceBase` for stays snapshotted
 * into the CURRENT base currency (utils/lodgingStats/money.ts) — reported an
 * empty base total and counted every priced stay as "not converted". The demo
 * account showed the money tab as if the feature were broken.
 */
describe("seedFxColumns", () => {
  const checkIn = new Date("2023-09-09T00:00:00Z");

  it("converts an amount already in the base currency at rate 1", () => {
    const fx = seedFxColumns({ totalPrice: 780, currency: "EUR", checkIn }, "EUR");
    expect(fx.totalPriceBase).toBe(780);
    expect(fx.fxRate).toBe(1);
    expect(fx.fxBaseCurrency).toBe("EUR");
    expect(fx.fxRateDate).toEqual(checkIn);
  });

  it("converts a foreign amount at the seed's own rate, rounded to the base currency", () => {
    const fx = seedFxColumns({ totalPrice: 118000, currency: "JPY", checkIn }, "EUR");
    expect(fx.fxRate).not.toBeNull();
    expect(fx.totalPriceBase).toBe(Math.round(118000 * fx.fxRate! * 100) / 100);
    expect(fx.fxBaseCurrency).toBe("EUR");
  });

  it("never dresses an invented rate as an official one", () => {
    // The vocabulary is 'ecb' | 'cdn' | 'manual', and the readout labels
    // anything that is not 'manual'/'cdn' as an ECB rate. A seeded estimate is
    // not an ECB rate.
    const fx = seedFxColumns({ totalPrice: 980, currency: "GBP", checkIn }, "EUR");
    expect(fx.fxSource).toBe("manual");
  });

  it("abstains where it has no rate, rather than inventing one", () => {
    const fx = seedFxColumns({ totalPrice: 9500, currency: "ZAR", checkIn }, "EUR");
    expect(fx.totalPriceBase).toBeNull();
    expect(fx.fxRate).toBeNull();
    expect(fx.fxRateDate).toBeNull();
    expect(fx.fxBaseCurrency).toBeNull();
    expect(fx.fxSource).toBeNull();
  });

  it("writes nothing at all for a stay with no price", () => {
    const fx = seedFxColumns({ totalPrice: null, currency: "EUR", checkIn }, "EUR");
    expect(fx.totalPriceBase).toBeNull();
    expect(fx.fxRate).toBeNull();
  });
});
