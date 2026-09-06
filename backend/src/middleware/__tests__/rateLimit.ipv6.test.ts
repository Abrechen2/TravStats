import express from "express";
import request from "supertest";

/**
 * express-rate-limit 8 keys an anonymous client by its IPv6 /56 prefix, not
 * by the full address — a single host owns far more than one address, so a
 * raw `req.ip` key hands an IPv6 client a fresh bucket per request. The
 * library refuses a custom keyGenerator that reads `req.ip` without its
 * `ipKeyGenerator` helper: ERR_ERL_KEY_GEN_IPV6, logged through
 * `console.error` when the limiter is BUILT, once per limiter — twenty-odd
 * error lines on every boot.
 *
 * Both halves are checked: the boot stays silent, and two addresses in one
 * /56 share a bucket while a third /56 does not. Own module registry, so the
 * in-memory store is not shared with any other test.
 */
describe("rateLimit.ts — anonymous IPv6 clients are keyed by /56 prefix", () => {
  it("builds every limiter without an ERR_ERL_KEY_GEN_IPV6 complaint", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.isolateModules(() => {
        require("../rateLimit");
      });
      const complaints = spy.mock.calls
        .flat()
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a)))
        .filter((s) => s.includes("ERR_ERL_KEY_GEN_IPV6"));
      expect(complaints).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("shares one bucket across a /56 and opens another for a different /56", async () => {
    // airportSearchBurstLimiter: max 30 per minute for anonymous callers.
    const LIMIT = 30;
    let limiter: express.RequestHandler | undefined;
    jest.isolateModules(() => {
      limiter = require("../rateLimit").airportSearchBurstLimiter;
    });
    const app = express();
    app.set("trust proxy", true);
    app.get("/probe", limiter!, (_req, res) => res.status(204).end());

    const hit = (ip: string) => request(app).get("/probe").set("X-Forwarded-For", ip);

    for (let i = 0; i < LIMIT; i++) {
      expect((await hit("2001:db8:0:1::1")).status).toBe(204);
    }
    // A different address in the SAME /56 — the bucket is already full.
    expect((await hit("2001:db8:0:1:ffff::2")).status).toBe(429);
    // A different /56 starts with an empty bucket.
    expect((await hit("2001:db8:1:1::1")).status).toBe(204);
  });
});
