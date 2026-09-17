import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The public preview shows the demo login to anyone. Every visitor shares the
 * account, so nothing one of them does may lock out or endanger the next:
 * credentials, second factors, device pairing, tokens, provider keys, outbound
 * connections and the profile picture are refused for `isDemo` users.
 */
describe("demo account guard", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["guardDemo", "guardUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "guardDemo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "guardUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
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
  ];

  it.each(locked)("refuses %s (%s) for the demo account", async (path, method, body) => {
    const res = await request(app)[method](path).set("Cookie", demoCookie).send(body);
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

  it("still lets the demo account read its settings", async () => {
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", demoCookie);
    expect(res.status).toBe(200);
  });

  it("tells the client that the account is the demo account", async () => {
    const demo = await request(app).get("/api/v1/auth/me").set("Cookie", demoCookie);
    expect(demo.body.user.isDemo).toBe(true);
    const user = await request(app).get("/api/v1/auth/me").set("Cookie", userCookie);
    expect(user.body.user.isDemo).toBe(false);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "guardDemo", password: "demo123" });
    expect(login.status).toBe(200);
    expect(login.body.user.isDemo).toBe(true);
  });
});
