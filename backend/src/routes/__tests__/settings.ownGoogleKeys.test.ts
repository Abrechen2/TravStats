import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { resolveApiKey, hasApiKeyAccess } from "../../services/apiKeyResolver";
import { resolveLlmChain } from "../../services/llm/llmProvider";
import { ensureAdminSettings } from "../../services/instanceSettingsService";

// A saved key is tested at once; the test must not call Google.
jest.mock("../../services/externalServices/testRunner", () => ({
  ...jest.requireActual("../../services/externalServices/testRunner"),
  testAccountService: jest.fn().mockResolvedValue({ ok: true }),
}));

/**
 * Settings v3 own keys for Gemini and Google Places. The account's key is encrypted like
 * the other user keys and resolves BEFORE the instance's; the admin can still forbid
 * account keys for a service, and an account without one gets the instance key.
 */
describe("own Gemini and Google Places keys of an account", () => {
  const username = `own-google-${Date.now()}`;
  let userId: string;
  let cookie: string;
  let adminId: number;
  let original: Awaited<ReturnType<typeof ensureAdminSettings>>;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    original = await ensureAdminSettings();
    adminId = original.id;
  });
  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: {
        globalGooglePlacesApiKey: encryptApiKey("instance-places"),
        llmGoogleApiKey: encryptApiKey("instance-gemini"),
        llmGoogleOptIn: true,
        externalServicePolicy: {},
      },
    });
  });
  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: {
        globalGooglePlacesApiKey: original.globalGooglePlacesApiKey,
        llmGoogleApiKey: original.llmGoogleApiKey,
        llmGoogleOptIn: original.llmGoogleOptIn,
        externalServicePolicy: original.externalServicePolicy ?? {},
      },
    });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  const saveOwn = (service: "gemini" | "googlePlaces", apiKey: string) =>
    request(app)
      .put(`/api/v1/settings/external-services/${service}`)
      .set("Cookie", cookie)
      .send({ fields: { apiKey } });

  it("are written through the account route, encrypted at rest, and masked on the way out", async () => {
    const places = await saveOwn("googlePlaces", "my-places-key").expect(200);
    const gemini = await saveOwn("gemini", "my-gemini-key").expect(200);
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.googlePlacesApiKey).not.toContain("my-places-key");
    expect(decryptApiKey(row.googlePlacesApiKey)).toBe("my-places-key");
    expect(decryptApiKey(row.googleApiKey)).toBe("my-gemini-key");
    expect(places.body.configured).toBe(true);
    expect(JSON.stringify([places.body, gemini.body])).not.toMatch(/my-(places|gemini)-key/);
  });

  it("googlePlaces: the account's key wins for a lookup made for it, the instance's for everyone else", async () => {
    await saveOwn("googlePlaces", "my-places-key").expect(200);
    expect(await resolveApiKey("googlePlaces", userId)).toEqual({
      key: "my-places-key",
      source: "user",
    });
    expect(await resolveApiKey("googlePlaces")).toEqual({
      key: "instance-places",
      source: "global",
    });
    expect(await hasApiKeyAccess("googlePlaces", userId)).toEqual({
      hasAccess: true,
      isShared: false,
    });
  });

  it("gemini: the account's key wins; an account without one resolves the instance key", async () => {
    expect((await resolveApiKey("gemini", userId)).key).toBe("instance-gemini");
    await saveOwn("gemini", "my-gemini-key").expect(200);
    expect(await resolveApiKey("gemini", userId)).toEqual({ key: "my-gemini-key", source: "user" });
  });

  it("gemini: the LLM chain calls Google with the account's key, and with the instance's for others", async () => {
    await saveOwn("gemini", "my-gemini-key").expect(200);
    const mine = await resolveLlmChain({ userId, systemTask: true });
    expect(mine.find((t) => t.kind === "google")?.apiKey).toBe("my-gemini-key");
    const other = await resolveLlmChain({ systemTask: true });
    expect(other.find((t) => t.kind === "google")?.apiKey).toBe("instance-gemini");
  });

  it("the admin switching the service off, or forbidding account keys, stops the account's key", async () => {
    await saveOwn("googlePlaces", "my-places-key").expect(200);
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: { externalServicePolicy: { accountKeysForbidden: ["googlePlaces"] } },
    });
    expect((await resolveApiKey("googlePlaces", userId)).source).toBe("global");
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: { externalServicePolicy: { disabled: ["googlePlaces"] } },
    });
    expect(await resolveApiKey("googlePlaces", userId)).toMatchObject({ key: null, off: "admin" });
  });

  it("clearing the field removes the account's key and falls back to the instance's", async () => {
    await saveOwn("googlePlaces", "my-places-key").expect(200);
    await saveOwn("googlePlaces", "").expect(200);
    expect(
      (await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).googlePlacesApiKey
    ).toBeNull();
    expect((await resolveApiKey("googlePlaces", userId)).source).toBe("global");
  });
});
