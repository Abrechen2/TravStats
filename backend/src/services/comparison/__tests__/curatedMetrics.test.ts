import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildLeaderboardSnapshot } from "../aggregates";
import { leaderboardSnapshotSchema, type LeaderboardScope } from "../../../schemas/comparison";
import { CURATED_LIST_METRICS, curatedSizeKey } from "../../../shared/comparisonMetrics";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const SCOPE: LeaderboardScope = { groups: ["places"], domains: ["poi"], year: null };
const LIST = "curated-test-list";
let userId: string;

const base = {
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-11-25T10:00:00.000Z",
  year: null,
  domains: ["poi"],
  partial: [],
};

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `lb-cur-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
  // A seed suite earlier in the run may have left the real catalogue behind (its afterAll
  // re-seeds it). This suite owns world-heritage for its duration, as its afterAll already
  // assumes, and needs nationalparks-us absent to see an unseeded list as null.
  await prisma.curatedList.deleteMany({
    where: { key: { in: ["world-heritage", "nationalparks-us"] } },
  });
  await prisma.curatedList.create({
    data: {
      key: "world-heritage",
      name: "T",
      items: {
        create: ["a", "b", "c", "d"].map((s) => ({
          id: `world-heritage:${LIST}-${s}`,
          name: s,
          lat: 1,
          lon: 1,
        })),
      },
    },
  });
  await prisma.place.createMany({
    data: [
      {
        userId,
        name: "a",
        lat: 1,
        lon: 1,
        visited: true,
        curatedItemId: `world-heritage:${LIST}-a`,
      },
      {
        userId,
        name: "b",
        lat: 1,
        lon: 1,
        visited: true,
        curatedItemId: `world-heritage:${LIST}-b`,
      },
      {
        userId,
        name: "c",
        lat: 1,
        lon: 1,
        visited: false,
        curatedItemId: `world-heritage:${LIST}-c`,
      },
      { userId, name: "own", lat: 1, lon: 1, visited: true },
    ],
  });
});
beforeEach(() => jest.mocked(loadVisibleDomains).mockResolvedValue(["poi"]));
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.curatedList.deleteMany({ where: { key: "world-heritage" } });
  await prisma.$disconnect();
});

it("carries only integer counts per curated list key, never which places", async () => {
  const s = await buildLeaderboardSnapshot(userId, SCOPE, null);
  expect(s.metrics.curatedWorldHeritage).toBe(2);
  expect(s.metrics[curatedSizeKey("curatedWorldHeritage")]).toBe(4);
  // A list this server has not seeded is unknown (null), never "0 of 0".
  expect(s.metrics.curatedNationalParksUs).toBeNull();
  const json = JSON.stringify(s);
  expect(json).not.toContain(LIST);
  expect(json).not.toContain("own");
  for (const v of Object.values(s.metrics)) expect(v === null || Number.isInteger(v)).toBe(true);
});

it("is null in a year view: a checklist has no year", async () => {
  const s = await buildLeaderboardSnapshot(userId, SCOPE, 2025);
  expect(s.metrics.curatedWorldHeritage).toBeNull();
});

it("is absent when the consent leaves out the poi domain", async () => {
  const s = await buildLeaderboardSnapshot(userId, { ...SCOPE, domains: ["ferry"] }, null);
  expect("curatedWorldHeritage" in s.metrics).toBe(false);
});

describe("the snapshot schema stays unable to hold a record", () => {
  it("rejects a list of place ids in place of a count", () => {
    for (const bad of [["world-heritage:a", "world-heritage:b"], "world-heritage:a", { id: "x" }])
      expect(
        leaderboardSnapshotSchema.safeParse({ ...base, metrics: { curatedWorldHeritage: bad } })
          .success
      ).toBe(false);
  });
  it("rejects a site id used as a metric name", () => {
    expect(
      leaderboardSnapshotSchema.safeParse({ ...base, metrics: { "world-heritage:machu": 1 } })
        .success
    ).toBe(false);
  });
  it("accepts counts", () => {
    expect(
      leaderboardSnapshotSchema.safeParse({
        ...base,
        metrics: { curatedWorldHeritage: 3, curatedWorldHeritageOf: 1199 },
      }).success
    ).toBe(true);
  });
});

it("maps exactly the lists of curated_lists.csv, with letter-only keys", () => {
  const csv = fs.readFileSync(path.join(__dirname, "../../../seedData/curated_lists.csv"), "utf-8");
  const keys = csv
    .split("\n")
    .slice(1)
    .map((l) => l.split(",")[0])
    .filter(Boolean);
  expect(CURATED_LIST_METRICS.map((m) => m.curatedList).sort()).toEqual([...keys].sort());
  for (const m of CURATED_LIST_METRICS) expect(curatedSizeKey(m.key)).toMatch(/^[a-zA-Z]{1,40}$/);
});
