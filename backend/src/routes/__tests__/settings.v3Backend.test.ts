import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { withTripFederation } from "../../services/sharing/federation/__tests__/federationEnv";

/**
 * Settings v3 phase S2, the account-level rows: `cur` (display currency apart from the
 * base currency), `planai`/`planwx` (nested under `travPlan`), `findable` on the settings
 * route family, and the admin's `internet` master switch as the user settings report it.
 */
describe("settings v3 — backend for the new rows", () => {
  const stamp = Date.now();
  const username = `settings-v3-${stamp}`;
  const adminName = `settings-v3-admin-${stamp}`;
  let cookie: string;
  let adminCookie: string;
  let userId: string;
  let restoreFederation: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const admin = await prisma.user.create({
      data: { username: adminName, passwordHash: await hashPassword("password123"), isAdmin: true },
    });
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });
  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
  });
  afterEach(async () => {
    if (restoreFederation) await restoreFederation();
    restoreFederation = null;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [username, adminName] } } });
    await prisma.$disconnect();
  });

  const get = () => request(app).get("/api/v1/settings").set("Cookie", cookie);
  const put = (body: object) =>
    request(app).put("/api/v1/settings").set("Cookie", cookie).send(body);

  describe("cur: display currency", () => {
    it("follows the base currency until chosen", async () => {
      const res = await get().expect(200);
      expect(res.body.baseCurrency).toBe("EUR");
      expect(res.body.displayCurrency).toBe("EUR");
      await put({ baseCurrency: "USD" }).expect(200);
      expect((await get()).body.displayCurrency).toBe("USD");
    });

    it("is stored apart from the base currency, which keeps its value", async () => {
      const res = await put({ baseCurrency: "EUR", displayCurrency: "CHF" }).expect(200);
      expect(res.body).toMatchObject({ baseCurrency: "EUR", displayCurrency: "CHF" });
      const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
      expect(row).toMatchObject({ baseCurrency: "EUR", displayCurrency: "CHF" });
      // A PUT that names neither leaves both alone.
      const again = await put({ settingsLevel: "expert" }).expect(200);
      expect(again.body).toMatchObject({ baseCurrency: "EUR", displayCurrency: "CHF" });
    });

    it("null returns to following the base currency; a non-ECB code is a 400", async () => {
      await put({ displayCurrency: "GBP" }).expect(200);
      const res = await put({ displayCurrency: null }).expect(200);
      expect(res.body.displayCurrency).toBe(res.body.baseCurrency);
      await put({ displayCurrency: "XYZ" }).expect(400);
    });
  });

  describe("planai / planwx: travPlan.ai and travPlan.weather", () => {
    it("default to on and are written without touching travPlan.enabled", async () => {
      expect((await get()).body.travPlan).toEqual({ enabled: false, ai: true, weather: true });
      const res = await put({ travPlan: { ai: false } }).expect(200);
      expect(res.body.travPlan).toEqual({ enabled: false, ai: false, weather: true });
      const res2 = await put({ travPlan: { weather: false, enabled: true } }).expect(200);
      expect(res2.body.travPlan).toEqual({ enabled: true, ai: false, weather: false });
    });

    it("refuse a key outside the block", async () => {
      await put({ travPlan: { forecast: true } }).expect(400);
    });
  });

  describe("findable on the settings route family", () => {
    it("is refused while this server is not connected to others (SHARE_REMOTE_DISABLED)", async () => {
      const res = await request(app)
        .put("/api/v1/settings/profile/findable")
        .set("Cookie", cookie)
        .send({ findable: true });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("SHARE_REMOTE_DISABLED");
    });

    it("reads and writes users.federationFindable, bare, default off", async () => {
      restoreFederation = await withTripFederation("https://me.example.test");
      const before = await request(app)
        .get("/api/v1/settings/profile/findable")
        .set("Cookie", cookie)
        .expect(200);
      expect(before.body).toEqual({ findable: false });
      const on = await request(app)
        .put("/api/v1/settings/profile/findable")
        .set("Cookie", cookie)
        .send({ findable: true })
        .expect(200);
      expect(on.body).toEqual({ findable: true });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).federationFindable
      ).toBe(true);
      await request(app)
        .put("/api/v1/settings/profile/findable")
        .set("Cookie", cookie)
        .send({ findable: "yes" })
        .expect(400);
    });
  });

  describe("internet: master switch", () => {
    afterEach(async () => {
      await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", adminCookie)
        .send({ internetEnabled: true, openDataEnabled: false });
    });

    it("is written by the admin, defaults on, and gates the openDataEnabled flag users read", async () => {
      const admin = (body: object) =>
        request(app).put("/api/v1/admin/instance-settings").set("Cookie", adminCookie).send(body);
      const on = await admin({ internetEnabled: true, openDataEnabled: true }).expect(200);
      expect(on.body.settings).toMatchObject({ internetEnabled: true, openDataEnabled: true });
      expect((await get()).body.openDataEnabled).toBe(true);

      const off = await admin({ internetEnabled: false }).expect(200);
      // The column keeps its value; only what the instance may do changes.
      expect(off.body.settings).toMatchObject({ internetEnabled: false, openDataEnabled: true });
      expect((await get()).body.openDataEnabled).toBe(false);

      await admin({ internetEnabled: "no" }).expect(400);
    });

    it("is not writable by a normal account", async () => {
      await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", cookie)
        .send({ internetEnabled: false })
        .expect(403);
    });
  });
});
