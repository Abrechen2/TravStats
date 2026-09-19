import express from "express";
import request from "supertest";

/**
 * forgejo#88 finding 4 — the auth limiter answers a HUMAN, not a script.
 *
 * `authLimiter` used to carry express-rate-limit's `message` option with a
 * bare English string. That sends the string as the whole body, so the
 * response is not JSON at all: a client reading `data.error` found nothing,
 * and the login form fell back to "Anmeldung fehlgeschlagen" — naming the
 * password as the cause of a request whose password it never checked.
 *
 * What is pinned here is the CONTRACT the form reads: a JSON body, a stable
 * `code` to branch on, and the wait in the body rather than only in a header
 * (a header needs `Access-Control-Expose-Headers` to survive a cross-origin
 * read; a body never does).
 *
 * `skipOutsideProduction` keeps the limiter off in dev and test, so the env
 * is flipped for the duration of the request — which is also why the module
 * registry is isolated: the limiter reads `NODE_ENV` per request, but its
 * in-memory store must not be shared with any other suite.
 */
describe("authLimiter — the 429 a person meets is readable", () => {
  const withProductionEnv = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      return await fn();
    } finally {
      process.env.NODE_ENV = previous;
    }
  };

  const appWithAuthLimiter = (): express.Express => {
    let limiter: express.RequestHandler | undefined;
    jest.isolateModules(() => {
      limiter = require("../rateLimit").authLimiter;
    });
    const app = express();
    // No `trust proxy` and no X-Forwarded-For: the default loopback address
    // is key enough here, and express-rate-limit 8 logs
    // ERR_ERL_PERMISSIVE_TRUST_PROXY through console.error for a blanket
    // `true` — noise that would read like a finding in a green run. Each
    // call re-requires the module, so every app gets its own empty store.
    app.post("/login", limiter!, (_req, res) => res.status(200).json({ ok: true }));
    return app;
  };

  it("answers with JSON carrying RATE_LIMITED and the wait in seconds", async () => {
    await withProductionEnv(async () => {
      const app = appWithAuthLimiter();
      const hit = () => request(app).post("/login");

      // Drain the bucket. The exact ceiling lives in config/constants; what
      // matters is that a 429 eventually arrives and reads correctly.
      let refused: request.Response | undefined;
      for (let i = 0; i < 40; i++) {
        const res = await hit();
        if (res.status === 429) {
          refused = res;
          break;
        }
      }

      expect(refused).toBeDefined();
      expect(refused!.headers["content-type"]).toContain("application/json");
      expect(refused!.body.code).toBe("RATE_LIMITED");
      // The wait is a positive whole number of seconds, so a client can quote
      // it. Never 0 — a "try again in 0 minutes" is worse than no figure.
      expect(typeof refused!.body.retryAfterSeconds).toBe("number");
      expect(refused!.body.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  it("still lets the first attempts through — this is a ceiling, not a wall", async () => {
    await withProductionEnv(async () => {
      const app = appWithAuthLimiter();
      const first = await request(app).post("/login");
      expect(first.status).toBe(200);
    });
  });
});
