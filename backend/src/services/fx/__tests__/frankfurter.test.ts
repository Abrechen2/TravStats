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

  /**
   * AUD-067. `Number.isFinite` accepts 0 and negatives, so a numeric-but-
   * impossible rate was taken, cached for the life of the process, and
   * written: a 100 USD stay stored `totalPriceBase: 0, fxRate: 0` and answered
   * 201. Zero is a MISSING conversion, and "no rate" is a state this code
   * already renders honestly.
   */
  describe("a rate has to be a positive, finite number", () => {
    const answerWith = (rate: unknown): void => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ amount: 1, base: "USD", date: "2024-07-01", rates: { EUR: rate } }),
      }) as unknown as typeof fetch;
    };

    // An EXPLICIT date per case. The module cache is keyed by (date, from, to)
    // and outlives an `it()` block, so two cases sharing a date would let the
    // first one's value answer the second — which is how a derived date caught
    // me out while writing this.
    it.each([
      ["zero", 0, "2024-07-11"],
      ["negative", -0.1, "2024-07-12"],
      ["not a number", "0.9", "2024-07-13"],
      ["infinite", Number.POSITIVE_INFINITY, "2024-07-14"],
      ["NaN", Number.NaN, "2024-07-15"],
    ])("refuses a %s rate rather than storing it", async (_label, rate, date) => {
      answerWith(rate);
      expect(await getRate("USD", "EUR", date as string)).toBeNull();
    });
  });

  /**
   * AUD-066. Today's rate is still moving — the ECB publishes around midday —
   * so caching it for the life of the process froze the morning's answer. A
   * later conversion of 200 USD kept returning 180 EUR after the provider had
   * moved to 0.95, with no second request made.
   */
  describe("only a settled day is cached", () => {
    it("asks again for TODAY instead of serving the first answer forever", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ date: today, rates: { EUR: 0.9 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ date: today, rates: { EUR: 0.95 } }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      expect((await getRate("USD", "EUR", today))?.rate).toBeCloseTo(0.9, 4);
      expect((await getRate("USD", "EUR", today))?.rate).toBeCloseTo(0.95, 4);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("still caches a settled day, which is what makes the cache worth having", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ date: "2023-02-14", rates: { EUR: 0.93 } }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await getRate("USD", "EUR", "2023-02-14");
      await getRate("USD", "EUR", "2023-02-14");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * AUD-065. Neither provider passed an abort signal, so a slow one ran as
   * long as it liked — past the client's own 10 s budget, which meant a save
   * the user saw fail had in fact succeeded.
   */
  it("gives the provider a deadline", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2023-03-15", rates: { EUR: 0.9 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await getRate("USD", "EUR", "2023-03-15");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
