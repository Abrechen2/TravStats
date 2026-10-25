/**
 * Stays and market visits from the account's location source (TravTrack plan
 * E3; review focus 1, 17, 18, 19, 20, 23). Against the database, with a fake
 * Dawarich client and seeded TravTrack points.
 *
 * The Dawarich half is a golden test: the rows a Dawarich scan writes — every
 * field but the four E1 added (provider, provider_rev, algorithm_version,
 * evidence_key) — are compared with a fixture captured before E3 touched the
 * scan (`GOLDEN_WRITE=1 npx jest scan.provider -t golden`).
 */
import fs from "fs";
import path from "path";
import request from "supertest";

import { prisma } from "../../../../db";
import { Prisma } from "../../../../prisma";
import { encryptApiKey } from "../../../../utils/encryption";
import { generateToken } from "../../../../utils/jwt";
import type { DawarichClient, DawarichPoint } from "../../dawarichClient";
import type { CachedCatalog } from "../../marketVisits/catalog";
import type { MarketCatalog } from "../../marketVisits/osm";
import { makeUser, storePoint, wipeTravTrack } from "../../../travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../../travtrack/__tests__/switches";
import { deleteTravTrackRange } from "../../../travtrack/deleteRange";
import { bumpHistoryGeneration } from "../../../locationEvidence/generation";
import { takeTravTrackLock } from "../../../travtrack/lock";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));

/** What the route's "scan now" reaches: the fake client, never the network. */
const routeClient: { points: DawarichPoint[] } = { points: [] };
jest.mock("../../dawarichClient", () => ({
  ...jest.requireActual("../../dawarichClient"),
  createDawarichClient: (): DawarichClient => ({
    checkHealth: async () => ({ reachable: true, version: null }),
    getPoints: async () => ({ points: routeClient.points, truncated: false }),
  }),
}));

import app from "../../../../index";
import { runDawarichStaySweep } from "../../../../jobs/dawarichStayScheduler";
import { reserveScan, scanStays } from "../scan";

const PREFIX = "stay-scan-provider-";
const GOLDEN = path.join(__dirname, "fixtures", "scan.provider.golden.json");
const now = new Date("2026-10-11T06:00:00Z");
const MIN = 60_000;
const SEOUL = { lat: 37.57, lon: 126.97 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };

const switches = travTrackSwitches();

beforeAll(() => {
  // CI sets one; a bare local run has none, and the key module must not mint one.
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

function dawarichPoint(id: number, at: number, where: { lat: number; lon: number }): DawarichPoint {
  return {
    id,
    latitude: where.lat,
    longitude: where.lon,
    timestampMs: at,
    accuracy: 10,
    altitude: null,
    velocity: null,
    trackId: null,
  };
}

/** A market dwell in Seoul (21 points, 1 min apart) and a stop in Busan with one outlier. */
function dawarichFixture(): DawarichPoint[] {
  const seoulFrom = Date.parse("2026-10-10T14:50:00Z");
  const seoul = Array.from({ length: 21 }, (_, i) =>
    dawarichPoint(i + 1, seoulFrom + i * MIN, SEOUL)
  );
  const busanFrom = Date.parse("2026-10-10T20:00:00Z");
  const busan = [0, 10, 20, 25, 30, 40].map((m, i) =>
    dawarichPoint(
      100 + i,
      busanFrom + m * MIN,
      // One isolated jump, bounded on both sides by the stop: ignored, not split.
      m === 25 ? { lat: BUSAN.lat + 0.5, lon: BUSAN.lon } : BUSAN
    )
  );
  return [...seoul, ...busan];
}

const fakeClient = (points: DawarichPoint[]): DawarichClient => ({
  checkHealth: async () => ({ reachable: true, version: null }),
  getPoints: async () => ({ points, truncated: false }),
});

const marketRaw = {
  elements: [
    {
      type: "way",
      id: 1234,
      tags: { amenity: "marketplace", name: "Test Market", wikidata: "Q1234" },
      geometry: [
        { lat: 37.569, lon: 126.969 },
        { lat: 37.571, lon: 126.969 },
        { lat: 37.571, lon: 126.971 },
        { lat: 37.569, lon: 126.971 },
        { lat: 37.569, lon: 126.969 },
      ],
    },
  ],
};

function memoryStore() {
  const cache = new Map<string, CachedCatalog>();
  return {
    read: async (key: string) => cache.get(key) ?? null,
    write: async (key: string, payload: MarketCatalog, fetchedAt: Date) => {
      cache.set(key, { payload, fetchedAt });
    },
    claim: async (at: Date) => at,
    complete: async () => {},
  };
}

async function account(
  name: string,
  provider: "none" | "dawarich" | "travtrack",
  ownDawarich: boolean
): Promise<string> {
  const id = await makeUser(`${PREFIX}${name}`);
  await prisma.userSettings.create({
    data: {
      userId: id,
      data: {},
      enabledDomains: ["poi"],
      locationProvider: provider,
      ...(ownDawarich
        ? {
            dawarichBaseUrl: "http://dawarich.local:3000",
            dawarichApiKey: encryptApiKey("own-key"),
          }
        : {}),
    },
  });
  await prisma.dawarichStayScan.create({ data: { userId: id, enabled: true } });
  return id;
}

async function resetAccount(userId: string): Promise<void> {
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await wipeTravTrack([userId]);
  await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.update({
    where: { userId },
    data: {
      enabled: true,
      marketEnabled: false,
      venueEnabled: false,
      marketResult: Prisma.DbNull,
      leaseUntil: null,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    },
  });
}

/** Every written field of the account's stays but the four E1 added, ids made stable. */
async function goldenRows(userId: string) {
  const rows = await prisma.dawarichStay.findMany({
    where: { userId },
    orderBy: [{ sourceStartAt: "asc" }, { fingerprint: "asc" }],
  });
  const places = await prisma.place.findMany({ where: { userId } });
  const placeName = (id: string | null) =>
    id ? `place:${places.find((p) => p.id === id)?.name}` : null;
  const fingerprintOf = (id: string) => rows.find((r) => r.id === id)?.fingerprint ?? id;
  return rows.map((row) => {
    const {
      id: _id,
      userId: _user,
      detectedAt: _detected,
      resolvedAt,
      provider: _provider,
      providerRev: _rev,
      algorithmVersion: _algorithm,
      evidenceKey: _key,
      placeId,
      ...rest
    } = row;
    const evidence = row.evidence as Record<string, unknown>;
    return JSON.parse(
      JSON.stringify({
        ...rest,
        resolved: resolvedAt !== null,
        placeId: placeName(placeId),
        evidence: {
          ...evidence,
          ...(Array.isArray(evidence.supersededFindingIds)
            ? {
                supersededFindingIds: (evidence.supersededFindingIds as string[]).map(
                  fingerprintOf
                ),
              }
            : {}),
        },
      })
    );
  });
}

async function scanOnce(userId: string, options: Parameters<typeof scanStays>[1] = {}) {
  await reserveScan(userId, now);
  return scanStays(userId, { now, ...options });
}

describe("Dawarich: today's code path", () => {
  let userId: string;

  beforeAll(async () => {
    userId = await account("dawarich", "none", true);
  });

  beforeEach(async () => {
    await resetAccount(userId);
  });

  /**
   * Two runs: plain stops first, then with market suggestions on, so the
   * market finding supersedes the Seoul fragment. The scan result and the
   * scan row's outcome ride along.
   */
  async function goldenRun() {
    await prisma.place.create({
      data: { userId, name: "Busan Station", lat: BUSAN.lat, lon: BUSAN.lon },
    });
    const client = fakeClient(dawarichFixture());
    const first = await scanOnce(userId, { client });
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const second = await scanOnce(userId, {
      client,
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(marketRaw)),
    });
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    return {
      results: [first, second],
      scan: {
        result: state.result,
        error: state.error,
        pointCount: state.pointCount,
        createdCount: state.createdCount,
        dataThrough: state.dataThrough?.toISOString() ?? null,
        marketResult: state.marketResult,
      },
      rows: await goldenRows(userId),
    };
  }

  it("golden: the Dawarich fixture yields the same rows as on main — every field but provider, provider_rev, algorithm_version and evidence_key", async () => {
    const actual = await goldenRun();
    if (process.env.GOLDEN_WRITE === "1") {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(fs.readFileSync(GOLDEN, "utf8")));
  });

  it("records the provider columns beside the rows, and the scan's source", async () => {
    await goldenRun();
    const rows = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.provider).toBe("dawarich");
      expect(row.algorithmVersion).toBe(0);
      expect(row.providerRev).toBe(0);
      expect(row.evidenceKey).toMatch(/^[0-9a-f]{64}$/);
      // The legacy fingerprint, never the neutral key.
      expect(row.fingerprint).not.toBe(row.evidenceKey);
      expect(row.evidence).toHaveProperty("pointIds");
      expect(row.evidence).not.toHaveProperty("pointDigests");
    }
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.provider).toBe("dawarich");
  });

  it("a Dawarich scan applies no zone, no anomaly mask and no deleted-range filter", async () => {
    // TravTrack's own privacy zone and deleted span over the Busan stop: Dawarich ignores both.
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: BUSAN.lat, lon: BUSAN.lon, radiusM: 500 },
    });
    await prisma.travTrackDeletedRange.create({
      data: {
        userId,
        fromAt: new Date("2026-10-10T19:00:00Z"),
        toAt: new Date("2026-10-10T22:00:00Z"),
      },
    });
    await scanOnce(userId, { client: fakeClient(dawarichFixture()) });
    const busan = await prisma.dawarichStay.findFirstOrThrow({
      where: { userId, sourceStartAt: new Date("2026-10-10T20:00:00Z") },
    });
    const evidence = busan.evidence as { pointIds: number[]; uncertainties: string[] };
    // The outlier is skipped by the detector, not masked away before it.
    expect(evidence.uncertainties).toContain("outliersIgnored");
    expect(evidence.pointIds).toEqual([100, 101, 102, 104, 105]);
  });
});

describe("TravTrack as the source", () => {
  let userId: string;
  const BASE = Date.parse("2026-10-10T10:00:00Z");

  /** A stop of `n` points every 10 minutes at `where`, starting `startMin` after BASE. */
  async function stop(where: { lat: number; lon: number }, startMin: number, n = 4) {
    for (let i = 0; i < n; i++) {
      await storePoint(userId, { t: BASE + (startMin + i * 10) * MIN, ...where });
    }
  }

  beforeAll(async () => {
    await switches.set({ beta: true, config: true });
    userId = await account("travtrack", "travtrack", false);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetAccount(userId);
    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "travtrack", dawarichBaseUrl: null, dawarichApiKey: null },
    });
  });

  it("TravTrack points yield a stay with provider travtrack, rev and algorithm 1, digests and no pointIds", async () => {
    await stop(SEOUL, 0);
    const rev = (await prisma.userSettings.findUniqueOrThrow({ where: { userId } }))
      .locationProviderRev;
    const result = await scanOnce(userId);
    expect(result.created).toBe(1);
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(row.provider).toBe("travtrack");
    expect(row.providerRev).toBe(rev);
    expect(row.algorithmVersion).toBe(1);
    expect(row.evidenceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(row.fingerprint).toBe(row.evidenceKey);
    const evidence = row.evidence as Record<string, unknown>;
    expect(evidence.source).toBe("travtrack");
    expect(evidence).not.toHaveProperty("pointIds");
    expect(evidence.pointDigests).toEqual([
      expect.stringMatching(/^[0-9a-f]{32}$/),
      expect.stringMatching(/^[0-9a-f]{32}$/),
      expect.stringMatching(/^[0-9a-f]{32}$/),
      expect.stringMatching(/^[0-9a-f]{32}$/),
    ]);
    expect(evidence.readCoverage).toBe("complete");
    expect(evidence.explanation).toEqual({
      code: "stay.dwell",
      params: { minutes: 30, points: 4, radiusM: 150, maxGapMinutes: 10 },
    });
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.provider).toBe("travtrack");
    expect(state.result).toBe("succeeded");
    // Nothing reaches the answer that names a point.
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{32}/);
  });

  it("the same stop seen in Dawarich and later in TravTrack is one finding", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: {
        locationProvider: "none",
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own-key"),
      },
    });
    const seen = [0, 10, 20, 30].map((m, i) => dawarichPoint(i + 1, BASE + m * MIN, SEOUL));
    await scanOnce(userId, { client: fakeClient(seen) });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);

    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "travtrack" },
    });
    // The same fixes reach TravTrack (copied, or recorded twice).
    await stop(SEOUL, 0);
    const result = await scanOnce(userId);
    expect(result).toMatchObject({ created: 0, points: 4 });
    const rows = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("dawarich");
  });

  it("a TravTrack market visit carries digests and its own explanation, and replaces its fragment", async () => {
    for (let i = 0; i < 21; i++) await storePoint(userId, { t: BASE + i * MIN, ...SEOUL });
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const result = await scanOnce(userId, {
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(marketRaw)),
    });
    expect(result.created).toBe(1);
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ provider: "travtrack", algorithmVersion: 1, name: "Test Market" });
    const evidence = row.evidence as Record<string, unknown>;
    expect(evidence).toMatchObject({
      kind: "market",
      source: "travtrack",
      explanation: { code: "market.visit", params: { minutes: 20, points: 21, radiusM: 20 } },
    });
    expect(evidence.pointDigests).toHaveLength(21);
    expect(evidence).not.toHaveProperty("pointIds");
  });

  it("a TravTrack venue never supersedes a Dawarich fragment, and deleting the venue's history leaves it byte-identical (Codex review)", async () => {
    // The Dawarich stop, inside the market's area, pending.
    await prisma.userSettings.update({
      where: { userId },
      data: {
        locationProvider: "none",
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own-key"),
      },
    });
    const seen = [0, 10, 20, 30].map((m, i) => dawarichPoint(i + 1, BASE + m * MIN, SEOUL));
    await scanOnce(userId, { client: fakeClient(seen) });
    const dawarich = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(dawarich).toMatchObject({ provider: "dawarich", status: "pending" });

    // TravTrack sees a market dwell over the same stop.
    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "travtrack" },
    });
    for (let i = 0; i < 21; i++) await storePoint(userId, { t: BASE + i * MIN, ...SEOUL });
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    await scanOnce(userId, {
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(marketRaw)),
    });
    const venue = await prisma.dawarichStay.findFirstOrThrow({
      where: { userId, provider: "travtrack" },
    });
    expect((venue.evidence as { kind?: string }).kind).toBe("market");
    expect((venue.evidence as { supersededFindingIds?: string[] }).supersededFindingIds).toEqual(
      []
    );
    expect(await prisma.dawarichStay.findUnique({ where: { id: dawarich.id } })).toEqual(dawarich);

    await deleteTravTrackRange(userId, new Date(BASE - MIN), new Date(BASE + 30 * MIN));
    expect(await prisma.dawarichStay.findUnique({ where: { id: venue.id } })).toBeNull();
    expect(await prisma.dawarichStay.findUnique({ where: { id: dawarich.id } })).toEqual(dawarich);
  });

  it("a TravTrack stay inside a privacy circle is not suggested and the result does not name it", async () => {
    await stop(SEOUL, 0);
    await stop(BUSAN, 120);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: BUSAN.lat, lon: BUSAN.lon, radiusM: 300 },
    });
    const result = await scanOnce(userId);
    expect(result).toMatchObject({ created: 1, skippedPrivate: 1 });
    const rows = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceLat).toBeCloseTo(SEOUL.lat, 4);
    const said = JSON.stringify(result);
    expect(said).not.toContain(String(BUSAN.lat));
    expect(said).not.toContain("Home");
  });

  it("a range deleted while the scan ran: the scan publishes nothing after the delete and records stale", async () => {
    await stop(SEOUL, 0, 5); // Five fixes: enough for a map tile lookup.
    await stop(BUSAN, 120);
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    // The map lookup runs between the read and the first insert: the delete lands there.
    const fetcher = jest.fn(async () => {
      await prisma.$transaction(async (tx) => {
        await deleteTravTrackRange(
          userId,
          new Date(BASE + 110 * MIN),
          new Date(BASE + 200 * MIN),
          tx
        );
        // E5's removal handler raises the generation in the removal's transaction.
        await bumpHistoryGeneration(tx, userId);
      });
      return Response.json({ elements: [] });
    });
    const result = await scanOnce(userId, { marketStore: memoryStore(), marketFetcher: fetcher });
    expect(fetcher).toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, stale: true });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.result).toBe("stale");
    expect(state.leaseUntil).toBeNull();
  });

  /** Holds the account's TravTrack lock in another transaction until released. */
  async function holdTravTrackLock() {
    let release!: () => void;
    let held!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await takeTravTrackLock(tx, userId);
        held();
        await released;
      },
      { timeout: 30_000 }
    );
    await isHeld;
    return async () => {
      release();
      await done;
    };
  }

  /** Until some transaction waits for an advisory lock (the scan's publication). */
  async function untilSomeoneWaitsForTheLock() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the scan never waited for the lock");
  }

  it("TravTrack switched off while the publication waits for the lock commits nothing", async () => {
    await stop(SEOUL, 0);
    await reserveScan(userId, now);
    const release = await holdTravTrackLock();
    const run = scanStays(userId, { now }).catch((e: unknown) => e);
    await untilSomeoneWaitsForTheLock();
    await switches.set({ beta: true, config: false });
    await release();
    expect(await run).toMatchObject({ statusCode: 502 });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state).toMatchObject({ result: "failed", error: "TRAVTRACK_DISABLED" });
  });

  it("consent withdrawn while the publication waits for the lock commits nothing", async () => {
    await stop(SEOUL, 0);
    await reserveScan(userId, now);
    const release = await holdTravTrackLock();
    const run = scanStays(userId, { now });
    await untilSomeoneWaitsForTheLock();
    // The withdrawal must not wait for the scan: it takes no lock the scan holds.
    const withdraw = prisma.dawarichStayScan.update({
      where: { userId },
      data: { enabled: false, leaseUntil: null },
    });
    await Promise.race([withdraw, new Promise((resolve) => setTimeout(resolve, 1000))]);
    await release();
    await withdraw;
    await run;
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });

  it("at most 20 new findings per run; the rest wait for the next run", async () => {
    for (let i = 0; i < 25; i++) {
      await stop({ lat: SEOUL.lat + i * 0.02, lon: SEOUL.lon }, i * 45, 3);
    }
    const first = await scanOnce(userId);
    expect(first).toMatchObject({ created: 20, deferred: 5 });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(20);
    const second = await scanOnce(userId);
    expect(second).toMatchObject({ created: 5, deferred: 0 });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(25);
  });

  it("scan now by a travtrack user with TravTrack off is 403 TRAVTRACK_DISABLED and reserves nothing", async () => {
    await switches.set({ beta: true, config: false });
    const res = await request(app)
      .post("/api/v1/dawarich-stays/scan")
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state).toMatchObject({ startedAt: null, leaseUntil: null, result: null });
  });

  it("a scan reserved while on stops when TravTrack is switched off before it reads", async () => {
    await stop(SEOUL, 0);
    await reserveScan(userId, now);
    await switches.set({ beta: true, config: false });
    await expect(scanStays(userId, { now })).rejects.toMatchObject({ statusCode: 502 });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state).toMatchObject({ result: "failed", error: "TRAVTRACK_DISABLED" });
  });
});

describe("which accounts the schedule and scan now reach", () => {
  let travtrackUser: string;
  let noneUser: string;

  async function waitForScan(userId: string) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
      if (state.result !== "running") return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("scan did not finish");
  }

  beforeAll(async () => {
    travtrackUser = await account("sched-travtrack", "travtrack", false);
    noneUser = await account("sched-none", "none", true);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetAccount(travtrackUser);
    await resetAccount(noneUser);
    const recent = Date.now() - 2 * 86_400_000;
    for (let i = 0; i < 4; i++) {
      await storePoint(travtrackUser, { t: recent + i * 10 * MIN, ...SEOUL });
    }
    routeClient.points = [0, 10, 20, 30].map((m, i) =>
      dawarichPoint(i + 1, recent + m * MIN, BUSAN)
    );
  });

  it("the scheduler scans a travtrack account while the instance is on and skips it when off", async () => {
    await runDawarichStaySweep();
    expect(
      (await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId: travtrackUser } })).result
    ).toBe("succeeded");
    expect(
      await prisma.dawarichStay.count({ where: { userId: travtrackUser, provider: "travtrack" } })
    ).toBe(1);

    await resetAccount(travtrackUser);
    await storePoint(travtrackUser, { t: Date.now() - 86_400_000, ...SEOUL });
    await switches.set({ beta: true, config: false });
    await runDawarichStaySweep();
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({
      where: { userId: travtrackUser },
    });
    expect(state).toMatchObject({ result: null, startedAt: null });
  });

  it("the scheduler still skips provider none with an own connection", async () => {
    await runDawarichStaySweep();
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId: noneUser } });
    expect(state.result).toBeNull();
    expect(await prisma.dawarichStay.count({ where: { userId: noneUser } })).toBe(0);
  });

  it("scan now by a provider-none user with an own connection reads Dawarich as before", async () => {
    await request(app)
      .post("/api/v1/dawarich-stays/scan")
      .set("Cookie", `auth_token=${generateToken(noneUser)}`)
      .send({})
      .expect(202);
    const state = await waitForScan(noneUser);
    expect(state).toMatchObject({ result: "succeeded", provider: "dawarich" });
    const rows = await prisma.dawarichStay.findMany({ where: { userId: noneUser } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "dawarich", algorithmVersion: 0 });
    expect(rows[0].sourceLat).toBeCloseTo(BUSAN.lat, 4);
  });
});
