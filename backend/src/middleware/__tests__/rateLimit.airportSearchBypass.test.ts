import express from "express";
import request from "supertest";

import { airportSearchBurstLimiter } from "../rateLimit";

/**
 * The anonymous airport search is keyed by address, and an E2E run is one
 * address. In development the burst and sustained buckets step aside; in test
 * and production they keep biting — test included, because the limiter's own
 * suites run under it (forgejo#56).
 */
function appWithLimiter(): express.Express {
  const app = express();
  app.get("/probe", airportSearchBurstLimiter, (_req, res) => {
    res.status(204).end();
  });
  return app;
}

async function statusesOf(app: express.Express, count: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await request(app).get("/probe")).status);
  return out;
}

describe("airport search limiters by environment", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("does not rate-limit in development", async () => {
    process.env.NODE_ENV = "development";
    expect(await statusesOf(appWithLimiter(), 32)).not.toContain(429);
  });

  it("still rate-limits in test", async () => {
    process.env.NODE_ENV = "test";
    expect((await statusesOf(appWithLimiter(), 31)).at(-1)).toBe(429);
  });
});
