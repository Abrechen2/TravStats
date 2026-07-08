import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { APP_PREFS_MAX_BYTES } from "../../schemas/appSettings";

/**
 * Create a real PAT row for `userId` with the given scope and return the
 * plaintext to send as a Bearer header. Mirrors the production token shape
 * so the shared `authenticate` middleware accepts it.
 */
async function createPat(userId: string, scope: "read" | "write" | "admin"): Promise<string> {
  const tok = await generateApiToken();
  await prisma.apiToken.create({
    data: {
      userId,
      label: `appsettings-test-${scope}`,
      lookupHash: tok.lookupHash,
      hash: tok.hash,
      scope,
    },
  });
  return tok.plaintext;
}

describe("App Settings API", () => {
  let userAId: string;
  let userBId: string;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["appsettings_a", "appsettings_b"] } },
    });
    const userA = await prisma.user.create({
      data: { username: "appsettings_a", passwordHash: await hashPassword("password123") },
    });
    const userB = await prisma.user.create({
      data: { username: "appsettings_b", passwordHash: await hashPassword("password123") },
    });
    userAId = userA.id;
    userBId = userB.id;
    cookieA = `auth_token=${generateToken(userA.id)}`;
    cookieB = `auth_token=${generateToken(userB.id)}`;
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/app-settings", () => {
    it("returns { prefs: null, updatedAt: null } when no prefs stored", async () => {
      const res = await request(app).get("/api/v1/app-settings").set("Cookie", cookieB);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ prefs: null, updatedAt: null });
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/app-settings");
      expect(res.status).toBe(401);
    });
  });

  describe("PUT then GET round-trip", () => {
    it("stores and returns the blob (cookie session)", async () => {
      const prefs = { units: "metric", dateFormat: "DD.MM.YYYY", nested: { theme: "dark" } };
      const putRes = await request(app)
        .put("/api/v1/app-settings")
        .set("Cookie", cookieA)
        .send({ prefs });
      expect(putRes.status).toBe(200);
      expect(putRes.body.prefs).toEqual(prefs);
      expect(typeof putRes.body.updatedAt).toBe("string");

      const getRes = await request(app).get("/api/v1/app-settings").set("Cookie", cookieA);
      expect(getRes.status).toBe(200);
      expect(getRes.body.prefs).toEqual(prefs);
      expect(getRes.body.updatedAt).toBe(putRes.body.updatedAt);
    });

    it("honours a client-provided updatedAt (last-write-wins)", async () => {
      const updatedAt = "2026-01-02T03:04:05.000Z";
      const res = await request(app)
        .put("/api/v1/app-settings")
        .set("Cookie", cookieA)
        .send({ prefs: { units: "imperial" }, updatedAt });
      expect(res.status).toBe(200);
      expect(res.body.updatedAt).toBe(updatedAt);
    });
  });

  describe("validation", () => {
    it("rejects a non-object top-level (array) with 400", async () => {
      const res = await request(app)
        .put("/api/v1/app-settings")
        .set("Cookie", cookieA)
        .send({ prefs: ["a", "b"] });
      expect(res.status).toBe(400);
    });

    it("rejects a primitive top-level with 400", async () => {
      const res = await request(app)
        .put("/api/v1/app-settings")
        .set("Cookie", cookieA)
        .send({ prefs: "hello" });
      expect(res.status).toBe(400);
    });

    it("rejects an oversized payload with 400", async () => {
      const big = "x".repeat(APP_PREFS_MAX_BYTES + 1);
      const res = await request(app)
        .put("/api/v1/app-settings")
        .set("Cookie", cookieA)
        .send({ prefs: { blob: big } });
      expect(res.status).toBe(400);
    });
  });

  describe("user isolation", () => {
    it("user B cannot read user A's prefs", async () => {
      await request(app)
        .put("/api/v1/app-settings")
        .set("Cookie", cookieA)
        .send({ prefs: { secret: "A-only" } });

      const res = await request(app).get("/api/v1/app-settings").set("Cookie", cookieB);
      expect(res.status).toBe(200);
      // B has never written — must see null, never A's blob.
      expect(res.body.prefs).toBeNull();
    });
  });

  describe("PAT scope enforcement", () => {
    it("read-scoped PAT may GET", async () => {
      const pat = await createPat(userAId, "read");
      const res = await request(app)
        .get("/api/v1/app-settings")
        .set("Authorization", `Bearer ${pat}`);
      expect(res.status).toBe(200);
    });

    it("read-scoped PAT is blocked from PUT with 403", async () => {
      const pat = await createPat(userAId, "read");
      const res = await request(app)
        .put("/api/v1/app-settings")
        .set("Authorization", `Bearer ${pat}`)
        .send({ prefs: { units: "metric" } });
      expect(res.status).toBe(403);
    });

    it("write-scoped PAT may PUT and round-trips for its owner", async () => {
      const pat = await createPat(userBId, "write");
      const prefs = { units: "metric", lang: "de" };
      const putRes = await request(app)
        .put("/api/v1/app-settings")
        .set("Authorization", `Bearer ${pat}`)
        .send({ prefs });
      expect(putRes.status).toBe(200);
      expect(putRes.body.prefs).toEqual(prefs);

      const getRes = await request(app)
        .get("/api/v1/app-settings")
        .set("Authorization", `Bearer ${pat}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.prefs).toEqual(prefs);
    });
  });
});
