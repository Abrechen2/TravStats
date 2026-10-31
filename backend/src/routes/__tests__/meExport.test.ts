import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#391 — GET /api/v1/me/export is the signed-in account's own data and
 * nothing else. Each test makes its own users: the limiter is per user.
 */

const made: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      username: `me-export-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "SYNTHETIC-PASSWORD-HASH",
      twoFactorSecret: "SYNTHETIC-TOTP-SECRET",
      twoFactorEnabledAt: new Date(),
    },
  });
  made.push(user.id);
  await prisma.userSettings.create({
    data: { userId: user.id, enabledDomains: ["poi"], data: {} },
  });
  return { id: user.id, username: user.username, cookie: `auth_token=${generateToken(user.id)}` };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
});

describe("GET /api/v1/me/export", () => {
  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/v1/me/export");
    expect(res.status).toBe(401);
  });

  it("returns only the caller's account, never another user's (forgejo#391)", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const res = await request(app).get("/api/v1/me/export").set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.format).toBe("travstats-account-export/1");
    expect(res.body.user.id).toBe(a.id);
    const text = JSON.stringify(res.body);
    expect(text).toContain(a.username);
    expect(text).not.toContain(b.id);
    expect(text).not.toContain(b.username);
    expect(res.body.users).toBeUndefined();
  });

  it("ignores a user id smuggled into the request", async () => {
    const a = await makeUser("a2");
    const b = await makeUser("b2");
    const res = await request(app)
      .get(`/api/v1/me/export?userId=${b.id}`)
      .set("Cookie", a.cookie)
      .set("X-User-Id", b.id);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(a.id);
  });

  it("carries no password hash, two-factor secret or token material", async () => {
    const a = await makeUser("secrets");
    const res = await request(app).get("/api/v1/me/export").set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("SYNTHETIC-PASSWORD-HASH");
    expect(text).not.toContain("SYNTHETIC-TOTP-SECRET");
    for (const key of [
      "passwordHash",
      "twoFactorSecret",
      "resetToken",
      "changeToken",
      "tokenHash",
    ]) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  it("is a dated attachment and stays no-store", async () => {
    const a = await makeUser("headers");
    const res = await request(app).get("/api/v1/me/export").set("Cookie", a.cookie);
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename\*=UTF-8''travstats-my-data-\d{4}-\d{2}-\d{2}\.json$/
    );
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("answers 429 once the hourly allowance is used", async () => {
    const a = await makeUser("limit");
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get("/api/v1/me/export").set("Cookie", a.cookie);
      expect(ok.status).toBe(200);
    }
    const res = await request(app).get("/api/v1/me/export").set("Cookie", a.cookie);
    expect(res.status).toBe(429);
  });
});
