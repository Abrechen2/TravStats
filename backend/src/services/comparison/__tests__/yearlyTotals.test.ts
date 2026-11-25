import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildLeaderboardSnapshot } from "../aggregates";
import {
  cachedYearlyTotals,
  clearYearlyTotalsCache,
  invalidateYearlyTotals,
} from "../yearlyTotalsCache";
import {
  anyLeaderboardSnapshotSchema,
  leaderboardScopeSchema,
  type LeaderboardScope,
} from "../../../schemas/comparison";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const OFF: LeaderboardScope = {
  groups: ["trips", "places"],
  domains: ["ferry", "poi"],
  year: null,
};
const ON: LeaderboardScope = { ...OFF, years: true };
let userId: string;
const ferry = (departure: string) => ({
  userId,
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.13,
  arrStationName: "Oslo",
  arrLat: 59.91,
  arrLon: 10.75,
  departureTime: new Date(departure),
  status: "completed",
  distanceKm: 100,
});

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `lb-years-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
  await prisma.ferryJourney.createMany({
    data: [
      ferry("2023-06-01T12:00:00Z"),
      ferry("2023-07-01T12:00:00Z"),
      ferry("2025-05-01T12:00:00Z"),
    ],
  });
});
beforeEach(() => {
  clearYearlyTotalsCache();
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry", "poi"]);
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("yearly totals are an opt-in", () => {
  it("a consent without the switch (every consent made before it) carries no years", async () => {
    expect(leaderboardScopeSchema.parse(OFF).years).toBeUndefined();
    const s = await buildLeaderboardSnapshot(userId, OFF, null, 3);
    expect(s.version).toBe(3);
    expect("years" in s).toBe(false);
  });

  it("with the switch, ONE snapshot carries every year that has data, as totals", async () => {
    const s = await buildLeaderboardSnapshot(userId, ON, null, 3, true);
    if (s.version !== 3) throw new Error("expected v3");
    expect(Object.keys(s.years ?? {})).toEqual(["2023", "2025"]); // 2024 had nothing: not listed
    expect(s.years?.["2023"]).toMatchObject({ ferryCrossings: 2 });
    expect(s.years?.["2025"]).toMatchObject({ ferryCrossings: 1 });
    // Lifetime-only figures are not yearly.
    for (const figures of Object.values(s.years ?? {}))
      expect(Object.keys(figures).some((k) => k === "countries" || k.startsWith("curated"))).toBe(
        false
      );
  });

  it("an older peer (v2) and a year view never get years, whatever the consent says", async () => {
    expect("years" in (await buildLeaderboardSnapshot(userId, ON, null, 2, true))).toBe(false);
    expect("years" in (await buildLeaderboardSnapshot(userId, ON, 2025, 3, true))).toBe(false);
  });
});

describe("the v3 schema takes totals only", () => {
  const base = {
    schema: "travstats-leaderboard",
    version: 3,
    asOf: "2026-11-25T10:00:00.000Z",
    year: null,
    domains: ["ferry"],
    metrics: {},
    partial: [],
  };
  const ok = (years: unknown) => anyLeaderboardSnapshotSchema.safeParse({ ...base, years }).success;
  it("accepts per-year numbers and null", () => {
    expect(ok({ "2024": { flights: 3, flightKm: null } })).toBe(true);
  });
  it.each([
    ["a record in a year", { "2024": [{ flight: "LH1" }] }],
    ["a string value", { "2024": { flights: "3" } }],
    ["a nested object", { "2024": { flights: { n: 3 } } }],
    ["a date as the key", { "2024-06-01": { flights: 3 } }],
    ["a year out of range", { "1850": { flights: 3 } }],
    ["a negative total", { "2024": { flights: -1 } }],
    ["a place id as a metric", { "2024": { "world-heritage:machu": 1 } }],
    ["a prototype key", JSON.parse('{"2024":{"__proto__":1}}')],
  ])("rejects %s", (_n, years) => expect(ok(years)).toBe(false));
  it("rejects years on a v2 snapshot", () => {
    expect(
      anyLeaderboardSnapshotSchema.safeParse({ ...base, version: 2, years: { "2024": {} } }).success
    ).toBe(false);
  });
});

describe("the yearly-totals build is cached, coalesced and invalidated", () => {
  const built = { "2024": { flights: 1 } };
  it("two pulls, one build — also when they arrive together", async () => {
    const build = jest.fn(async () => built);
    const [a, b] = await Promise.all([
      cachedYearlyTotals("u-cache", "s", build),
      cachedYearlyTotals("u-cache", "s", build),
    ]);
    await cachedYearlyTotals("u-cache", "s", build);
    expect([a, b]).toEqual([built, built]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("one user never has two builds running at once, whatever the scope", async () => {
    let running = 0;
    let peak = 0;
    const build = async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return built;
    };
    await Promise.all([
      cachedYearlyTotals("u-serial", "scope-a", build),
      cachedYearlyTotals("u-serial", "scope-b", build),
    ]);
    expect(peak).toBe(1);
  });

  it("expires after its TTL and on invalidation, and a build overtaken by a write is not stored", async () => {
    const build = jest.fn(async () => built);
    await cachedYearlyTotals("u-ttl", "s", build, 0);
    await cachedYearlyTotals("u-ttl", "s", build, 6 * 60 * 60_000 + 1);
    expect(build).toHaveBeenCalledTimes(2);
    invalidateYearlyTotals("u-ttl");
    await cachedYearlyTotals("u-ttl", "s", build, 6 * 60 * 60_000 + 2);
    expect(build).toHaveBeenCalledTimes(3);
    const slow = jest.fn(async () => {
      invalidateYearlyTotals("u-race");
      return built;
    });
    await cachedYearlyTotals("u-race", "s", slow);
    await cachedYearlyTotals("u-race", "s", slow);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("a write to a counted table of that user invalidates: the next pull sees the new row", async () => {
    const first = await buildLeaderboardSnapshot(userId, ON, null, 3, true);
    if (first.version !== 3) throw new Error("expected v3");
    const before = first.years?.["2025"]?.ferryCrossings;
    await prisma.ferryJourney.create({ data: ferry("2025-08-01T12:00:00Z") });
    const second = await buildLeaderboardSnapshot(userId, ON, null, 3, true);
    if (second.version !== 3) throw new Error("expected v3");
    expect(second.years?.["2025"]?.ferryCrossings).toBe((before as number) + 1);
  });
});
