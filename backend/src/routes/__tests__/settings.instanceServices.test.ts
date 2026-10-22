import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { updateInstanceSettings } from "../../services/instanceSettingsService";

/**
 * `GET /settings/instance-services` (forgejo#321, owner item 1): an ordinary
 * account learns whether the keyless rail services run — booleans only, never
 * the address an admin configured.
 */
describe("GET /settings/instance-services", () => {
  const username = `instance-services-${Date.now()}`;
  let cookie: string;
  const ROUTER_URL = "http://10.11.12.13:8989/secret-path";

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123"), isAdmin: false },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await updateInstanceSettings({
      railTransitousEnabled: true,
      railDbRestEnabled: true,
      railRoutingUrl: null,
    });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("answers the admin's switches as three booleans", async () => {
    await updateInstanceSettings({
      railTransitousEnabled: true,
      railDbRestEnabled: false,
      railRoutingUrl: ROUTER_URL,
    });
    const res = await request(app)
      .get("/api/v1/settings/instance-services")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ transitous: true, dbRest: false, openRailRouting: true });
    // The URL an admin set never reaches an account.
    expect(JSON.stringify(res.body)).not.toContain("10.11.12.13");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["ratelimit-limit"] ?? res.headers["ratelimit-policy"]).toBeDefined();
  });

  it("no rail router configured reads as off", async () => {
    await updateInstanceSettings({
      railTransitousEnabled: false,
      railDbRestEnabled: true,
      railRoutingUrl: null,
    });
    const res = await request(app)
      .get("/api/v1/settings/instance-services")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ transitous: false, dbRest: true, openRailRouting: false });
  });

  it("refuses an anonymous caller", async () => {
    await request(app).get("/api/v1/settings/instance-services").expect(401);
  });
});
