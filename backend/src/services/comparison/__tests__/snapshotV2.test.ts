import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { ensureAchievements } from "../../../data/achievements";
import { exchange } from "../../federation/security";
import { loadIdentity } from "../../federation/identity";
import { loadVisibleDomains } from "../../domainVisibility";
import { readLeaderboard } from "../leaderboard";
import { serveAggregate } from "../peerActions";
import { catalogueVersion } from "../achievementCatalogue";

jest.mock("../../federation/security", () => ({
  ...jest.requireActual("../../federation/security"),
  exchange: jest.fn(),
}));
jest.mock("../../federation/identity", () => ({
  ...jest.requireActual("../../federation/identity"),
  loadIdentity: jest.fn(),
}));
jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const OLD = "https://old.lb-v2.test";
const NEW = "https://new.lb-v2.test";
const SCOPE = { groups: ["trips", "achievements"], domains: ["flight"], year: null };
const base = {
  schema: "travstats-leaderboard",
  asOf: "2026-11-07T00:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics: { flights: 3 },
  partial: [],
};
const section = {
  catalogue: "0123456789abcdef",
  items: [{ code: "AIRPORTS_10", unlocked: true, progress: 1 }],
};
const users: string[] = [];
let viewer: string, friend: string;
let warn: jest.SpyInstance;

async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-v2-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
const remoteFor = (origin: string) =>
  prisma.leaderboardRemote.create({
    data: {
      userId: viewer,
      origin,
      channel: randomUUID(),
      username: "far",
      displayName: "Far",
      consents: {
        create: { ownerId: viewer, status: "accepted", scope: SCOPE, decidedAt: new Date() },
      },
    },
  });
const peerWith = (origin: string, versions: number[]) =>
  prisma.comparisonPeer.upsert({
    where: { origin },
    create: {
      origin,
      publicKey: "unused",
      enabled: true,
      verifiedAt: new Date(),
      leaderboardVersions: versions,
      versionsCheckedAt: new Date(),
    },
    update: { leaderboardVersions: versions, versionsCheckedAt: new Date() },
  });
const farRow = async (year: number | null = null) =>
  (await readLeaderboard(viewer, { year })).rows.find(
    (r) => r.person.kind !== "self" && r.person.kind !== "local"
  );

beforeAll(async () => {
  await ensureAchievements();
  viewer = await user();
  friend = await user();
  await prisma.leaderboardConsent.createMany({
    data: [
      {
        ownerId: friend,
        viewerId: viewer,
        status: "accepted",
        scope: SCOPE,
        decidedAt: new Date(),
      },
      {
        ownerId: viewer,
        viewerId: friend,
        status: "accepted",
        scope: SCOPE,
        decidedAt: new Date(),
      },
    ],
  });
});
beforeEach(async () => {
  jest.mocked(exchange).mockReset();
  jest.mocked(loadIdentity).mockResolvedValue({ origin: "https://me.lb-v2.test" } as never);
  jest.mocked(loadVisibleDomains).mockResolvedValue(["flight"]);
  warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  await prisma.leaderboardRemote.deleteMany({ where: { userId: viewer } });
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { endsWith: ".lb-v2.test" } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("a v1-only peer still yields stats and achievementsUnavailable: olderServer", async () => {
  await peerWith(OLD, [1]);
  await remoteFor(OLD);
  jest.mocked(exchange).mockResolvedValueOnce({ status: "ok", snapshot: { ...base, version: 1 } });
  const row = (await readLeaderboard(viewer, { year: null })).rows.find(
    (r) => r.person.kind === "remote"
  );
  expect(row).toMatchObject({ status: "ok", achievementsUnavailable: "olderServer" });
  expect(row?.snapshot?.metrics).toEqual({ flights: 3 });
  expect(row?.achievements).toBeUndefined();
  expect(jest.mocked(exchange).mock.calls[0][1]).toMatchObject({ accept: [1] });
});

it("a v2 peer yields the section", async () => {
  await peerWith(NEW, [1, 2]);
  await remoteFor(NEW);
  jest.mocked(exchange).mockResolvedValueOnce({
    status: "ok",
    snapshot: { ...base, version: 2, achievements: section },
  });
  const row = (await readLeaderboard(viewer, { year: null })).rows.find(
    (r) => r.person.kind === "remote"
  );
  expect(row?.achievements).toEqual(section);
  expect(row?.achievementsUnavailable).toBeUndefined();
  expect(jest.mocked(exchange).mock.calls[0][1]).toMatchObject({ accept: [1, 2] });
});

it("a v2 snapshot without the section reads notShared, and a year view reads yearView", async () => {
  await peerWith(NEW, [1, 2]);
  await remoteFor(NEW);
  jest.mocked(exchange).mockResolvedValueOnce({ status: "ok", snapshot: { ...base, version: 2 } });
  const row = (await readLeaderboard(viewer, { year: null })).rows.find(
    (r) => r.person.kind === "remote"
  );
  expect(row?.achievementsUnavailable).toBe("notShared");
  jest
    .mocked(exchange)
    .mockResolvedValueOnce({ status: "ok", snapshot: { ...base, year: 2025, version: 2 } });
  const yearRow = (await readLeaderboard(viewer, { year: 2025 })).rows.find(
    (r) => r.person.kind === "remote"
  );
  expect(yearRow?.achievementsUnavailable).toBe("yearView");
});

it("a reply in a snapshot version that was not offered is unreachable, not shown", async () => {
  await peerWith(OLD, [1]);
  await remoteFor(OLD);
  jest.mocked(exchange).mockResolvedValueOnce({
    status: "ok",
    snapshot: { ...base, version: 2, achievements: section },
  });
  const row = (await readLeaderboard(viewer, { year: null })).rows.find(
    (r) => r.person.kind === "remote"
  );
  expect(row).toMatchObject({ status: "unreachable", snapshot: null });
});

it("a local friend gets the same section as a remote one would", async () => {
  const rows = (await readLeaderboard(viewer, { year: null })).rows;
  const local = rows.find((r) => r.person.key !== "self" && r.status === "ok");
  expect(local?.achievements?.catalogue).toBe(catalogueVersion());
  expect(local?.snapshot?.version).toBe(2);
  // Same shape as the wire section: parsed by the very schema a remote reply passes through.
  expect(Object.keys(local!.achievements!).sort()).toEqual(["catalogue", "items"]);
  expect(local?.achievementsUnavailable).toBeUndefined();
  const yearRows = (await readLeaderboard(viewer, { year: 2025 })).rows;
  expect(
    yearRows.find((r) => r.person.key !== "self" && r.status === "ok")?.achievementsUnavailable
  ).toBe("yearView");
});

describe("serving", () => {
  it("serves the highest version both sides read, and v1 bytes to a v1 asker", async () => {
    const remote = await remoteFor(NEW);
    const body = {
      action: "aggregate" as const,
      channel: remote.channel,
      year: null,
      viewerShares: true,
    };
    const v2 = await serveAggregate(NEW, { ...body, accept: [1, 2] });
    expect(v2).toMatchObject({ status: "ok", snapshot: { version: 2 } });
    if (v2.status !== "ok" || v2.snapshot.version !== 2) throw new Error("expected v2");
    expect(v2.snapshot.achievements?.items.length).toBeGreaterThan(0);
    const v1 = await serveAggregate(NEW, { ...body, accept: [1] });
    expect(v1).toMatchObject({ status: "ok", snapshot: { version: 1 } });
    expect(Object.keys((v1 as { snapshot: object }).snapshot)).not.toContain("achievements");
  });
});
