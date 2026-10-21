import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { decryptApiKey } from "../../utils/encryption";

/**
 * beta.22 UAT: an instance whose stored global keys could not be decrypted
 * (api_key_decryption_error in the log) told every user "Flüge: 4 für alle
 * aktiv" — the user view counted the encrypted column's presence — while the
 * admin view said "nicht eingerichtet", because the masked echo needs the
 * plaintext. A key nobody can decrypt is not available to anyone; the user
 * view must say so, and the admin view must say WHY.
 */
describe("a stored global key that cannot be decrypted", () => {
  // Marked ciphertext whose auth tag cannot verify under this instance's key.
  const BROKEN = `tsenc:v1:${Buffer.alloc(64, 7).toString("base64")}`;
  let user: { id: string };
  let admin: { id: string };
  let saved: Record<string, string | null> = {};

  beforeAll(async () => {
    const stamp = Date.now();
    user = await prisma.user.create({
      data: { username: `undecrypt-u-${stamp}`, passwordHash: await hashPassword("pw-123456") },
    });
    admin = await prisma.user.create({
      data: {
        username: `undecrypt-a-${stamp}`,
        passwordHash: await hashPassword("pw-123456"),
        isAdmin: true,
      },
    });
    if (!(await prisma.adminSettings.findFirst())) {
      await prisma.adminSettings.create({ data: {} });
    }
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    saved = {
      globalAirlabsApiKey: row!.globalAirlabsApiKey,
      globalOpenskyClientId: row!.globalOpenskyClientId,
      globalOpenskyUsername: row!.globalOpenskyUsername,
    };
    await prisma.adminSettings.updateMany({
      data: {
        globalAirlabsApiKey: BROKEN,
        globalOpenskyClientId: BROKEN,
        globalOpenskyUsername: null,
      },
    });
    expect(decryptApiKey(BROKEN)).toBeNull();
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: saved });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
    await prisma.$disconnect();
  });

  it("is not reported to a user as available for everyone", async () => {
    const saveEnv = { a: process.env.AIRLABS_API_KEY, o: process.env.OPENSKY_CLIENT_ID };
    delete process.env.AIRLABS_API_KEY;
    delete process.env.OPENSKY_CLIENT_ID;
    try {
      const res = await request(app)
        .get("/api/v1/settings/api-keys")
        .set("Cookie", `auth_token=${generateToken(user.id)}`);
      expect(res.status).toBe(200);
      expect(res.body.airlabs).toEqual({ hasKey: false, isShared: false, hasAccess: false });
      expect(res.body.opensky.isShared).toBe(false);
    } finally {
      if (saveEnv.a !== undefined) process.env.AIRLABS_API_KEY = saveEnv.a;
      if (saveEnv.o !== undefined) process.env.OPENSKY_CLIENT_ID = saveEnv.o;
    }
  });

  it("is named to the admin as stored but undecryptable", async () => {
    const res = await request(app)
      .get("/api/v1/admin/api-keys")
      .set("Cookie", `auth_token=${generateToken(admin.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.globalAirlabsApiKey).toBeUndefined();
    expect(res.body.undecryptableKeys).toEqual(
      expect.arrayContaining(["globalAirlabsApiKey", "globalOpenskyClientId"])
    );
    expect(res.body.undecryptableKeys).not.toContain("globalAviationstackApiKey");
  });
});
