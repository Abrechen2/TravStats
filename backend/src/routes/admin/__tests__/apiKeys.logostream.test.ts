import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";

/**
 * Covers the globalLogostreamApiKey short-secret guard added to
 * globalApiKeysSchema in routes/admin/apiKeys.ts. Encryption
 * (utils/encryption.ts) silently corrupts secrets shorter than 16 bytes,
 * so the schema must reject short values while still allowing the two
 * "no real change" sentinels: empty string (clears the key) and a masked
 * echo of the GET response (leaves the stored key untouched).
 */
describe("PUT /api/v1/admin/api-keys — globalLogostreamApiKey validation", () => {
  let adminUser: { id: string };
  let adminCookie: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-logostream-test-${timestamp}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(adminUser.id)}`;
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: { globalLogostreamApiKey: null } });
    await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  it("rejects a short (10-char) key with 400", async () => {
    const res = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalLogostreamApiKey: "short1234" + "5" }); // 10 chars
    expect(res.status).toBe(400);
  });

  it("accepts an empty string (clears the key) with 200", async () => {
    const res = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalLogostreamApiKey: "" });
    expect(res.status).toBe(200);
    expect(res.body.settings.globalLogostreamApiKey).toBeUndefined();
  });

  it("accepts a masked echo (no real change) with 200", async () => {
    // First set a real 20-char key so there is something to leave unchanged.
    const setupRes = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalLogostreamApiKey: "a".repeat(20) });
    expect(setupRes.status).toBe(200);

    const masked = setupRes.body.settings.globalLogostreamApiKey as string;
    expect(masked).toContain("****");

    const res = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalLogostreamApiKey: masked });
    expect(res.status).toBe(200);
    // Stored value is untouched — mask of the echoed value equals the mask
    // of the previously-stored key.
    expect(res.body.settings.globalLogostreamApiKey).toBe(masked);
  });

  it("accepts a valid (20-char) key with 200", async () => {
    const res = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalLogostreamApiKey: "b".repeat(20) });
    expect(res.status).toBe(200);
    expect(res.body.settings.globalLogostreamApiKey).toContain("****");
  });
});
