import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";

/**
 * GET/PUT /settings/notifications with per-domain reminders (package 11):
 * the additive contract, the legacy fields an old client still uses, and the
 * `push` flag of the CALLING device.
 */
const KEY = Buffer.alloc(32, 9).toString("base64url");
const URL = "/api/v1/settings/notifications";

async function pairedDevice(userId: string, tag: string, rejected = false) {
  const gen = await generateApiToken();
  const row = await prisma.apiToken.create({
    data: {
      userId,
      label: tag,
      scope: "write",
      lookupHash: gen.lookupHash,
      hash: gen.hash,
      deviceId: tag,
    },
  });
  return {
    id: row.id,
    auth: { Authorization: `Bearer ${gen.plaintext}` },
    register: () =>
      prisma.devicePush.create({
        data: {
          apiTokenId: row.id,
          userId,
          platform: "ios",
          token: `token-${tag}`.padEnd(32, "x"),
          publicKey: KEY,
          tokenRejectedAt: rejected ? new Date() : null,
        },
      }),
  };
}

describe("settings/notifications per domain", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "notifdomains_a" } });
    const u = await prisma.user.create({
      data: { username: "notifdomains_a", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    await ensureAdminSettingsRow();
  });

  beforeEach(async () => {
    await prisma.reminderPreference.deleteMany({ where: { userId } });
    await prisma.devicePush.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { notificationEmail: null, notifyBefore24h: false, notifyBefore2h: false },
    });
    await prisma.adminSettings.updateMany({
      data: { pushEnabled: true, pushRelayUrl: "https://push.example.test" },
    });
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: { pushEnabled: false } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("an old client's GET still carries the three legacy fields", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { notificationEmail: "a@example.com", notifyBefore24h: true },
    });
    const res = await request(app).get(URL).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      notificationEmail: "a@example.com",
      notifyBefore24h: true,
      notifyBefore2h: false,
    });
    // An account without rows reads the legacy switches into every domain.
    expect(res.body.domains.rail).toEqual({ enabled: true, leadHours: [24], channel: "mail" });
  });

  it("an old client's PUT of the two switches fans out to the domain rows", async () => {
    await request(app)
      .put(URL)
      .set("Cookie", cookie)
      .send({ domains: { rail: { leadHours: [24, 2, 5], channel: "both" } } });
    const res = await request(app)
      .put(URL)
      .set("Cookie", cookie)
      .send({ notifyBefore24h: false, notifyBefore2h: true });
    expect(res.status).toBe(200);
    expect(res.body.domains.rail.leadHours).toEqual([5, 2]); // custom kept, 24 removed
    expect(res.body.domains.lodging.leadHours).toEqual([2]);
  });

  it("stores a domain's enabled / leadHours / channel and derives the legacy switches", async () => {
    const res = await request(app)
      .put(URL)
      .set("Cookie", cookie)
      .send({
        notificationEmail: "b@example.com",
        domains: { flight: { enabled: true, leadHours: [24, 6], channel: "app" } },
      });
    expect(res.status).toBe(200);
    expect(res.body.domains.flight).toEqual({ enabled: true, leadHours: [24, 6], channel: "app" });
    expect(res.body.notifyBefore24h).toBe(true);
    const again = await request(app).get(URL).set("Cookie", cookie);
    expect(again.body.domains.flight.leadHours).toEqual([24, 6]);
  });

  it.each([
    ["two custom values", [24, 5, 6]],
    ["a duplicate", [24, 24]],
    ["0 hours", [0]],
    ["more than a week", [169]],
    ["a fraction", [1.5]],
  ])("rejects leadHours with %s", async (_name, leadHours) => {
    const res = await request(app)
      .put(URL)
      .set("Cookie", cookie)
      .send({ domains: { flight: { leadHours } } });
    expect(res.status).toBe(400);
  });

  it("accepts an empty leadHours (no reminders for that domain) and refuses an unknown domain", async () => {
    const ok = await request(app)
      .put(URL)
      .set("Cookie", cookie)
      .send({ domains: { bus: { leadHours: [], enabled: true } } });
    expect(ok.status).toBe(200);
    expect(ok.body.domains.bus).toEqual({ enabled: true, leadHours: [], channel: "mail" });
    const bad = await request(app)
      .put(URL)
      .set("Cookie", cookie)
      .send({ domains: { train: { enabled: true } } });
    expect(bad.status).toBe(400);
  });

  it("says why mail cannot go when there is no e-mail address", async () => {
    const res = await request(app).get(URL).set("Cookie", cookie);
    expect(res.body.mail).toEqual({ available: false, reason: "no_email" });
  });

  describe("push flag of the calling device", () => {
    it("no_relay when the admin has not switched push on", async () => {
      await prisma.adminSettings.updateMany({ data: { pushEnabled: false } });
      const dev = await pairedDevice(userId, "d1");
      await dev.register();
      const res = await request(app).get(URL).set(dev.auth);
      expect(res.body.push).toEqual({ available: false, reason: "no_relay" });
    });

    it("no_device_token for a paired device that never registered a token", async () => {
      const dev = await pairedDevice(userId, "d2");
      const res = await request(app).get(URL).set(dev.auth);
      expect(res.body.push).toEqual({ available: false, reason: "no_device_token" });
    });

    it("available for a device with a valid token", async () => {
      const dev = await pairedDevice(userId, "d3");
      await dev.register();
      const res = await request(app).get(URL).set(dev.auth);
      expect(res.body.push).toEqual({ available: true, reason: null });
    });

    it("token_rejected once the relay named the token dead, per device", async () => {
      const bad = await pairedDevice(userId, "d4", true);
      await bad.register();
      const good = await pairedDevice(userId, "d5");
      await good.register();
      const badRes = await request(app).get(URL).set(bad.auth);
      expect(badRes.body.push).toEqual({ available: false, reason: "token_rejected" });
      const goodRes = await request(app).get(URL).set(good.auth);
      expect(goodRes.body.push).toEqual({ available: true, reason: null });
    });

    it("a browser session is judged by the account's devices", async () => {
      const none = await request(app).get(URL).set("Cookie", cookie);
      expect(none.body.push.reason).toBe("no_device_token");
      const dev = await pairedDevice(userId, "d6");
      await dev.register();
      const some = await request(app).get(URL).set("Cookie", cookie);
      expect(some.body.push.available).toBe(true);
    });
  });
});
