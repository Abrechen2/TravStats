import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { resolveApiKey, hasApiKeyAccess } from "../../services/apiKeyResolver";
import { DEMO_USERNAME } from "../../utils/sharedDemo";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { assertLlmCloudConsent, llmRefusalFor } from "../../services/llm/llmGate";
import { getCachedLatestRelease, __resetUpdateCheckerCache } from "../../services/updateChecker";

const testAirlabsKey = jest.fn<(k: string) => Promise<unknown>>();
jest.mock("../../services/apiKeyTester", () => ({
  ...jest.requireActual<object>("../../services/apiKeyTester"),
  testAirlabsKey: (k: string) => testAirlabsKey(k),
}));

describe("external services (forgejo#392)", () => {
  let adminId: string;
  let userA: string;
  let userB: string;
  let adminCookie: string;
  let cookieA: string;
  let rowId: number;

  const mkUser = async (name: string, isAdmin = false) =>
    (
      await prisma.user.create({
        data: {
          username: `es-${name}-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isAdmin,
          isActive: true,
        },
      })
    ).id;

  const putAdmin = (id: string, body: object) =>
    request(app).put(`/api/v1/admin/external-services/${id}`).set("Cookie", adminCookie).send(body);
  const putAcct = (id: string, body: object, cookie = cookieA) =>
    request(app).put(`/api/v1/settings/external-services/${id}`).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    adminId = await mkUser("admin", true);
    userA = await mkUser("a");
    userB = await mkUser("b");
    adminCookie = `auth_token=${generateToken(adminId)}`;
    cookieA = `auth_token=${generateToken(userA)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    delete process.env.AIRLABS_API_KEY;
    delete process.env.IMMICH_BASE_URL;
    delete process.env.IMMICH_API_KEY;
    delete process.env.OLLAMA_URL;
    testAirlabsKey.mockReset();
    await prisma.externalServiceTest.deleteMany({});
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        externalServicePolicy: {},
        globalAirlabsApiKey: encryptApiKey("instance-airlabs-key-123456"),
        globalImmichBaseUrl: null,
        globalImmichApiKey: null,
        llmOpenaiApiKey: null,
        llmOpenaiOptIn: false,
        globalAeroapiApiKey: null,
        updateCheckEnabled: true,
        llmEnabled: true,
      },
    });
    for (const userId of [userA, userB]) {
      await prisma.userSettings.upsert({
        where: { userId },
        create: { userId, data: {} },
        update: {
          externalServicePrefs: {},
          airlabsApiKey: null,
          immichBaseUrl: null,
          immichApiKey: null,
        },
      });
    }
  });

  afterEach(() => {
    delete process.env.AIRLABS_API_KEY;
    delete process.env.IMMICH_BASE_URL;
    delete process.env.IMMICH_API_KEY;
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        externalServicePolicy: {},
        globalAirlabsApiKey: null,
        llmOpenaiApiKey: null,
        llmOpenaiOptIn: false,
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userA, userB] } } });
  });

  const setAccountKey = (userId: string, key = "account-airlabs-key-123456") =>
    prisma.userSettings.update({ where: { userId }, data: { airlabsApiKey: encryptApiKey(key) } });

  describe("admin view", () => {
    it("secrets are write-only: masked on read, the masked echo keeps the stored key (invariant 6)", async () => {
      const read = async () =>
        (await request(app).get("/api/v1/admin/external-services").set("Cookie", adminCookie)).body;
      const find = (body: {
        categories: Array<{
          services: Array<{
            id: string;
            fields: Array<{ key: string; value: unknown; masked?: boolean }>;
          }>;
        }>;
      }) => body.categories.flatMap((c) => c.services).find((s) => s.id === "airlabs")!;
      const before = find(await read()).fields.find((f) => f.key === "apiKey")!;
      expect(before.masked).toBe(true);
      expect(String(before.value)).toMatch(/^•••• /);
      expect(JSON.stringify(await read())).not.toContain("instance-airlabs-key-123456");

      await putAdmin("airlabs", { fields: { apiKey: before.value } }).expect(200);
      const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
      expect(row.globalAirlabsApiKey).toBe(
        (await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } })).globalAirlabsApiKey
      );
      expect((await resolveApiKey("airlabs")).key).toBe("instance-airlabs-key-123456");
    });

    it("lists every catalogue category with status dimensions (invariant 3)", async () => {
      const res = await request(app)
        .get("/api/v1/admin/external-services")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      const airlabs = res.body.categories
        .flatMap((c: { services: unknown[] }) => c.services)
        .find((s: { id: string }) => s.id === "airlabs");
      expect(airlabs).toMatchObject({
        enabled: true,
        configured: true,
        instanceSource: "instance",
        allowAccountKeys: true,
        lastTest: null,
      });
    });

    it("rejects an unknown field instead of ignoring it", async () => {
      const res = await putAdmin("airlabs", { fields: { apiKeey: "x" } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    });

    it("requires an admin", async () => {
      const res = await request(app).get("/api/v1/admin/external-services").set("Cookie", cookieA);
      expect(res.status).toBe(403);
    });
  });

  describe("resolver policy", () => {
    it("off means off: an admin-disabled service blocks the account key and the instance key (invariant 2); ENV is never read", async () => {
      await setAccountKey(userA);
      process.env.AIRLABS_API_KEY = "env-airlabs-key-123456";
      await putAdmin("airlabs", { enabled: false }).expect(200);

      const forAccount = await resolveApiKey("airlabs", userA);
      expect(forAccount).toMatchObject({ key: null, off: "admin" });
      expect((await resolveApiKey("airlabs")).key).toBeNull();
      expect((await hasApiKeyAccess("airlabs", userA)).hasAccess).toBe(false);

      await putAdmin("airlabs", { enabled: true }).expect(200);
      expect(await resolveApiKey("airlabs", userA)).toMatchObject({ source: "user" });
    });

    it("a forbidden account key is ignored and the instance key serves", async () => {
      await setAccountKey(userA);
      await putAdmin("airlabs", { allowAccountKeys: false }).expect(200);
      expect(await resolveApiKey("airlabs", userA)).toMatchObject({
        key: "instance-airlabs-key-123456",
        source: "global",
      });
    });

    it("removing the account key falls back to the instance key", async () => {
      await setAccountKey(userA);
      expect((await resolveApiKey("airlabs", userA)).source).toBe("user");
      const res = await putAcct("airlabs", { fields: { apiKey: "" } });
      expect(res.status).toBe(200);
      expect(await resolveApiKey("airlabs", userA)).toMatchObject({ source: "global" });
    });

    it("an account switching a service off stops it for that account only", async () => {
      await putAcct("airlabs", { accountDisabled: true }).expect(200);
      expect(await resolveApiKey("airlabs", userA)).toMatchObject({ key: null, off: "account" });
      expect((await resolveApiKey("airlabs", userB)).source).toBe("global");
    });

    it("Immich off blocks the instance tier too, and a forbidden connection ignores the account's own", async () => {
      process.env.IMMICH_BASE_URL = "https://env.example.com";
      process.env.IMMICH_API_KEY = "env-immich-key";
      expect(await getImmichConnection(userA)).toBeNull();
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: {
          globalImmichBaseUrl: "https://immich.example.com",
          globalImmichApiKey: encryptApiKey("instance-immich-key-1234"),
        },
      });
      expect((await getImmichConnection(userA))?.source).toBe("global");

      await prisma.userSettings.update({
        where: { userId: userA },
        data: {
          immichBaseUrl: "https://mine.example.com",
          immichApiKey: encryptApiKey("my-immich-key-1234567"),
        },
      });
      expect((await getImmichConnection(userA))?.source).toBe("user");
      await request(app)
        .put("/api/v1/admin/external-services/connections/immich")
        .set("Cookie", adminCookie)
        .send({ allowed: false })
        .expect(200);
      expect((await getImmichConnection(userA))?.source).toBe("global");

      await putAdmin("immich", { enabled: false }).expect(200);
      expect(await getImmichConnection(userA)).toBeNull();
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { globalImmichBaseUrl: null, globalImmichApiKey: null },
      });
    });

    it("the shared demo account still resolves nothing when account connections are forbidden", async () => {
      process.env.IMMICH_BASE_URL = "https://immich.example.com";
      process.env.IMMICH_API_KEY = "env-immich-key";
      const original = await prisma.user.findUniqueOrThrow({ where: { id: userB } });
      await prisma.user.update({
        where: { id: userB },
        data: { isDemo: true, username: DEMO_USERNAME },
      });
      try {
        await request(app)
          .put("/api/v1/admin/external-services/connections/immich")
          .set("Cookie", adminCookie)
          .send({ allowed: false })
          .expect(200);
        expect(await getImmichConnection(userB)).toBeNull();
      } finally {
        await prisma.user.update({
          where: { id: userB },
          data: { isDemo: original.isDemo, username: original.username },
        });
      }
    });

    it("the GitHub release check honours its admin switch and calls nothing when off", async () => {
      __resetUpdateCheckerCache();
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { updateCheckEnabled: false },
      });
      const fetchSpy = jest.spyOn(global, "fetch");
      expect(await getCachedLatestRelease()).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("account routes", () => {
    it("forbidden account keys answer 403 ACCOUNT_KEYS_NOT_ALLOWED", async () => {
      await putAdmin("airlabs", { allowAccountKeys: false }).expect(200);
      const res = await putAcct("airlabs", { fields: { apiKey: "abcdefghijklmnop" } });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_KEYS_NOT_ALLOWED");
    });

    it("a forbidden connection answers 403 CONNECTION_NOT_ALLOWED and is not listed", async () => {
      await request(app)
        .put("/api/v1/admin/external-services/connections/immich")
        .set("Cookie", adminCookie)
        .send({ allowed: false })
        .expect(200);
      const res = await putAcct("immich", { fields: { baseUrl: "https://x.example.com" } });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("CONNECTION_NOT_ALLOWED");
      const view = await request(app)
        .get("/api/v1/settings/external-services")
        .set("Cookie", cookieA);
      expect(view.body.connections.map((c: { id: string }) => c.id)).not.toContain("immich");
    });

    it("AeroAPI is instance-only: provided by the instance, never an own-key service (invariant 7)", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { globalAeroapiApiKey: encryptApiKey("instance-aeroapi-key-123456") },
      });
      const view = await request(app)
        .get("/api/v1/settings/external-services")
        .set("Cookie", cookieA);
      expect(view.body.ownKeys.map((s: { id: string }) => s.id)).not.toContain("aeroapi");
      expect(view.body.instanceProvided.map((s: { id: string }) => s.id)).toContain("aeroapi");
    });

    it("the effective source is shown: account → instance → none, never env (invariant 1)", async () => {
      const source = async () =>
        (
          await request(app).get("/api/v1/settings/external-services").set("Cookie", cookieA)
        ).body.ownKeys.find((s: { id: string }) => s.id === "airlabs").effectiveSource;
      expect(await source()).toBe("instance");
      await setAccountKey(userA);
      expect(await source()).toBe("account");
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { globalAirlabsApiKey: null },
      });
      await prisma.userSettings.update({ where: { userId: userA }, data: { airlabsApiKey: null } });
      expect(await source()).toBe("none");
      process.env.AIRLABS_API_KEY = "env-airlabs-key-123456";
      expect(await source()).toBe("none");
      await putAcct("airlabs", { accountDisabled: true }).expect(200);
      expect(await source()).toBe("off");
    });

    it("saving an own key tests it and persists lastTest with a stable reason code", async () => {
      testAirlabsKey.mockResolvedValue({ success: false, message: "bad", messageKey: "invalid" });
      const res = await putAcct("airlabs", { fields: { apiKey: "account-airlabs-key-123456" } });
      expect(res.status).toBe(200);
      expect(testAirlabsKey).toHaveBeenCalledWith("account-airlabs-key-123456");
      expect(res.body.lastTest).toMatchObject({ ok: false, reason: "auth" });
      const view = await request(app)
        .get("/api/v1/settings/external-services")
        .set("Cookie", cookieA);
      expect(
        view.body.ownKeys.find((s: { id: string }) => s.id === "airlabs").lastTest.reason
      ).toBe("auth");
    });
  });

  describe("tests", () => {
    it("a disabled service answers 409 SERVICE_DISABLED without calling out", async () => {
      await putAdmin("airlabs", { enabled: false }).expect(200);
      const res = await request(app)
        .post("/api/v1/admin/external-services/airlabs/test")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SERVICE_DISABLED");
      expect(testAirlabsKey).not.toHaveBeenCalled();
    });

    it("persists the instance verdict and reports usedQuota", async () => {
      testAirlabsKey.mockResolvedValue({ success: true, message: "ok", messageKey: "valid" });
      const res = await request(app)
        .post("/api/v1/admin/external-services/airlabs/test")
        .set("Cookie", adminCookie);
      expect(res.body).toMatchObject({ ok: true, reason: null, usedQuota: true });
      const list = await request(app)
        .get("/api/v1/admin/external-services")
        .set("Cookie", adminCookie);
      const airlabs = list.body.categories
        .flatMap((c: { services: unknown[] }) => c.services)
        .find((s: { id: string }) => s.id === "airlabs");
      expect(airlabs.lastTest).toMatchObject({ ok: true, reason: null });
    });
  });

  describe("cloud AI consent (invariant 4)", () => {
    const enableOpenai = () =>
      putAdmin("openai", {
        enabled: true,
        confirmDataSharing: true,
        fields: { apiKey: "sk-test-0123456789abcdef0123" },
      });

    it("enabling a cloud provider without the confirmation is 400 CONSENT_REQUIRED", async () => {
      const res = await putAdmin("openai", {
        enabled: true,
        fields: { apiKey: "sk-test-0123456789abcdef0123" },
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CONSENT_REQUIRED");
      expect(
        (await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } })).llmOpenaiOptIn
      ).toBe(false);
    });

    it("documents go to a cloud provider only after THAT account consented, per provider", async () => {
      await enableOpenai().expect(200);
      expect((await llmRefusalFor(userA))?.kind).toBe("cloud_not_consented");
      // Consent to a different provider does not help.
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: {
          llmAnthropicApiKey: encryptApiKey("sk-ant-0123456789abcdef0123"),
          llmAnthropicOptIn: true,
        },
      });
      const other = await request(app)
        .put("/api/v1/settings/external-services/ai-consent/anthropic")
        .set("Cookie", cookieA)
        .send({ consent: true });
      expect(other.status).toBe(200);
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { llmAnthropicApiKey: null, llmAnthropicOptIn: false },
      });
      expect((await llmRefusalFor(userA))?.kind).toBe("cloud_not_consented");

      await request(app)
        .put("/api/v1/settings/external-services/ai-consent/openai")
        .set("Cookie", cookieA)
        .send({ consent: true })
        .expect(200);
      expect(await llmRefusalFor(userA)).toBeNull();
      // Another account is still refused; a system task without an account is not.
      expect((await llmRefusalFor(userB))?.kind).toBe("cloud_not_consented");
      expect(await llmRefusalFor()).toBeNull();
    });

    it("the last line refuses a cloud request for an account that has not consented", async () => {
      await enableOpenai().expect(200);
      const target = { kind: "openai" as const, isCloud: true };
      await expect(assertLlmCloudConsent(target, { userId: userA })).rejects.toMatchObject({
        code: "LLM_CLOUD_NOT_CONSENTED",
      });
      await request(app)
        .put("/api/v1/settings/external-services/ai-consent/openai")
        .set("Cookie", cookieA)
        .send({ consent: true })
        .expect(200);
      await expect(assertLlmCloudConsent(target, { userId: userA })).resolves.toBeUndefined();
      await request(app)
        .put("/api/v1/settings/external-services/ai-consent/openai")
        .set("Cookie", cookieA)
        .send({ consent: false })
        .expect(200);
      await expect(assertLlmCloudConsent(target, { userId: userA })).rejects.toMatchObject({
        code: "LLM_CLOUD_NOT_CONSENTED",
      });
    });

    it("an account cannot consent to a provider the admin has not allowed", async () => {
      const res = await request(app)
        .put("/api/v1/settings/external-services/ai-consent/openai")
        .set("Cookie", cookieA)
        .send({ consent: true });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SERVICE_DISABLED");
    });

    it("lists only admin-allowed providers, with their destination", async () => {
      await enableOpenai().expect(200);
      const view = await request(app)
        .get("/api/v1/settings/external-services")
        .set("Cookie", cookieA);
      expect(view.body.aiConsents).toEqual([
        { id: "openai", provider: "openai", destination: "api.openai.com", consentedAt: null },
      ]);
    });
  });
});
