import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The public preview shows the demo login to anyone. Every visitor shares the
 * account, so nothing one of them does may lock out or endanger the next:
 * credentials, second factors, device pairing, tokens, provider keys, outbound
 * connections, notification addresses, the profile and the profile picture are
 * refused for it.
 *
 * "It" is the SHARED demo account — `isDemo` AND username `demo` — not every
 * row carrying `isDemo`. `seedDemoUser` sets the flag on every account it
 * creates, which on the public preview is `admin`, `alex` and `claude`, and
 * locally is the dev `admin:admin123`. Keying the lock on the flag alone
 * locked those four out of their own settings (final review finding C1).
 */
describe("demo account guard", () => {
  let sharedDemoCookie: string;
  let flaggedUserCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["demo", "guardDemo", "guardUser"] } },
    });
    const shared = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    // The shape `seedDemoUser` leaves behind: flagged, but its own account.
    // A password of its own on purpose: the locked list below posts
    // `oldPassword: "demo123"` to /auth/change-password, and this account is
    // NOT refused there — sharing the password would let the case actually
    // change it, bump `sessionEpoch` and invalidate this cookie mid-suite.
    const flagged = await prisma.user.create({
      data: { username: "guardDemo", passwordHash: await hashPassword("flagged123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "guardUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(shared.id, flagged.id, user.id);
    sharedDemoCookie = `auth_token=${generateToken(shared.id)}`;
    flaggedUserCookie = `auth_token=${generateToken(flagged.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  const locked: Array<[string, "post" | "put" | "patch" | "delete", object]> = [
    ["/api/v1/auth/change-password", "post", { oldPassword: "demo123", newPassword: "whatever123!" }],
    ["/api/v1/auth/2fa/setup", "post", {}],
    ["/api/v1/auth/2fa/activate", "post", { code: "123456" }],
    ["/api/v1/auth/2fa/disable", "post", { password: "demo123" }],
    ["/api/v1/auth/2fa/recovery-codes", "post", { password: "demo123" }],
    ["/api/v1/auth/passkeys/register/options", "post", {}],
    ["/api/v1/auth/passkeys/register/verify", "post", {}],
    ["/api/v1/auth/passkeys/00000000-0000-0000-0000-000000000000", "patch", { name: "x" }],
    ["/api/v1/auth/passkeys/00000000-0000-0000-0000-000000000000", "delete", {}],
    ["/api/v1/pairing/start", "post", {}],
    ["/api/v1/settings/tokens", "post", { name: "x", scope: "read" }],
    ["/api/v1/settings/tokens/00000000-0000-0000-0000-000000000000", "delete", {}],
    ["/api/v1/settings/api-keys", "put", {}],
    ["/api/v1/settings/api-keys/test/aerodatabox", "post", {}],
    ["/api/v1/settings/immich", "put", { baseUrl: "http://10.0.0.1" }],
    ["/api/v1/settings/immich/test", "post", {}],
    ["/api/v1/settings/dawarich", "put", { baseUrl: "http://10.0.0.1" }],
    ["/api/v1/settings/dawarich/test", "post", {}],
    ["/api/v1/settings/profile-picture", "post", {}],
    ["/api/v1/settings/profile-picture", "delete", {}],
    // A visitor who sets the notification address of the shared account can
    // then ask /auth/forgot-password for a reset link to their own inbox and
    // take the account over — so the address is not theirs to set (C3).
    ["/api/v1/settings/notifications", "put", { notificationEmail: "attacker@example.com" }],
    // The birthdate behind /settings/profile and the name in the settings
    // profile block are shown to every other visitor and survived every
    // reseed (I1).
    ["/api/v1/settings/profile", "put", { birthdate: "1990-01-01" }],
  ];

  it.each(locked)("refuses %s (%s) for the shared demo account", async (path, method, body) => {
    const res = await request(app)[method](path).set("Cookie", sharedDemoCookie).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  // Controller ruling R1: these three routes make outbound network calls for a
  // real account (Immich/Dawarich connectivity tests, an AeroDataBox lookup) —
  // a test must never reach external/LAN hosts, so they are excluded here and
  // exercised only in the demo direction above, where the guard refuses them
  // before any outbound call happens.
  const outboundRoutes = new Set([
    "/api/v1/settings/immich/test",
    "/api/v1/settings/dawarich/test",
    "/api/v1/settings/api-keys/test/aerodatabox",
  ]);
  const lockedForNormalAccount = locked.filter(([path]) => !outboundRoutes.has(path));

  it.each(lockedForNormalAccount)("does not refuse %s (%s) for a normal account", async (path, method, body) => {
    const res = await request(app)[method](path).set("Cookie", userCookie).send(body);
    expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  // Finding C1: `seedDemoUser` sets `isDemo` on every account it creates, so
  // the preview's `admin`, `alex` and `claude` and the local dev admin all
  // carry the flag. They own their accounts; only the published `demo` login
  // is shared.
  it.each(lockedForNormalAccount)(
    "does not refuse %s (%s) for a flagged account that is not the shared demo",
    async (path, method, body) => {
      const res = await request(app)[method](path).set("Cookie", flaggedUserCookie).send(body);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    }
  );

  it("refuses a settings PUT that carries a profile block, and allows one that does not", async () => {
    const withProfile = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", sharedDemoCookie)
      .send({ profile: { firstName: "Not" } });
    expect(withProfile.status).toBe(403);
    expect(withProfile.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");

    // The rest of the settings PUT stays open — display settings and map
    // colours are what a visitor came to try out.
    const withoutProfile = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", sharedDemoCookie)
      .send({ display: { theme: "dark" } });
    expect(withoutProfile.status).toBe(200);

    const normal = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", userCookie)
      .send({ profile: { firstName: "Real" } });
    expect(normal.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
  });

  it("still lets the demo account read its settings", async () => {
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", sharedDemoCookie);
    expect(res.status).toBe(200);
    const notifications = await request(app)
      .get("/api/v1/settings/notifications")
      .set("Cookie", sharedDemoCookie);
    expect(notifications.status).toBe(200);
  });

  it("tells the client which account is the SHARED demo account", async () => {
    const demo = await request(app).get("/api/v1/auth/me").set("Cookie", sharedDemoCookie);
    expect(demo.body.user.isSharedDemo).toBe(true);
    // Flagged, but its own account — the UI must offer it every control.
    const flagged = await request(app).get("/api/v1/auth/me").set("Cookie", flaggedUserCookie);
    expect(flagged.body.user.isSharedDemo).toBe(false);
    const user = await request(app).get("/api/v1/auth/me").set("Cookie", userCookie);
    expect(user.body.user.isSharedDemo).toBe(false);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "demo", password: "demo123" });
    expect(login.status).toBe(200);
    expect(login.body.user.isSharedDemo).toBe(true);

    const flaggedLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "guardDemo", password: "flagged123" });
    expect(flaggedLogin.status).toBe(200);
    expect(flaggedLogin.body.user.isSharedDemo).toBe(false);
  });
});
