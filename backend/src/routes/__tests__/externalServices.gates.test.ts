import { describe, it, expect, beforeAll, beforeEach, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { ownDawarichConnectionFor } from "../../services/dawarich/dawarichResolver";
import { ownConnection } from "../../services/dawarich/stays/scanSource";
import { getLocationProviderChoices } from "../../services/locationProvider/provider";
import { getStravaAccessToken } from "../../services/strava/stravaConnection";
import { runWebdavSync } from "../../services/webdavSync/runSync";
import { dueWebdavSyncs } from "../../jobs/webdavSyncScheduler";
import { llmGenerate, resolveLlmChain } from "../../services/llm/llmProvider";
import { assertLlmCloudConsent } from "../../services/llm/llmGate";

/**
 * forgejo#392 — the policy must hold on EVERY path that uses a connection or a
 * model, not only the one the façade happens to call. One test per path; each
 * fails when its gate is removed.
 */
describe("external services policy on every path", () => {
  let adminId: string;
  let userId: string;
  let adminCookie: string;
  let cookie: string;
  let rowId: number;

  const adminPut = (path: string, body: object) =>
    request(app)
      .put(`/api/v1/admin/external-services/${path}`)
      .set("Cookie", adminCookie)
      .send(body);
  const forbid = (id: string) => adminPut(`connections/${id}`, { allowed: false }).expect(200);
  const disable = (id: string) => adminPut(id, { enabled: false }).expect(200);

  const mk = async (name: string, isAdmin = false) =>
    (
      await prisma.user.create({
        data: {
          username: `esg-${name}-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isAdmin,
          isActive: true,
        },
      })
    ).id;

  beforeAll(async () => {
    adminId = await mk("admin", true);
    userId = await mk("user");
    adminCookie = `auth_token=${generateToken(adminId)}`;
    cookie = `auth_token=${generateToken(userId)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        externalServicePolicy: {},
        llmOpenaiApiKey: encryptApiKey("sk-test-0123456789abcdef0123"),
        llmOpenaiOptIn: true,
      },
    });
    await prisma.userWebdavSync.deleteMany({ where: { userId } });
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {} },
      update: {},
    });
    await prisma.userSettings.update({
      where: { userId },
      data: {
        externalServicePrefs: {},
        dawarichBaseUrl: "https://dawarich.example.com",
        dawarichApiKey: encryptApiKey("dawarich-key-0123456789"),
        stravaAccessToken: encryptApiKey("strava-access-0123456789"),
        stravaRefreshToken: encryptApiKey("strava-refresh-0123456789"),
        stravaTokenExpiresAt: new Date(Date.now() + 3_600_000),
        immichBaseUrl: null,
        immichApiKey: null,
        airlabsApiKey: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { externalServicePolicy: {}, llmOpenaiApiKey: null, llmOpenaiOptIn: false },
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  });

  const dawarichRow = () =>
    prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { dawarichBaseUrl: true, dawarichApiKey: true },
    });

  describe("Dawarich: the account's own connection", () => {
    it("is built when nothing forbids it", async () => {
      const row = await dawarichRow();
      expect(
        await ownDawarichConnectionFor(userId, row.dawarichBaseUrl, row.dawarichApiKey)
      ).not.toBeNull();
    });

    it.each([
      ["admin switched Dawarich off", () => disable("dawarich")],
      ["admin forbade account connections", () => forbid("dawarich")],
    ])(
      "is not built when the %s (stay scan, location provider, sweep share this gate)",
      async (_n, apply) => {
        await apply();
        const row = await dawarichRow();
        expect(
          await ownDawarichConnectionFor(userId, row.dawarichBaseUrl, row.dawarichApiKey)
        ).toBeNull();
        await expect(ownConnection(userId)).rejects.toMatchObject({
          code: "DAWARICH_OWN_CONNECTION_REQUIRED",
        });
        expect((await getLocationProviderChoices(userId)).dawarich).toBe(false);
      }
    );

    it("is not built when the account switched it off for itself", async () => {
      await request(app)
        .put("/api/v1/settings/external-services/dawarich")
        .set("Cookie", cookie)
        .send({ accountDisabled: true })
        .expect(200);
      const row = await dawarichRow();
      expect(
        await ownDawarichConnectionFor(userId, row.dawarichBaseUrl, row.dawarichApiKey)
      ).toBeNull();
    });
  });

  describe("Strava", () => {
    it("serves a token while allowed", async () => {
      expect(await getStravaAccessToken(userId)).toBe("strava-access-0123456789");
    });
    it("refuses a stored token once the admin forbade connections", async () => {
      await forbid("strava");
      await expect(getStravaAccessToken(userId)).rejects.toMatchObject({ kind: "notConfigured" });
    });
    it("refuses a stored token once the admin switched Strava off", async () => {
      await disable("strava");
      await expect(getStravaAccessToken(userId)).rejects.toMatchObject({ kind: "notConfigured" });
    });
    it("refuses the OAuth start for a forbidden connection", async () => {
      await forbid("strava");
      const res = await request(app)
        .post("/api/v1/integrations/strava/authorize")
        .set("Cookie", cookie)
        .send({ redirectUri: "http://localhost:3000/strava" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("CONNECTION_NOT_ALLOWED");
    });
  });

  describe("WebDAV sync", () => {
    const seed = () =>
      prisma.userWebdavSync.create({
        data: {
          userId,
          enabled: true,
          url: "https://dav.example.com/remote.php/dav",
          username: "u",
          passwordEncrypted: encryptApiKey("pw-0123456789"),
        },
      });

    it("the scheduler leaves out an account whose connection is forbidden or switched off by the account", async () => {
      await seed();
      expect(await dueWebdavSyncs(new Date())).toContain(userId);
      await forbid("webdav");
      expect(await dueWebdavSyncs(new Date())).not.toContain(userId);
      await adminPut("connections/webdav", { allowed: true }).expect(200);
      await request(app)
        .put("/api/v1/settings/external-services/webdav")
        .set("Cookie", cookie)
        .send({ accountDisabled: true })
        .expect(200);
      expect(await dueWebdavSyncs(new Date())).not.toContain(userId);
    });

    it("the runner refuses a forbidden connection however it was started", async () => {
      await seed();
      await forbid("webdav");
      await expect(runWebdavSync(userId)).rejects.toMatchObject({ code: "notConfigured" });
    });
  });

  describe("legacy settings write routes", () => {
    it("PUT /settings/immich is refused for a forbidden connection, but clearing is allowed", async () => {
      await forbid("immich");
      const set = await request(app)
        .put("/api/v1/settings/immich")
        .set("Cookie", cookie)
        .send({ baseUrl: "https://immich.example.com", apiKey: "immich-key-0123456789" });
      expect(set.status).toBe(403);
      expect(set.body.code).toBe("CONNECTION_NOT_ALLOWED");
      const clear = await request(app)
        .put("/api/v1/settings/immich")
        .set("Cookie", cookie)
        .send({ baseUrl: null, apiKey: null });
      expect(clear.status).not.toBe(403);
    });

    it("PUT /settings/dawarich is refused when the admin switched Dawarich off", async () => {
      await disable("dawarich");
      const res = await request(app)
        .put("/api/v1/settings/dawarich")
        .set("Cookie", cookie)
        .send({ baseUrl: "https://d.example.com", apiKey: "dawarich-key-0123456789" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SERVICE_DISABLED");
    });

    it("PUT /settings/api-keys refuses an own key for a service whose account keys are forbidden", async () => {
      await adminPut("airlabs", { allowAccountKeys: false }).expect(200);
      const res = await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", cookie)
        .send({ airlabsApiKey: "account-airlabs-key-123456" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_KEYS_NOT_ALLOWED");
      const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
      expect(row.airlabsApiKey).toBeNull();
    });

    it("PUT /settings/webdav-sync is refused for a forbidden connection", async () => {
      await forbid("webdav");
      const res = await request(app)
        .put("/api/v1/settings/webdav-sync")
        .set("Cookie", cookie)
        .send({
          enabled: true,
          url: "https://dav.example.com/x",
          username: "u",
          password: "pw-0123456789",
        });
      expect(res.status).toBe(403);
    });
  });

  describe("language models fail closed on the account (invariant 4)", () => {
    const cloud = { kind: "openai" as const, isCloud: true };
    const openai = {
      kind: "openai" as const,
      url: "https://api.openai.com/v1",
      model: "m",
      apiKey: "k",
      isCloud: true,
    };
    const req = { system: "s", prompt: "p", temperature: 0, json: false, timeoutMs: 1000 };

    it("a request naming neither an account nor a system task never reaches a cloud target", async () => {
      await expect(llmGenerate(openai, req)).rejects.toMatchObject({
        code: "LLM_CLOUD_NOT_CONSENTED",
      });
      await expect(assertLlmCloudConsent(cloud)).rejects.toMatchObject({
        code: "LLM_CLOUD_NOT_CONSENTED",
      });
    });

    it("a user path without that account's consent is refused before any request is sent", async () => {
      await expect(llmGenerate(openai, { ...req, userId })).rejects.toMatchObject({
        code: "LLM_CLOUD_NOT_CONSENTED",
      });
    });

    it("changing the custom endpoint's address withdraws every account's consent for it", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: {
          openaiCompatBaseUrl: "https://llm-a.example.com/v1",
          openaiCompatModel: "m",
          llmCustomOptIn: true,
        },
      });
      await prisma.userSettings.update({
        where: { userId },
        data: {
          externalServicePrefs: {
            disabled: [],
            aiConsent: {
              custom: {
                at: "2026-10-30T00:00:00.000Z",
                destination: "https://llm-a.example.com/v1",
              },
              openai: { at: "2026-10-30T00:00:00.000Z", destination: "https://api.openai.com" },
            },
          },
        },
      });
      await adminPut("customLlm", { fields: { baseUrl: "https://llm-b.example.com/v1" } }).expect(
        200
      );
      const prefs = (await prisma.userSettings.findUniqueOrThrow({ where: { userId } }))
        .externalServicePrefs as {
        aiConsent: Record<string, unknown>;
      };
      expect(prefs.aiConsent.custom).toBeUndefined();
      expect(prefs.aiConsent.openai).toBeDefined();
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { openaiCompatBaseUrl: null, openaiCompatModel: null, llmCustomOptIn: false },
      });
    });

    it("a switched-off Ollama is refused at the last line even as a fallback target", async () => {
      await disable("ollama");
      await expect(
        llmGenerate(
          { kind: "ollama", url: "http://localhost:11434", model: "m", isCloud: false },
          { ...req, systemTask: true }
        )
      ).rejects.toMatchObject({ code: "LLM_DISABLED" });
    });

    it("an explicit system task passes the gate", async () => {
      await expect(assertLlmCloudConsent(cloud, { systemTask: true })).resolves.toBeUndefined();
    });

    it("the chain leaves cloud targets out for a caller without account or system flag, and for an unconsented account", async () => {
      const kinds = async (o: Parameters<typeof resolveLlmChain>[0]) =>
        (await resolveLlmChain(o)).map((t) => t.kind);
      expect(await kinds({})).not.toContain("openai");
      expect(await kinds({ userId })).not.toContain("openai");
      expect(await kinds({ systemTask: true })).toContain("openai");
      await prisma.userSettings.update({
        where: { userId },
        data: {
          externalServicePrefs: {
            disabled: [],
            aiConsent: {
              openai: { at: new Date().toISOString(), destination: "https://api.openai.com" },
            },
          },
        },
      });
      expect(await kinds({ userId })).toContain("openai");
    });
  });
});
