import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  jest,
} from "@jest/globals";
import request from "supertest";
import fs from "fs";
import path from "path";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveLlmChain } from "../../services/llm/llmProvider";
import { llmRefusalFor } from "../../services/llm/llmGate";
import { resolveRailLlmChain } from "../../services/rail/parser/railLlmParser";

const testAirlabsKey = jest.fn<(k: string) => Promise<unknown>>();
jest.mock("../../services/apiKeyTester", () => ({
  ...jest.requireActual<object>("../../services/apiKeyTester"),
  testAirlabsKey: (k: string) => testAirlabsKey(k),
}));

/**
 * forgejo#392 follow-up: an account's AI consent is bound to the address it
 * was given for (invariant 2), the rail chain fails closed itself (invariant
 * 4), the legacy key-test routes honour "off", and the custom endpoint's
 * switch holds for a local address too.
 */
describe("external services: consent binding and off-means-off follow-ups", () => {
  let adminId: string;
  let userId: string;
  let adminCookie: string;
  let cookie: string;
  let rowId: number;
  const envOllama = process.env.OLLAMA_URL;

  const mk = async (name: string, isAdmin = false) =>
    (
      await prisma.user.create({
        data: {
          username: `escb-${name}-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isAdmin,
          isActive: true,
        },
      })
    ).id;
  const setAdmin = (data: object) => prisma.adminSettings.update({ where: { id: rowId }, data });
  const consent = (body: object) =>
    request(app)
      .put("/api/v1/settings/external-services/ai-consent/custom")
      .set("Cookie", cookie)
      .send(body);
  const view = async () =>
    (await request(app).get("/api/v1/settings/external-services").set("Cookie", cookie)).body;

  beforeAll(async () => {
    adminId = await mk("admin", true);
    userId = await mk("user");
    adminCookie = `auth_token=${generateToken(adminId)}`;
    cookie = `auth_token=${generateToken(userId)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    delete process.env.OLLAMA_URL;
    testAirlabsKey.mockReset();
    await setAdmin({
      externalServicePolicy: {},
      ollamaUrl: null,
      ollamaModel: null,
      llmEnabled: true,
      openaiCompatBaseUrl: "https://llm-a.example.com/v1",
      openaiCompatModel: "m",
      llmCustomOptIn: true,
    });
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {} },
      update: {},
    });
    await prisma.userSettings.update({ where: { userId }, data: { externalServicePrefs: {} } });
  });

  afterEach(() => {
    if (envOllama === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = envOllama;
  });

  afterAll(async () => {
    await setAdmin({
      externalServicePolicy: {},
      openaiCompatBaseUrl: null,
      openaiCompatModel: null,
      llmCustomOptIn: false,
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  });

  describe("invariant 2: consent is bound to its destination", () => {
    it("a consent stays valid for the address it was given for", async () => {
      await consent({ consent: true, destination: "llm-a.example.com" }).expect(200);
      expect(await llmRefusalFor(userId)).toBeNull();
      expect((await view()).aiConsents[0].consentedAt).not.toBeNull();
    });

    it("a consent given for address A does not count after the address moved to B, even if no withdrawal ran", async () => {
      await consent({ consent: true }).expect(200);
      // The address moves behind the withdrawal's back (the race): only the
      // binding can still protect the account.
      await setAdmin({ openaiCompatBaseUrl: "https://llm-b.example.com/v1" });
      expect((await llmRefusalFor(userId))?.kind).toBe("cloud_not_consented");
      expect((await resolveLlmChain({ userId })).map((t) => t.kind)).not.toContain("custom");
      expect((await view()).aiConsents[0].consentedAt).toBeNull();
    });

    it("a grant for an address the account saw, but which has since moved, is refused", async () => {
      await setAdmin({ openaiCompatBaseUrl: "https://llm-b.example.com/v1" });
      const res = await consent({ consent: true, destination: "llm-a.example.com" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DESTINATION_CHANGED");
      expect((await llmRefusalFor(userId))?.kind).toBe("cloud_not_consented");
    });

    it("a bare-date consent from before the binding is invalid", async () => {
      await prisma.userSettings.update({
        where: { userId },
        data: {
          externalServicePrefs: { disabled: [], aiConsent: { custom: "2026-10-30T00:00:00Z" } },
        },
      });
      expect((await llmRefusalFor(userId))?.kind).toBe("cloud_not_consented");
      expect((await view()).aiConsents[0].consentedAt).toBeNull();
    });
  });

  describe("invariant 4: the rail chain fails closed itself", () => {
    it("does not rebuild a remote OLLAMA_URL the resolver rejected for missing consent", async () => {
      await setAdmin({ openaiCompatBaseUrl: null, openaiCompatModel: null, llmCustomOptIn: false });
      process.env.OLLAMA_URL = "https://ollama.remote.example.com";
      process.env.OLLAMA_MODEL = "m";
      expect(await resolveRailLlmChain(userId)).toEqual([]);
      delete process.env.OLLAMA_MODEL;
    });

    it("still falls back to a LOCAL default when nothing is configured", async () => {
      await setAdmin({ openaiCompatBaseUrl: null, openaiCompatModel: null, llmCustomOptIn: false });
      const chain = await resolveRailLlmChain(userId);
      expect(chain.map((t) => t.kind)).toEqual(["ollama"]);
    });
  });

  describe("invariant 4: legacy key-test routes honour off", () => {
    it("the admin route answers 409 SERVICE_DISABLED without calling the provider", async () => {
      await setAdmin({ externalServicePolicy: { disabled: ["airlabs"] } });
      const res = await request(app)
        .post("/api/v1/admin/api-keys/test/airlabs")
        .set("Cookie", adminCookie)
        .send({ apiKey: "some-new-key-0123456789" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SERVICE_DISABLED");
      expect(testAirlabsKey).not.toHaveBeenCalled();
    });

    it("the account route answers 409 SERVICE_DISABLED when the account switched the service off", async () => {
      await prisma.userSettings.update({
        where: { userId },
        data: { externalServicePrefs: { disabled: ["airlabs"], aiConsent: {} } },
      });
      const res = await request(app)
        .post("/api/v1/settings/api-keys/test/airlabs")
        .set("Cookie", cookie)
        .send({ apiKey: "some-new-key-0123456789" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SERVICE_DISABLED");
      expect(testAirlabsKey).not.toHaveBeenCalled();
    });

    it("the account route answers 409 when the admin switched the service off", async () => {
      await setAdmin({ externalServicePolicy: { disabled: ["airlabs"] } });
      const res = await request(app)
        .post("/api/v1/settings/api-keys/test/airlabs")
        .set("Cookie", cookie)
        .send({ apiKey: "some-new-key-0123456789" });
      expect(res.status).toBe(409);
      expect(testAirlabsKey).not.toHaveBeenCalled();
    });
  });

  describe("invariant 4: the custom endpoint's switch holds for a local address", () => {
    it("a local custom endpoint with its switch off is not in the chain; on, it is", async () => {
      await setAdmin({ openaiCompatBaseUrl: "http://192.168.1.50:8000/v1", llmCustomOptIn: false });
      expect((await resolveLlmChain({ systemTask: true })).map((t) => t.kind)).not.toContain(
        "custom"
      );
      await setAdmin({ llmCustomOptIn: true });
      expect((await resolveLlmChain({ systemTask: true })).map((t) => t.kind)).toContain("custom");
    });

    describe("migration 20261030160000 keeps a working local endpoint working", () => {
      const sql = fs
        .readFileSync(
          path.join(
            __dirname,
            "../../../prisma/migrations/20261030160000_custom_llm_local_enabled/migration.sql"
          ),
          "utf-8"
        )
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      const cases: Array<[string, boolean]> = [
        ["http://192.168.178.155:8000/v1", true],
        ["http://localhost:11434/v1", true],
        ["http://[::1]:8000/v1", true],
        ["http://nas:8000/v1", true],
        ["http://llm.home.arpa/v1", true],
        ["https://openrouter.ai/api/v1", false],
        ["https://172.32.0.1/v1", false],
        ["https://[2001:db8::1]/v1", false],
      ];
      it.each(cases)("%s -> switched on: %s", async (url, expected) => {
        await prisma.$executeRawUnsafe("CREATE SCHEMA IF NOT EXISTS migtest_customllm");
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL search_path TO migtest_customllm");
            await tx.$executeRawUnsafe(
              "CREATE TABLE admin_settings (id SERIAL PRIMARY KEY, llm_custom_opt_in BOOLEAN NOT NULL DEFAULT false, openai_compat_base_url TEXT)"
            );
            await tx.$executeRawUnsafe(
              "INSERT INTO admin_settings (openai_compat_base_url) VALUES ($1), (NULL), ('')",
              url
            );
            await tx.$executeRawUnsafe(sql);
            const rows = await tx.$queryRawUnsafe<Array<{ on: boolean; u: string | null }>>(
              "SELECT llm_custom_opt_in AS on, openai_compat_base_url AS u FROM admin_settings ORDER BY id"
            );
            expect(rows[0].on).toBe(expected);
            expect(rows[1].on).toBe(false);
            expect(rows[2].on).toBe(false);
            throw new Error("rollback");
          });
        } catch (e) {
          if ((e as Error).message !== "rollback") throw e;
        } finally {
          await prisma.$executeRawUnsafe("DROP SCHEMA IF EXISTS migtest_customllm CASCADE");
        }
      });
    });
  });
});
