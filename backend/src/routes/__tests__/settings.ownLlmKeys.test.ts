import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { resolveLlmChain } from "../../services/llm/llmProvider";
import { llmRefusalFor } from "../../services/llm/llmGate";
import { ensureAdminSettings } from "../../services/instanceSettingsService";

jest.mock("../../services/externalServices/testRunner", () => ({
  ...jest.requireActual("../../services/externalServices/testRunner"),
  testAccountService: jest.fn().mockResolvedValue({ ok: true }),
}));

/**
 * Settings v3 S5b: an account may bring its own OpenAI and Anthropic key, like Gemini. Before,
 * both catalogue entries were instance-only, so the PUT answered 404 and the chain never
 * looked at `userSettings.openaiApiKey` / `claudeApiKey`.
 */
describe.each([
  {
    id: "openai",
    kind: "openai",
    column: "openaiApiKey",
    adminKey: "llmOpenaiApiKey",
    optIn: "llmOpenaiOptIn",
  },
  {
    id: "anthropic",
    kind: "anthropic",
    column: "claudeApiKey",
    adminKey: "llmAnthropicApiKey",
    optIn: "llmAnthropicOptIn",
  },
] as const)("own $id key of an account", ({ id, kind, column, adminKey, optIn }) => {
  const username = `own-llm-${id}-${Date.now()}`;
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
      data: { [adminKey]: null, [optIn]: false, externalServicePolicy: {} },
    });
  });
  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: {
        [adminKey]: original[adminKey],
        [optIn]: original[optIn],
        externalServicePolicy: original.externalServicePolicy ?? {},
      },
    });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  const save = (apiKey: string) =>
    request(app)
      .put(`/api/v1/settings/external-services/${id}`)
      .set("Cookie", cookie)
      .send({ fields: { apiKey } });
  const consent = () =>
    request(app)
      .put(`/api/v1/settings/external-services/ai-consent/${kind}`)
      .set("Cookie", cookie)
      .send({ consent: true });
  const consents = async () =>
    (await request(app).get("/api/v1/settings/external-services").set("Cookie", cookie)).body
      .aiConsents as Array<{ id: string }>;

  it("is saved encrypted and never read back", async () => {
    const res = await save("my-key").expect(200);
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(decryptApiKey(row[column])).toBe("my-key");
    expect(row[column]).not.toContain("my-key");
    expect(res.body.configured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("my-key");
  });

  it("works on its own: listed for consent, refused until consented, then the chain uses it", async () => {
    expect(await consents()).not.toContainEqual(expect.objectContaining({ id }));
    await save("my-key").expect(200);
    expect(await consents()).toContainEqual(expect.objectContaining({ id }));
    expect(await llmRefusalFor(userId)).toMatchObject({ kind: "cloud_not_consented" });
    await consent().expect(200);
    expect(await llmRefusalFor(userId)).toBeNull();
    const chain = await resolveLlmChain({ userId });
    expect(chain.find((t) => t.kind === kind)?.apiKey).toBe("my-key");
    // Another account sees nothing of it.
    expect((await resolveLlmChain({ systemTask: true })).some((t) => t.kind === kind)).toBe(false);
  });

  it("an admin who forbids account keys stops it everywhere", async () => {
    await save("my-key").expect(200);
    await consent().expect(200);
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: { externalServicePolicy: { accountKeysForbidden: [id] } },
    });
    expect((await resolveLlmChain({ userId })).some((t) => t.kind === kind)).toBe(false);
    expect(await consents()).not.toContainEqual(expect.objectContaining({ id }));
    await save("another-key").expect(403);
  });

  it("an account that paused the service no longer sends documents to its key", async () => {
    await save("my-key").expect(200);
    await consent().expect(200);
    await request(app)
      .put(`/api/v1/settings/external-services/${id}`)
      .set("Cookie", cookie)
      .send({ accountDisabled: true })
      .expect(200);
    expect((await resolveLlmChain({ userId })).some((t) => t.kind === kind)).toBe(false);
  });

  it("a paused service gets nothing from this account, not even through the instance's key", async () => {
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: { [adminKey]: encryptApiKey("instance-key"), [optIn]: true },
    });
    await consent().expect(200);
    expect((await resolveLlmChain({ userId })).some((t) => t.kind === kind)).toBe(true);
    await request(app)
      .put(`/api/v1/settings/external-services/${id}`)
      .set("Cookie", cookie)
      .send({ accountDisabled: true })
      .expect(200);
    expect((await resolveLlmChain({ userId })).some((t) => t.kind === kind)).toBe(false);
    // Another account is not paused and still reaches the instance's key.
    expect((await resolveLlmChain({ systemTask: true })).some((t) => t.kind === kind)).toBe(true);
  });
});
