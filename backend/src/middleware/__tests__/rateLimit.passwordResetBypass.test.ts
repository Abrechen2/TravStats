import express from "express";
import request from "supertest";

import { passwordResetLimiter } from "../rateLimit";
import { RATE_LIMITS } from "../../config/constants";

/**
 * The password-reset limiter guards forgot-password, reset-password and
 * force-change-password. In production it must keep biting; in development and
 * test it steps aside the way `authLimiter` always has, because an E2E run is
 * one address sending the same few requests per browser — the auth-ladder spec
 * met a 429 on its third browser (forgejo#56).
 */
function appWithLimiter(): express.Express {
  const app = express();
  app.post("/probe", passwordResetLimiter, (_req, res) => {
    res.status(204).end();
  });
  return app;
}

async function statusesOf(app: express.Express, count: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await request(app).post("/probe")).status);
  return out;
}

describe("passwordResetLimiter outside production", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("does not rate-limit in test", async () => {
    process.env.NODE_ENV = "test";
    const statuses = await statusesOf(appWithLimiter(), RATE_LIMITS.PASSWORD_RESET_MAX + 2);
    expect(statuses).not.toContain(429);
  });

  it("still rate-limits in production", async () => {
    process.env.NODE_ENV = "production";
    const statuses = await statusesOf(appWithLimiter(), RATE_LIMITS.PASSWORD_RESET_MAX + 1);
    expect(statuses.at(-1)).toBe(429);
  });
});
