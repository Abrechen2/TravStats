import { getRate } from "../frankfurter";

// This module is the ECB reference-rate CLIENT. Converting an amount moved to
// `resolver.ts` when a second provider arrived, and so did those tests.
describe("frankfurter FX", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns the ECB rate for a historical date", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 1, base: "CHF", date: "2024-05-10", rates: { EUR: 1.0106 } }),
    }) as unknown as typeof fetch;
    const rate = await getRate("CHF", "EUR", "2024-05-13");
    expect(rate?.rate).toBeCloseTo(1.0106, 4);
  });

  it("short-circuits an identical pair with no network call", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await getRate("EUR", "EUR", "2024-05-13")).toEqual({ rate: 1, source: "ecb" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // NOTE: uses a date not used by any other test in this file. The service's
  // rateCache is a module-level Map keyed by (date, from, to) that persists
  // across all `it()` blocks here (Jest does not reset module state between
  // tests in the same file). Reusing "2024-05-13" would make this test read
  // back the value cached by the first test instead of exercising the
  // rejected fetch mock below, silently masking the failure path.
  it("returns null (never throws) when the API fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await getRate("CHF", "EUR", "2024-05-20")).toBeNull();
  });

  // A bare number carries no provenance, and a stored conversion has to be
  // able to say whether a user typed the rate or the ECB published it — the UI
  // must never label an estimate as an official rate. Fresh date, see above.
  it("reports ECB as the source of its rates", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { EUR: 0.08481 } }),
    }) as unknown as typeof fetch;
    expect(await getRate("NOK", "EUR", "2024-09-18")).toMatchObject({
      rate: 0.08481,
      source: "ecb",
    });
  });
});
