import express from "express";
import request from "supertest";

import { statsLimiter } from "../rateLimit";

/**
 * forgejo#88 acceptance, 2026-10-10: the statistics bucket (30 a minute) was
 * spent by ordinary settings use in development, where StrictMode runs every
 * effect twice. Measured on a production build, a settings visit costs 2, so
 * the ceiling stays where it is for production and test, and steps aside in
 * development like the other per-request ceilings.
 */
function appWithLimiter(): express.Express {
  const app = express();
  app.get("/probe", statsLimiter, (_req, res) => {
    res.status(204).end();
  });
  return app;
}

async function statusesOf(app: express.Express, count: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await request(app).get("/probe")).status);
  return out;
}

describe("statsLimiter by environment", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("does not rate-limit in development", async () => {
    process.env.NODE_ENV = "development";
    expect(await statusesOf(appWithLimiter(), 35)).not.toContain(429);
  });

  it("still rate-limits in test (and so in production) at 30 a minute", async () => {
    process.env.NODE_ENV = "test";
    const statuses = await statusesOf(appWithLimiter(), 31);
    expect(statuses.at(-1)).toBe(429);
  });
});
