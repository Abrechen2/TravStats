import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { encryptApiKey } from "../../../utils/encryption";
import * as llmProviderModule from "../../../services/llm/llmProvider";

/**
 * The admin route for the three FIXED-endpoint cloud slots (openai/
 * anthropic/google): masked-key round trip, and "Verbindung testen" reading
 * the right stored key and asking the right fixed URL — never the real
 * internet. `llmProbe` is spied rather than called: the slot's base URL is
 * NOT admin-configurable (that is the whole point of "fixed"), so there is
 * no loopback substitute to redirect it to, the way `llmProvider.namedSlots
 * .test.ts` does for the request-SHAPE tests at the protocol layer below
 * this route. This test is the layer above: did the ROUTE pick the right
 * URL and the right stored key for the kind it was asked about.
 */

let adminSettingsId: number;
let createdRow = false;
let snapshot: Record<string, unknown> | null = null;
let adminId: string;
let adminCookie: string;

beforeAll(async () => {
  const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
  if (row) {
    adminSettingsId = row.id;
    snapshot = {
      llmOpenaiApiKey: row.llmOpenaiApiKey,
      llmOpenaiModel: row.llmOpenaiModel,
      llmOpenaiOptIn: row.llmOpenaiOptIn,
      llmAnthropicApiKey: row.llmAnthropicApiKey,
      llmAnthropicModel: row.llmAnthropicModel,
      llmAnthropicOptIn: row.llmAnthropicOptIn,
      llmGoogleApiKey: row.llmGoogleApiKey,
      llmGoogleModel: row.llmGoogleModel,
      llmGoogleOptIn: row.llmGoogleOptIn,
    };
  } else {
    adminSettingsId = (await prisma.adminSettings.create({ data: {} })).id;
    createdRow = true;
  }

  await prisma.user.deleteMany({ where: { username: "llmnamedslots_admin" } });
  const admin = await prisma.user.create({
    data: {
      username: "llmnamedslots_admin",
      passwordHash: await hashPassword("pw123456"),
      isAdmin: true,
    },
  });
  adminId = admin.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: adminId } });
  if (createdRow) await prisma.adminSettings.delete({ where: { id: adminSettingsId } });
  else if (snapshot)
    await prisma.adminSettings.update({ where: { id: adminSettingsId }, data: snapshot });
});

afterEach(() => jest.restoreAllMocks());

describe("masked-key round trip, per named slot", () => {
  it.each(["Openai", "Anthropic", "Google"] as const)(
    "%s: GET masks the key, and PUTting the masked echo back keeps the stored one",
    async (Slot) => {
      const field = `llm${Slot}ApiKey`;
      const secret = "sk-test-0123456789abcdef";
      await prisma.adminSettings.update({
        where: { id: adminSettingsId },
        data: { [field]: encryptApiKey(secret) },
      });

      const get = await request(app)
        .get("/api/v1/admin/parser-settings")
        .set("Cookie", adminCookie);
      expect(get.status).toBe(200);
      expect(get.body[field]).toBe("sk-t****cdef");
      expect(JSON.stringify(get.body)).not.toContain(secret);

      const put = await request(app)
        .put("/api/v1/admin/parser-settings")
        .set("Cookie", adminCookie)
        .send({ [field]: get.body[field] });
      expect(put.status).toBe(200);

      const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: adminSettingsId } });
      expect((row as unknown as Record<string, string | null>)[`llm${Slot}ApiKey`]).not.toBeNull();
      expect((row as unknown as Record<string, string | null>)[`llm${Slot}ApiKey`]).not.toContain(
        secret
      );
    }
  );

  it("an empty string clears a stored key", async () => {
    await prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: { llmOpenaiApiKey: encryptApiKey("sk-to-clear") },
    });
    const put = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ llmOpenaiApiKey: "" });
    expect(put.status).toBe(200);
    expect(put.body.settings.llmOpenaiApiKey).toBeNull();
  });
});

describe("'Verbindung testen' per named slot — the route picks the right URL and the right stored key", () => {
  it.each([
    ["openai", "llmOpenaiApiKey", "https://api.openai.com/v1"],
    ["anthropic", "llmAnthropicApiKey", "https://api.anthropic.com/v1"],
    ["google", "llmGoogleApiKey", "https://generativelanguage.googleapis.com/v1beta/openai"],
  ] as const)(
    "%s: probes the fixed URL with the freshly-typed key",
    async (kind, field, expectedUrl) => {
      const probe = jest
        .spyOn(llmProviderModule, "llmProbe")
        .mockResolvedValue({ reachable: true, models: ["test-model"] });

      const res = await request(app)
        .post("/api/v1/admin/test-llm-provider")
        .set("Cookie", adminCookie)
        .send({ kind, model: "test-model", apiKey: "sk-fresh-000000000000" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, isCloud: true, modelFound: true });
      expect(probe).toHaveBeenCalledWith(
        expect.objectContaining({
          kind,
          url: expectedUrl,
          apiKey: "sk-fresh-000000000000",
          isCloud: true,
        })
      );
      void field;
    }
  );

  it("a masked echo reads back the STORED key for that slot, not a different one", async () => {
    await prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: {
        llmOpenaiApiKey: encryptApiKey("sk-openai-secret-0000"),
        llmAnthropicApiKey: encryptApiKey("sk-anthropic-secret-0000"),
      },
    });
    const probe = jest
      .spyOn(llmProviderModule, "llmProbe")
      .mockResolvedValue({ reachable: true, models: [] });

    await request(app)
      .post("/api/v1/admin/test-llm-provider")
      .set("Cookie", adminCookie)
      .send({ kind: "anthropic", model: "m", apiKey: "sk-a****0000" });

    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "anthropic", apiKey: "sk-anthropic-secret-0000" })
    );
  });

  it("an unreachable slot answers 'unreachable', never a silent ok", async () => {
    jest.spyOn(llmProviderModule, "llmProbe").mockResolvedValue({
      reachable: false,
      models: [],
      error: "OpenAI availability check timeout after 5000ms",
    });
    const res = await request(app)
      .post("/api/v1/admin/test-llm-provider")
      .set("Cookie", adminCookie)
      .send({ kind: "openai", model: "gpt-4o-mini", apiKey: "sk-test" });
    expect(res.body).toMatchObject({ ok: false, errorCode: "unreachable" });
  });

  it("a 401 from the provider is told apart as 'auth', not 'unreachable'", async () => {
    jest.spyOn(llmProviderModule, "llmProbe").mockResolvedValue({
      reachable: false,
      models: [],
      error: "OpenAI availability check returned HTTP 401",
    });
    const res = await request(app)
      .post("/api/v1/admin/test-llm-provider")
      .set("Cookie", adminCookie)
      .send({ kind: "openai", model: "gpt-4o-mini", apiKey: "sk-wrong" });
    expect(res.body).toMatchObject({ ok: false, errorCode: "auth" });
  });
});
