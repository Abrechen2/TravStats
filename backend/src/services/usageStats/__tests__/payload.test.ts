jest.mock("../../../db", () => ({
  prisma: {
    adminSettings: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    user: { count: jest.fn() },
    flight: { count: jest.fn(), aggregate: jest.fn(), findFirst: jest.fn() },
    cruise: { count: jest.fn() },
    cruiseLeg: { aggregate: jest.fn() },
    userAchievement: { count: jest.fn(), findMany: jest.fn() },
    userSettings: { findMany: jest.fn() },
  },
}));

jest.mock("../../../utils/version", () => ({ appVersion: "2.4.0" }));

import { buildUsagePayload } from "../payload";
import { prisma } from "../../../db";

/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles only */
const p = prisma as any;

function happyPath(): void {
  p.adminSettings.findFirst.mockResolvedValue({
    id: 3,
    usageStatsInstallId: "aaaaaaaabbbbccccddddeeeeffff0000",
    ollamaUrl: "http://ollama:11434",
    globalOpenaiApiKey: null,
    globalClaudeApiKey: null,
    globalAirlabsApiKey: "enc",
    globalAviationstackApiKey: null,
    globalAerodataboxApiKey: null,
    globalOpenskyClientId: "enc",
    backupEnabled: true,
    webdavSyncEnabled: false,
  });
  p.user.count.mockResolvedValue(3);
  p.flight.count.mockResolvedValue(120);
  p.cruise.count.mockResolvedValue(0);
  p.flight.aggregate.mockResolvedValue({ _sum: { routeDistance: 128_437.2 } });
  p.cruiseLeg.aggregate.mockResolvedValue({ _sum: { distanceKm: 9_183.4 } });
  p.userAchievement.count.mockResolvedValue(87);
  p.userAchievement.findMany.mockResolvedValue([
    { achievement: { code: "globetrotter" } },
    { achievement: { code: "night_owl" } },
    { achievement: { code: "globetrotter" } },
  ]);
  p.flight.findFirst.mockResolvedValue({ id: "f1" }); // some flight has live tracking
  p.userSettings.findMany.mockResolvedValue([
    { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "de" } } },
    { enabledDomains: ["flight", "cruise"], historicalEnrichmentEnabled: true, data: { display: { language: "de" } } },
    { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "en" } } },
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  happyPath();
});

describe("buildUsagePayload", () => {
  it("reports the stripped app version", async () => {
    expect((await buildUsagePayload()).version).toBe("2.4.0");
  });

  it("unions enabled domains across users", async () => {
    expect((await buildUsagePayload()).enabled_domains.sort()).toEqual(["cruise", "flight"]);
  });

  it("buckets counts instead of reporting them exactly", async () => {
    const payload = await buildUsagePayload();
    expect(payload.users_bucket).toBe("2-5");
    expect(payload.flights_bucket).toBe("50-250");
    expect(payload.cruises_bucket).toBe("0");
  });

  it("rounds distances to the nearest 100 km", async () => {
    const payload = await buildUsagePayload();
    expect(payload.distance_km.flight).toBe(128_400);
    expect(payload.distance_km.cruise).toBe(9_200);
  });

  it("treats a null distance sum as zero", async () => {
    p.flight.aggregate.mockResolvedValue({ _sum: { routeDistance: null } });
    expect((await buildUsagePayload()).distance_km.flight).toBe(0);
  });

  it("deduplicates achievement codes and reports the total separately", async () => {
    const payload = await buildUsagePayload();
    expect(payload.achievements.unlocked_total).toBe(87);
    expect(payload.achievements.keys.sort()).toEqual(["globetrotter", "night_owl"]);
  });

  it("derives llm_parser from ollamaUrl or a global LLM key", async () => {
    expect((await buildUsagePayload()).features.llm_parser).toBe(true);
    p.adminSettings.findFirst.mockResolvedValue({
      id: 3, usageStatsInstallId: "x", ollamaUrl: null,
      globalOpenaiApiKey: null, globalClaudeApiKey: null,
      backupEnabled: false, webdavSyncEnabled: false,
    });
    expect((await buildUsagePayload()).features.llm_parser).toBe(false);
  });

  it("reports historical_enrichment when ANY user enabled it", async () => {
    expect((await buildUsagePayload()).features.historical_enrichment).toBe(true);
  });

  it("reports live_tracking from the existence of a tracked flight", async () => {
    expect((await buildUsagePayload()).features.live_tracking).toBe(true);
    p.flight.findFirst.mockResolvedValue(null);
    expect((await buildUsagePayload()).features.live_tracking).toBe(false);
  });

  it("lists configured provider names only, never key values", async () => {
    const payload = await buildUsagePayload();
    expect(payload.flight_api_providers.sort()).toEqual(["airlabs", "opensky"]);
    expect(JSON.stringify(payload)).not.toContain("enc");
  });

  it("picks the majority locale, breaking ties toward en", async () => {
    expect((await buildUsagePayload()).locale).toBe("de");
    p.userSettings.findMany.mockResolvedValue([
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "de" } } },
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: { display: { language: "en" } } },
    ]);
    expect((await buildUsagePayload()).locale).toBe("en");
  });

  it("survives a malformed settings data blob", async () => {
    p.userSettings.findMany.mockResolvedValue([
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: null },
      { enabledDomains: ["flight"], historicalEnrichmentEnabled: false, data: "not-an-object" },
    ]);
    await expect(buildUsagePayload()).resolves.toBeDefined();
  });

  it("contains NO personally identifying data", async () => {
    const serialized = JSON.stringify(await buildUsagePayload()).toLowerCase();
    const forbidden = [
      "password", "username", "@", "http://", "https://", "/app/", "c:\\",
      "hostname", "apikey", "api_key", "token", "secret", "email",
    ];
    for (const needle of forbidden) {
      // Jest's `expect()` takes exactly one argument in this repo's installed
      // version (29.7.0) — a second "message" argument throws before the
      // assertion runs. Kept as strict as the brief: same forbidden-substring
      // check, just without the (unsupported) custom failure label.
      expect(serialized.includes(needle)).toBe(false);
    }
  });
});
