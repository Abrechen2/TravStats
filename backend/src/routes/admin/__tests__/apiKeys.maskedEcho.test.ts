import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { encryptApiKey, decryptApiKey } from "../../../utils/encryption";

/**
 * Regression coverage for the masked-echo overwrite bug (final-review HIGH
 * finding): the admin UI (AdminPage handleSaveGlobalApiKeys) always PUTs its
 * ENTIRE form state, which after a GET contains masked echoes like
 * "ac97****2a86" for every provider the admin did not retype. The PUT
 * handler in routes/admin/apiKeys.ts used to blindly `encryptApiKey()` every
 * field it received, so a masked echo got re-encrypted and stored — silently
 * clobbering the real stored key with an unusable ciphertext of the literal
 * mask string. Only `globalLogostreamApiKey` had a guard against this; the
 * other seven fields (airlabs, aviationstack, aerodatabox, and the four
 * opensky fields) did not.
 *
 * These assertions read the DB truth directly via prisma.adminSettings +
 * decryptApiKey — NOT via the masked GET/PUT response — because maskKey() is
 * idempotent on an already-masked string, so a GET-based assertion cannot
 * detect the corruption. That blindness is exactly what let the bug ship.
 */
describe("PUT /api/v1/admin/api-keys — masked-echo overwrite protection", () => {
  let adminUser: { id: string };
  let adminCookie: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-maskedecho-test-${timestamp}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(adminUser.id)}`;

    // Ensure a singleton adminSettings row exists.
    const existing = await prisma.adminSettings.findFirst();
    if (!existing) {
      await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          defaultVisionParser: "auto",
          defaultTextParser: "auto",
          allowUserFlightApiKeys: true,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({
      data: {
        globalAirlabsApiKey: null,
        globalAviationstackApiKey: null,
        globalAerodataboxApiKey: null,
        globalLogostreamApiKey: null,
        globalOpenskyClientId: null,
        globalOpenskyClientSecret: null,
        globalOpenskyUsername: null,
        globalOpenskyPassword: null,
      },
    });
    await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  it("keeps the stored AirLabs key when the UI echoes its masked value back", async () => {
    const REAL_KEY = "real-airlabs-key-1234567890";

    // Seed a real key directly (bypassing the route) so we know the exact
    // plaintext to assert against afterwards.
    const settingsId = (await prisma.adminSettings.findFirst())!.id;
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { globalAirlabsApiKey: encryptApiKey(REAL_KEY) },
    });

    // Fetch the mask exactly as the admin UI would via GET.
    const getRes = await request(app)
      .get("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie);
    expect(getRes.status).toBe(200);
    const maskedAirlabs = getRes.body.globalAirlabsApiKey as string;
    expect(maskedAirlabs).toContain("****");

    // Simulate the real admin UI: PUT the ENTIRE form state, echoing the
    // masked AirLabs value back unchanged while adding a fresh logostream key.
    const putRes = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({
        globalAirlabsApiKey: maskedAirlabs,
        globalLogostreamApiKey: "c".repeat(20),
      });
    expect(putRes.status).toBe(200);

    // DB TRUTH check — not the masked response.
    const row = await prisma.adminSettings.findFirst();
    expect(decryptApiKey(row?.globalAirlabsApiKey ?? null)).toBe(REAL_KEY);
  });

  it("clears the AirLabs key when the UI sends an explicit empty string", async () => {
    const settingsId = (await prisma.adminSettings.findFirst())!.id;
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { globalAirlabsApiKey: encryptApiKey("some-real-key-1234567890") },
    });

    const putRes = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalAirlabsApiKey: "" });
    expect(putRes.status).toBe(200);

    const row = await prisma.adminSettings.findFirst();
    expect(row?.globalAirlabsApiKey).toBeNull();
  });

  it("stores a genuinely new AirLabs key sent by the UI", async () => {
    const NEW_KEY = "brand-new-airlabs-key-98765";

    const putRes = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ globalAirlabsApiKey: NEW_KEY });
    expect(putRes.status).toBe(200);

    const row = await prisma.adminSettings.findFirst();
    expect(decryptApiKey(row?.globalAirlabsApiKey ?? null)).toBe(NEW_KEY);
  });

  it("keeps stored OpenSky credentials when the UI echoes all four masked values back", async () => {
    const REAL_CLIENT_ID = "real-opensky-client-id-123";
    const REAL_CLIENT_SECRET = "real-opensky-client-secret-456";
    const REAL_USERNAME = "real-opensky-username-789";
    const REAL_PASSWORD = "real-opensky-password-000";

    const settingsId = (await prisma.adminSettings.findFirst())!.id;
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: {
        globalOpenskyClientId: encryptApiKey(REAL_CLIENT_ID),
        globalOpenskyClientSecret: encryptApiKey(REAL_CLIENT_SECRET),
        globalOpenskyUsername: encryptApiKey(REAL_USERNAME),
        globalOpenskyPassword: encryptApiKey(REAL_PASSWORD),
      },
    });

    const getRes = await request(app)
      .get("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie);
    expect(getRes.status).toBe(200);

    const putRes = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({
        globalOpenskyClientId: getRes.body.globalOpenskyClientId,
        globalOpenskyClientSecret: getRes.body.globalOpenskyClientSecret,
        globalOpenskyUsername: getRes.body.globalOpenskyUsername,
        globalOpenskyPassword: getRes.body.globalOpenskyPassword,
        // Also change an unrelated field in the same request, mirroring the
        // real UI's "save the whole form to change one thing" behaviour.
        globalAviationstackApiKey: "another-fresh-key-11223344",
      });
    expect(putRes.status).toBe(200);

    const row = await prisma.adminSettings.findFirst();
    expect(decryptApiKey(row?.globalOpenskyClientId ?? null)).toBe(REAL_CLIENT_ID);
    expect(decryptApiKey(row?.globalOpenskyClientSecret ?? null)).toBe(REAL_CLIENT_SECRET);
    expect(decryptApiKey(row?.globalOpenskyUsername ?? null)).toBe(REAL_USERNAME);
    expect(decryptApiKey(row?.globalOpenskyPassword ?? null)).toBe(REAL_PASSWORD);
    expect(decryptApiKey(row?.globalAviationstackApiKey ?? null)).toBe(
      "another-fresh-key-11223344",
    );
  });
});
