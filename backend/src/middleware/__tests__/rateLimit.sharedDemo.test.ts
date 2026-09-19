import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { authenticate } from "../auth";

/**
 * The shared demo account gets one bucket per VISITOR, not one bucket in
 * total.
 *
 * `userOrIpKey` keys on the user id, which is right for an account with an
 * owner and wrong for the one account whose password is printed on the login
 * page of a public instance. Measured on the public beta on 2026-09-19: the
 * auditor's FIRST parse request answered 429 — the 10-per-15-minutes bucket
 * had already been spent by other visitors, and `statsLimiter` behaved the
 * same. A shared budget for strangers is not a rate limit; it is a denial of
 * service any visitor can hand the next.
 *
 * Both halves are measured here, because fixing one by breaking the other
 * would be no fix: the demo account must SPLIT by address, and an ordinary
 * account must still SHARE its bucket across addresses — that is what stops
 * one user hopping IPs to buy themselves a fresh quota.
 *
 * `rateLimit.ipv6.test.ts` next door holds the other property this touches:
 * the key generator's source must keep naming `ipKeyGenerator`, or
 * express-rate-limit 8 complains about every limiter at build time.
 */
describe("rateLimit.ts — the shared demo account is keyed by address", () => {
  const ids: string[] = [];
  let demoCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: {
        username: `ratelimit-normal-${Date.now()}`,
        passwordHash: await hashPassword("password123"),
      },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  /**
   * A probe app around ONE limiter, with its own module registry so the
   * in-memory store is not shared with another test — the idiom
   * `rateLimit.ipv6.test.ts` uses.
   *
   * `countryFlagLimiter` is the limiter under test purely because it is
   * post-auth, keyed with `userOrIpKey` like every other one in the file, and
   * needs nothing of its own; the key generator is what is being measured, and
   * every one of them shares it.
   */
  const probe = (): express.Express => {
    let limiter: express.RequestHandler | undefined;
    jest.isolateModules(() => {
      limiter = require("../rateLimit").countryFlagLimiter as express.RequestHandler;
    });
    const app = express();
    app.set("trust proxy", true);
    // `authenticate` reads the JWT out of `req.cookies`, which only exists
    // once something has parsed the header — the real app mounts this in
    // `index.ts`.
    app.use(cookieParser());
    app.get("/probe", authenticate, limiter!, (_req, res) => res.status(204).end());
    return app;
  };

  /** The `RateLimit-Remaining` header, which says which bucket was drawn on. */
  const remainingAfterOneCall = async (
    app: express.Express,
    cookie: string,
    ip: string
  ): Promise<number> => {
    const res = await request(app).get("/probe").set("Cookie", cookie).set("X-Forwarded-For", ip);
    expect(res.status).toBe(204);
    return Number(res.headers["ratelimit-remaining"]);
  };

  it("gives two visitors of the demo account two buckets", async () => {
    const app = probe();
    const first = await remainingAfterOneCall(app, demoCookie, "203.0.113.10");
    const second = await remainingAfterOneCall(app, demoCookie, "198.51.100.20");

    // Each address spent its own first request, so both report the same
    // remaining count. One shared bucket would have counted down.
    expect(second).toBe(first);
  });

  it("still shares one bucket across the addresses of an ordinary account", async () => {
    const app = probe();
    const first = await remainingAfterOneCall(app, userCookie, "203.0.113.10");
    const second = await remainingAfterOneCall(app, userCookie, "198.51.100.20");

    // The user key ignores the address, so the second call drew on the bucket
    // the first one opened — which is what stops IP-hopping for a quota.
    expect(second).toBe(first - 1);
  });

  it("keeps two visitors of the demo account apart across IPv6 /56 prefixes", async () => {
    const app = probe();
    const first = await remainingAfterOneCall(app, demoCookie, "2001:db8:0:1::1");
    // Same /56 — deliberately the same bucket: one host owns many addresses,
    // and a fresh bucket per address is how an IPv6 client would bypass the
    // limit entirely.
    const sameHost = await remainingAfterOneCall(app, demoCookie, "2001:db8:0:1:ffff::2");
    expect(sameHost).toBe(first - 1);

    // A different /56 is a different visitor.
    const other = await remainingAfterOneCall(app, demoCookie, "2001:db8:1:1::1");
    expect(other).toBe(first);
  });
});
