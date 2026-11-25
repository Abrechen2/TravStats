import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { stayIdentityFor, type StayIdentity } from "../../services/dawarich/stays/identity";
import { llmGenerate, resolveLlmTarget, type LlmTarget } from "../../services/llm/llmProvider";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
jest.mock("../../services/dawarich/stays/identity", () => ({
  ...jest.requireActual("../../services/dawarich/stays/identity"),
  stayIdentityFor: jest.fn(),
}));
jest.mock("../../services/llm/llmProvider", () => ({
  ...jest.requireActual("../../services/llm/llmProvider"),
  resolveLlmTarget: jest.fn(),
  llmGenerate: jest.fn(),
}));

/**
 * "KI fragen" for an ambiguous GPS stay (forgejo#439 phase 2) and the
 * confirmation in front of every outbound use (owner, 2026-11-25).
 */

const identity = jest.mocked(stayIdentityFor);
const target = jest.mocked(resolveLlmTarget);
const generate = jest.mocked(llmGenerate);

const lan: LlmTarget = { kind: "ollama", url: "http://192.168.1.20:11434", model: "gemma" };
const cloud: LlmTarget = {
  kind: "openai",
  url: "https://api.openai.com/v1",
  model: "gpt",
  isCloud: true,
};
const candidate = (name: string, distanceM: number) => ({
  name,
  type: null,
  address: null,
  city: null,
  lat: 47.99,
  lon: 7.85,
  distanceM,
  photoCount: null,
});

let userId: string;
let cookie: string;
let stayId: string;
let adminId: number;

const ask = (body: object = {}) =>
  request(app).post(`/api/v1/dawarich-stays/${stayId}/ai-help`).set("Cookie", cookie).send(body);
const availability = () =>
  request(app).get("/api/v1/dawarich-stays/ai-help/availability").set("Cookie", cookie);
const setSwitch = (on: boolean) =>
  prisma.adminSettings.update({
    where: { id: adminId },
    data: { aiSuggestionHelpEnabled: on, internetEnabled: true },
  });

beforeAll(async () => {
  const stamp = Date.now();
  userId = (
    await prisma.user.create({
      data: { username: `ai-help-${stamp}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
  await prisma.userSettings.create({
    data: { userId, enabledDomains: ["poi"], data: {}, staySuggestionsEnabled: true },
  });
  adminId = await ensureAdminSettingsRow();
  stayId = (
    await prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: "ai-help",
        sourceStartAt: new Date("2026-11-11T09:00:00Z"),
        sourceEndAt: new Date("2026-11-11T11:00:00Z"),
        sourceLat: 47.9959,
        sourceLon: 7.8522,
        startAt: new Date("2026-11-11T09:00:00Z"),
        endAt: new Date("2026-11-11T11:00:00Z"),
        lat: 47.9959,
        lon: 7.8522,
        zone: "Europe/Berlin",
        pointCount: 40,
        evidence: { source: "travtrack", zone: "Europe/Berlin", pointIds: [1], uncertainties: [] },
      },
    })
  ).id;
  await prisma.place.create({
    data: { userId, name: "Rathaus Verw.geb., Freiburg", lat: 47.9965, lon: 7.8495 },
  });
});

afterAll(async () => {
  await prisma.adminSettings.update({
    where: { id: adminId },
    data: { aiSuggestionHelpEnabled: false },
  });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await prisma.userSettings.update({ where: { userId }, data: { externalServicePrefs: {} } });
  await setSwitch(true);
  identity.mockResolvedValue({
    lat: 47.9959,
    lon: 7.8522,
    candidates: [candidate("Stadtverwaltung Freiburg", 40), candidate("Café Atlantik", 90)],
    probable: null,
  } as unknown as StayIdentity);
  target.mockResolvedValue(lan);
  generate.mockResolvedValue(
    '{"ranking":[{"name":"Stadtverwaltung Freiburg","reason":"Two hours on a weekday"},' +
      '{"name":"Invented Place","reason":"x"}]}'
  );
});

const once = { mode: "once", target: "ollama@192.168.1.20:11434" };

describe("the button", () => {
  it("is hidden while the catalogue switch is off — it is off by default", async () => {
    await setSwitch(false);
    const res = await availability();
    expect(res.body.data).toEqual({ available: false, reason: "serviceOff" });
  });

  it("is hidden while no model is usable", async () => {
    target.mockResolvedValue(null);
    const res = await availability();
    expect(res.body.data).toEqual({ available: false, reason: "noProvider" });
  });

  it("shows with the switch on and a local Ollama", async () => {
    expect((await availability()).body.data).toEqual({ available: true, reason: null });
  });
});

describe("POST /dawarich-stays/:id/ai-help", () => {
  it("sends nothing before the confirmation and names the LAN target and the fields", async () => {
    const res = await ask();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFIRMATION_REQUIRED");
    expect(res.body.disclosure).toEqual({
      serviceId: "aiSuggestionHelp",
      host: "192.168.1.20:11434",
      provider: "ollama",
      location: "lan",
      fields: ["candidates", "distanceM", "dwellMin", "nearbyPlaces", "localDay"],
      pointCount: 0,
      privacyZonesApplied: null,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("labels a cloud provider as cloud", async () => {
    target.mockResolvedValue(cloud);
    const res = await ask();
    expect(res.body.disclosure).toMatchObject({ host: "api.openai.com", location: "cloud" });
  });

  it("sends only names, figures and the day — no coordinate, no point", async () => {
    const res = await ask({ confirmation: once });
    expect(res.status).toBe(200);
    const sent = JSON.parse(generate.mock.calls[0][1].prompt);
    expect(Object.keys(sent).sort()).toEqual(
      ["candidates", "distanceM", "dwellMin", "localDay", "nearbyPlaces"].sort()
    );
    expect(sent).toEqual({
      candidates: ["Stadtverwaltung Freiburg", "Café Atlantik"],
      distanceM: 40,
      dwellMin: 120,
      nearbyPlaces: ["Rathaus Verw.geb., Freiburg"],
      localDay: "2026-11-11",
    });
    expect(generate.mock.calls[0][1].prompt).not.toMatch(/47\.99|7\.85/);
  });

  it("answers advice only: invented names are dropped and nothing is written", async () => {
    const before = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: stayId } });
    const visits = await prisma.placeVisit.count({ where: { place: { userId } } });
    const res = await ask({ confirmation: once });
    expect(res.body.data.answer.ranking).toEqual([
      { name: "Stadtverwaltung Freiburg", reason: "Two hours on a weekday" },
    ]);
    expect(res.body.data.provider).toMatchObject({ kind: "ollama", location: "lan" });
    const after = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: stayId } });
    expect([after.status, after.name, after.placeId]).toEqual([
      before.status,
      before.name,
      before.placeId,
    ]);
    expect(await prisma.placeVisit.count({ where: { place: { userId } } })).toBe(visits);
  });

  it('"Immer" skips the dialog next time; revoking brings it back', async () => {
    expect((await ask({ confirmation: { ...once, mode: "always" } })).status).toBe(200);
    expect((await ask()).status).toBe(200);
    const list = await request(app)
      .get("/api/v1/settings/external-services/use-consents")
      .set("Cookie", cookie);
    expect(list.body.consents).toEqual([
      expect.objectContaining({ serviceId: "aiSuggestionHelp", target: once.target }),
    ]);
    await request(app)
      .delete("/api/v1/settings/external-services/use-consents/aiSuggestionHelp")
      .set("Cookie", cookie)
      .expect(204);
    expect((await ask()).status).toBe(409);
  });

  it("asks again when the target changed", async () => {
    await ask({ confirmation: { ...once, mode: "always" } });
    target.mockResolvedValue({ ...lan, url: "http://192.168.1.99:11434" });
    const res = await ask();
    expect(res.status).toBe(409);
    expect(res.body.disclosure.host).toBe("192.168.1.99:11434");
    // A confirmation given for the old target does not cover the new one.
    expect((await ask({ confirmation: once })).status).toBe(409);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new Error("Suggestion help timeout after 45000ms"), 504, "timeout"],
    [new Error("connect ECONNREFUSED 192.168.1.20:11434"), 502, "unreachable"],
    [new Error("Suggestion help returned HTTP 500"), 502, "providerError"],
  ])("a provider failure arrives as itself (%s)", async (error, status, reason) => {
    generate.mockRejectedValue(error);
    const res = await ask({ confirmation: once });
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code: "AI_HELP_FAILED", reason });
  });

  it("an answer with no candidate in it is a failure, not an empty success", async () => {
    generate.mockResolvedValue('{"ranking":[{"name":"Elsewhere","reason":"?"}]}');
    const res = await ask({ confirmation: once });
    expect(res.body).toMatchObject({ code: "AI_HELP_FAILED", reason: "badAnswer" });
  });

  it("refuses with the switch off, before anything is built or sent", async () => {
    await setSwitch(false);
    const res = await ask({ confirmation: once });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "AI_HELP_FAILED", reason: "serviceOff" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("a stay with a single candidate is not ambiguous", async () => {
    identity.mockResolvedValue({
      candidates: [candidate("Stadtverwaltung Freiburg", 40)],
      probable: null,
    } as unknown as StayIdentity);
    const res = await ask({ confirmation: once });
    expect(res.body).toMatchObject({ code: "AI_HELP_FAILED", reason: "notAmbiguous" });
  });
});
