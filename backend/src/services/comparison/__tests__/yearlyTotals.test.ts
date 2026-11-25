import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildLeaderboardSnapshot } from "../aggregates";
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
beforeEach(() => jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry", "poi"]));
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
    const s = await buildLeaderboardSnapshot(userId, ON, null, 3);
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
    expect("years" in (await buildLeaderboardSnapshot(userId, ON, null, 2))).toBe(false);
    expect("years" in (await buildLeaderboardSnapshot(userId, ON, 2025, 3))).toBe(false);
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
