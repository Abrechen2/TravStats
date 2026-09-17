import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * An independent review on 2026-09-17 found a second set of doors the shared
 * demo account could still walk through on a PUBLIC instance, where the
 * password is printed on the login page. Each case below is one of those
 * findings; the describe block names it.
 *
 * "It" is the SHARED demo account — `isDemo` AND username `demo` — never every
 * row carrying `isDemo`; see `utils/sharedDemo.ts` for why the flag alone is
 * the wrong question.
 */
describe("Wave A demo guards", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "waveAUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "waveAUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  /**
   * A1. `/diagnostic-export` returns SERVER-WIDE log tails — every account's
   * flight numbers, routes and times pass the scrubber, which only removes
   * identity. On a public instance that is one authenticated GET away from
   * anybody. Whether an ordinary user should get server-wide logs at all is an
   * owner decision and a board item; the shared login is refused now.
   */
  describe("A1 server-wide diagnostic export", () => {
    it("refuses the diagnostic export for the shared demo account", async () => {
      const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", demoCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("still serves the diagnostic export to a normal account", async () => {
      const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", userCookie);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("still serves the user-scoped diagnostics bundle to the shared demo account", async () => {
      // `/diagnostics` is the caller's OWN data, not the server's logs, so it
      // stays open — the guard must not be widened to the whole family.
      const res = await request(app).get("/api/v1/diagnostics").set("Cookie", demoCookie);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });
  });
});
