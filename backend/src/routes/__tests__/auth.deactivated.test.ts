import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/**
 * Forgejo #31: a deactivated account could still log in.
 *
 * The lock itself held — `authenticate` refused the NEXT request with 403 — so
 * nothing protected was read. What was wrong is that the door handed out a key:
 * `/auth/login` answered 200 and wrote a fresh `auth_token`. An account that an
 * admin has switched off must not receive a session token at all, and must be
 * told so on the request it made rather than on the one after.
 *
 * The assertion that matters is the SET-COOKIE one. A test that only checked
 * the status code would pass against a handler that returns 403 after writing
 * the cookie, which is the half-fix worth guarding against.
 */
const USERNAME = "uat-deactivated-31";
const PASSWORD = "password123";

describe("a deactivated account is refused a session", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.user.create({
      data: {
        username: USERNAME,
        passwordHash: await hashPassword(PASSWORD),
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  it("refuses the login with 403 and issues no cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(403);

    const setCookie = res.headers["set-cookie"] ?? [];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(cookies.filter((c) => c.startsWith("auth_token="))).toEqual([]);
    // Neither of the other two challenge cookies may be written either: both are
    // steps on a road that ends in a session, and #31 asked for no token of any
    // kind. `change_token` in particular is consumed by force-change-password.
    expect(cookies.filter((c) => c.startsWith("twofa_token="))).toEqual([]);
    expect(cookies.filter((c) => c.startsWith("change_token="))).toEqual([]);
  });

  it("still answers 401, not 403, when the password is wrong", async () => {
    // The control probe. Without it, a handler that refuses everything would
    // pass the test above, and the 403 would say nothing about deactivation.
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: USERNAME, password: "definitely-not-the-password" });

    expect(res.status).toBe(401);
  });

  it("writes no two-factor challenge for a deactivated account either", async () => {
    // This is the case the EARLY check exists for. `issueAuthCookie` guards the
    // end of the road, but the two-factor branch returns before reaching it —
    // so without the early exit a disabled account still receives a
    // `twofa_token` and a "requiresTwoFactor" answer, which reads as "your
    // password was accepted, now finish signing in".
    const twofa = "uat-deactivated-2fa-31";
    await prisma.user.deleteMany({ where: { username: twofa } });
    await prisma.user.create({
      data: {
        username: twofa,
        passwordHash: await hashPassword(PASSWORD),
        isActive: false,
        twoFactorEnabledAt: new Date(),
        twoFactorSecret: "irrelevant-for-this-path",
      },
    });

    try {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ username: twofa, password: PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.requiresTwoFactor).toBeUndefined();
      const setCookie = res.headers["set-cookie"] ?? [];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(cookies.filter((c) => c.startsWith("twofa_token="))).toEqual([]);
    } finally {
      await prisma.user.deleteMany({ where: { username: twofa } });
    }
  });

  it("lets an active account through, cookie and all", async () => {
    // The second control probe: proves the new branch refuses the deactivated
    // case specifically rather than breaking login for everyone.
    const active = "uat-active-31";
    await prisma.user.deleteMany({ where: { username: active } });
    await prisma.user.create({
      data: { username: active, passwordHash: await hashPassword(PASSWORD), isActive: true },
    });

    try {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ username: active, password: PASSWORD });

      expect(res.status).toBe(200);
      const setCookie = res.headers["set-cookie"] ?? [];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(cookies.some((c) => c.startsWith("auth_token="))).toBe(true);
    } finally {
      await prisma.user.deleteMany({ where: { username: active } });
    }
  });
});
