import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { generatePairingCode } from "../../services/pairing/pairingService";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";

/**
 * PUT/GET/DELETE /api/v1/devices/me/push — a paired phone registers its push
 * token and X25519 key (Companion spec §3.2, TravStats#156). The token and
 * the key never come back out, and a revoked pairing forgets them.
 */
const KEY = Buffer.alloc(32, 7).toString("base64url");
const body = {
  platform: "ios",
  token: "a".repeat(64),
  apnsEnvironment: "production",
  publicKey: KEY,
  flightChanges: true,
  reminders: false,
  locale: "de",
};

async function pairedToken(
  userId: string,
  deviceId: string,
  scope = "write"
): Promise<{ plaintext: string; id: string }> {
  const gen = await generateApiToken();
  const row = await prisma.apiToken.create({
    data: {
      userId,
      label: deviceId,
      scope,
      lookupHash: gen.lookupHash,
      hash: gen.hash,
      deviceId,
    },
  });
  return { plaintext: gen.plaintext, id: row.id };
}

describe("Device push registration", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "devicepush_a" } });
    const u = await prisma.user.create({
      data: { username: "devicepush_a", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    await ensureAdminSettingsRow();
  });

  afterAll(async () => {
    await prisma.devicePush.deleteMany({ where: { userId } });
    await prisma.pairingCode.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("stores a registration and never returns the token or the key", async () => {
    const pat = await pairedToken(userId, "dev-store");
    const auth = { Authorization: `Bearer ${pat.plaintext}` };
    const put = await request(app).put("/api/v1/devices/me/push").set(auth).send(body);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ registered: true, serverPushEnabled: false });

    const get = await request(app).get("/api/v1/devices/me/push").set(auth);
    expect(get.status).toBe(200);
    expect(get.body).toEqual({
      platform: "ios",
      flightChanges: true,
      reminders: false,
      locale: "de",
      serverPushEnabled: false,
    });
    expect(JSON.stringify(get.body)).not.toContain(body.token);
    expect(JSON.stringify(get.body)).not.toContain(KEY);

    await request(app)
      .put("/api/v1/devices/me/push")
      .set(auth)
      .send({ ...body, reminders: true })
      .expect(200);
    const rows = await prisma.devicePush.findMany({ where: { apiTokenId: pat.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reminders).toBe(true);
  });

  it("tells the phone when the admin has switched push on", async () => {
    const pat = await pairedToken(userId, "dev-admin");
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    await prisma.adminSettings.update({ where: { id: admin!.id }, data: { pushEnabled: true } });
    try {
      const res = await request(app)
        .put("/api/v1/devices/me/push")
        .set({ Authorization: `Bearer ${pat.plaintext}` })
        .send(body);
      expect(res.body).toEqual({ registered: true, serverPushEnabled: true });
    } finally {
      await prisma.adminSettings.update({ where: { id: admin!.id }, data: { pushEnabled: false } });
    }
  });

  it("refuses a browser session — this route is for a paired phone", async () => {
    const res = await request(app).put("/api/v1/devices/me/push").set("Cookie", cookie).send(body);
    expect(res.status).toBe(400);
  });

  it.each([
    ["an unknown platform", { platform: "web" }],
    ["a key that is not 32 bytes", { publicKey: Buffer.alloc(31).toString("base64url") }],
    ["a token with spaces", { token: "not a token at all" }],
    ["an unknown field", { extra: 1 }],
  ])("400s %s", async (_label, patch) => {
    const pat = await pairedToken(userId, `dev-bad-${Math.random()}`);
    const res = await request(app)
      .put("/api/v1/devices/me/push")
      .set({ Authorization: `Bearer ${pat.plaintext}` })
      .send({ ...body, ...patch });
    expect(res.status).toBe(400);
  });

  it("refuses a read-only token to register or forget a phone", async () => {
    const pat = await pairedToken(userId, "dev-read-only", "read");
    const auth = { Authorization: `Bearer ${pat.plaintext}` };
    await request(app).put("/api/v1/devices/me/push").set(auth).send(body).expect(403);
    await request(app).delete("/api/v1/devices/me/push").set(auth).expect(403);
    expect(await prisma.devicePush.findUnique({ where: { apiTokenId: pat.id } })).toBeNull();
    // Reading its own state stays allowed.
    await request(app).get("/api/v1/devices/me/push").set(auth).expect(404);
  });

  it("ignores apnsEnvironment on Android", async () => {
    const pat = await pairedToken(userId, "dev-android");
    await request(app)
      .put("/api/v1/devices/me/push")
      .set({ Authorization: `Bearer ${pat.plaintext}` })
      .send({ ...body, platform: "android" })
      .expect(200);
    const row = await prisma.devicePush.findUnique({ where: { apiTokenId: pat.id } });
    expect(row?.apnsEnvironment).toBeNull();
  });

  it("DELETE forgets the registration; GET then says not registered", async () => {
    const pat = await pairedToken(userId, "dev-delete");
    const auth = { Authorization: `Bearer ${pat.plaintext}` };
    await request(app).put("/api/v1/devices/me/push").set(auth).send(body).expect(200);
    await request(app).delete("/api/v1/devices/me/push").set(auth).expect(204);
    const get = await request(app).get("/api/v1/devices/me/push").set(auth);
    expect(get.status).toBe(404);
    expect(get.body).toEqual({ error: "not_registered", serverPushEnabled: false });
  });

  describe("a revoked pairing forgets the push registration", () => {
    it("on unpair", async () => {
      const pat = await pairedToken(userId, "dev-unpair");
      const auth = { Authorization: `Bearer ${pat.plaintext}` };
      await request(app).put("/api/v1/devices/me/push").set(auth).send(body).expect(200);
      await request(app).post("/api/v1/pairing/unpair").set(auth).expect(200);
      expect(await prisma.devicePush.findUnique({ where: { apiTokenId: pat.id } })).toBeNull();
    });

    it("on re-pairing the same device", async () => {
      const first = await generatePairingCode(userId);
      const claim1 = await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code: first.code, deviceName: "Phone", deviceId: "dev-repair-push" });
      const auth = { Authorization: `Bearer ${claim1.body.token}` };
      await request(app).put("/api/v1/devices/me/push").set(auth).send(body).expect(200);
      const oldRows = await prisma.devicePush.count({ where: { userId } });

      const second = await generatePairingCode(userId);
      await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code: second.code, deviceName: "Phone", deviceId: "dev-repair-push" })
        .expect(201);
      expect(await prisma.devicePush.count({ where: { userId } })).toBe(oldRows - 1);
    });

    it("on revoking the token in the settings", async () => {
      const pat = await pairedToken(userId, "dev-settings-revoke");
      await request(app)
        .put("/api/v1/devices/me/push")
        .set({ Authorization: `Bearer ${pat.plaintext}` })
        .send(body)
        .expect(200);
      await request(app)
        .delete(`/api/v1/settings/tokens/${pat.id}`)
        .set("Cookie", cookie)
        .expect(200);
      expect(await prisma.devicePush.findUnique({ where: { apiTokenId: pat.id } })).toBeNull();
    });
  });
});
