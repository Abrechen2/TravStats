import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken, tokenLookupHash } from "../../utils/apiTokens";
import { generatePairingCode } from "../../services/pairing/pairingService";

describe("Pairing API", () => {
  let userId: string;
  let authCookie: string;
  let bearerToken: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "pairingroute" } });
    const u = await prisma.user.create({
      data: { username: "pairingroute", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    // A real PAT so we can exercise the Bearer / cookie-only branches.
    const gen = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: "test-pat",
        scope: "write",
        lookupHash: gen.lookupHash,
        hash: gen.hash,
      },
    });
    bearerToken = gen.plaintext;
  });

  beforeEach(async () => {
    await prisma.pairingCode.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.pairingCode.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("POST /api/v1/pairing/start", () => {
    it("issues a code for a cookie session", async () => {
      const res = await request(app).post("/api/v1/pairing/start").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.code).toMatch(/^clm_[0-9a-f]{32}$/);
      expect(typeof res.body.publicUrl).toBe("string");
      expect(typeof res.body.expiresAt).toBe("string");
    });

    it("rejects an unauthenticated request", async () => {
      const res = await request(app).post("/api/v1/pairing/start");
      expect(res.status).toBe(401);
    });

    it("403s a PAT (Bearer) request — cookie-only surface", async () => {
      const res = await request(app)
        .post("/api/v1/pairing/start")
        .set("Authorization", `Bearer ${bearerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/pairing/status/:code", () => {
    it("reports unclaimed then claimed", async () => {
      const { code } = await generatePairingCode(userId);

      const unclaimed = await request(app)
        .get(`/api/v1/pairing/status/${code}`)
        .set("Cookie", authCookie);
      expect(unclaimed.status).toBe(200);
      expect(unclaimed.body.claimed).toBe(false);

      await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code, deviceName: "Pixel 8", deviceId: "dev-status" });

      const claimed = await request(app)
        .get(`/api/v1/pairing/status/${code}`)
        .set("Cookie", authCookie);
      expect(claimed.body.claimed).toBe(true);
      expect(claimed.body.deviceName).toBe("Pixel 8");
    });
  });

  describe("POST /api/v1/pairing/claim", () => {
    it("happy path: mints a device PAT", async () => {
      const { code } = await generatePairingCode(userId);
      const res = await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code, deviceName: "iPhone 15", deviceId: "dev-happy", platform: "ios", appVersion: "2.2.0" });

      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^ts_pat_/);
      expect(typeof res.body.server).toBe("string");
      expect(res.body.user.username).toBe("pairingroute");

      const minted = await prisma.apiToken.findFirst({
        where: { userId, deviceId: "dev-happy", revokedAt: null },
      });
      expect(minted?.scope).toBe("write");
      expect(minted?.label).toBe("iPhone 15");
      expect(minted?.platform).toBe("ios");
    });

    it("revokes a prior token for the same device on re-pair", async () => {
      const first = await generatePairingCode(userId);
      await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code: first.code, deviceName: "Tablet", deviceId: "dev-repair" });

      const second = await generatePairingCode(userId);
      await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code: second.code, deviceName: "Tablet", deviceId: "dev-repair" });

      const tokens = await prisma.apiToken.findMany({ where: { userId, deviceId: "dev-repair" } });
      const active = tokens.filter((t) => !t.revokedAt);
      expect(tokens.length).toBe(2);
      expect(active.length).toBe(1);
    });

    it("400s an expired code", async () => {
      const code = `clm_${"a".repeat(32)}`;
      await prisma.pairingCode.create({
        data: { codeHash: tokenLookupHash(code), userId, expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await request(app).post("/api/v1/pairing/claim").send({ code });
      expect(res.status).toBe(400);
    });

    it("400s a reused code", async () => {
      const { code } = await generatePairingCode(userId);
      const first = await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code, deviceId: "dev-reuse" });
      expect(first.status).toBe(201);
      const second = await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code, deviceId: "dev-reuse" });
      expect(second.status).toBe(400);
    });

    it("eventually rate-limits the public endpoint", async () => {
      // Limiter is 10/15min per IP, scoped to this test file's module instance.
      // Fire enough requests that a 429 is guaranteed regardless of prior calls.
      const statuses: number[] = [];
      for (let i = 0; i < 15; i++) {
        const res = await request(app)
          .post("/api/v1/pairing/claim")
          .send({ code: `clm_${i.toString().padStart(32, "0")}` });
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
    });
  });

  describe("POST /api/v1/pairing/unpair", () => {
    it("revokes the calling Bearer token", async () => {
      const gen = await generateApiToken();
      const created = await prisma.apiToken.create({
        data: {
          userId,
          label: "to-unpair",
          scope: "write",
          lookupHash: gen.lookupHash,
          hash: gen.hash,
          deviceId: "dev-unpair",
        },
      });

      const res = await request(app)
        .post("/api/v1/pairing/unpair")
        .set("Authorization", `Bearer ${gen.plaintext}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const after = await prisma.apiToken.findUnique({ where: { id: created.id } });
      expect(after?.revokedAt).not.toBeNull();
    });

    it("400s a cookie session (no API token to revoke)", async () => {
      const res = await request(app).post("/api/v1/pairing/unpair").set("Cookie", authCookie);
      expect(res.status).toBe(400);
    });
  });
});
