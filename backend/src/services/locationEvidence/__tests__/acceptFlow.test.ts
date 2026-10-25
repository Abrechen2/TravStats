/**
 * Accepting a TravTrack suggestion (TravTrack plan E4; review focus 20-23):
 * claim, re-check, publish under the TravTrack lock with the generation
 * check. Idempotent, concurrent clicks write once, a crashed claim recovers,
 * an invalidation is committed before the 409, and the visit made by
 * accepting never counts as cover of its own finding. A Dawarich finding
 * accepts exactly as before.
 */
import request from "supertest";
import { prisma } from "../../../db";
import { createPrismaClient } from "../../../prismaClient";
import { generateToken } from "../../../utils/jwt";
import type { DawarichClient } from "../../dawarich/dawarichClient";
import { reserveScan, scanStays } from "../../dawarich/stays/scan";
import { resolveCoveredStays } from "../../dawarich/stays/coverage";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { wipeTravTrack } from "../../travtrack/__tests__/fixtures";
import { deleteTravTrackRange } from "../../travtrack/deleteRange";
import { bumpHistoryGeneration } from "../generation";
import * as recheckModule from "../recheck";
import { applyStayAcceptance } from "../../dawarich/stays/review";
import { stayReviewSchema } from "../../../schemas/dawarichStays";
import {
  BASE,
  MIN,
  NOW,
  SEOUL,
  evidenceAccount,
  holdTravTrackLock,
  range,
  seoulReview,
  storeMinutes,
  untilSomeoneWaitsForTheLock,
} from "./evidenceFixtures";

jest.mock("../../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
jest.mock("../../geo/nominatim", () => ({
  ...jest.requireActual("../../geo/nominatim"),
  completeAddressFromCoordinates: jest.fn(async () => null),
}));

import app from "../../../index";

const PREFIX = "evidence-accept-";
const switches = travTrackSwitches();
let userId: string;
let cookie: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
  await switches.set({ beta: true, config: true });
  userId = await evidenceAccount(`${PREFIX}a`);
  cookie = `auth_token=${generateToken(userId)}`;
});

beforeEach(async () => {
  await switches.set({ beta: true, config: true });
  await wipeTravTrack([userId]);
  await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.update({ where: { userId }, data: { leaseUntil: null } });
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

/** A 30-minute TravTrack stop in Seoul, scanned into one pending finding. */
async function finding() {
  await storeMinutes(userId, range(0, 30, 10));
  await reserveScan(userId, NOW);
  await scanStays(userId, { now: NOW });
  return prisma.dawarichStay.findFirstOrThrow({ where: { userId, status: "pending" } });
}

const accept = (id: string, as = cookie) =>
  request(app).post(`/api/v1/dawarich-stays/${id}/accept`).set("Cookie", as).send(seoulReview());
const reject = (id: string) =>
  request(app).post(`/api/v1/dawarich-stays/${id}/reject`).set("Cookie", cookie).send({});

describe("accepting a TravTrack finding", () => {
  it("accepting twice answers the same visit and writes one", async () => {
    const row = await finding();
    const first = await accept(row.id);
    expect(first.status).toBe(200);
    const second = await accept(row.id);
    expect(second.status).toBe(200);
    expect(second.body.data.visitId).toBe(first.body.data.visitId);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
    const stored = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ status: "accepted", claimToken: null, claimedAt: null });
    const visit = await prisma.placeVisit.findUniqueOrThrow({ where: { id: stored.visitId! } });
    expect(visit.suggestionRef).toBe(row.evidenceKey);
  });

  it("two concurrent accepts write one visit; the second gets SUGGESTION_ACCEPT_IN_PROGRESS, then the replay", async () => {
    const row = await finding();
    const release = await holdTravTrackLock(userId);
    const first = accept(row.id).then((r) => r);
    await untilSomeoneWaitsForTheLock();
    const second = await accept(row.id);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");
    await release();
    const done = await first;
    expect(done.status).toBe(200);
    const replay = await accept(row.id);
    expect(replay.status).toBe(200);
    expect(replay.body.data.visitId).toBe(done.body.data.visitId);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });

  it("a claim left by a crash is taken over after two minutes", async () => {
    const row = await finding();
    await prisma.dawarichStay.update({
      where: { id: row.id },
      data: {
        status: "accepting",
        claimToken: "crashed",
        claimedAt: new Date(Date.now() - 30_000),
      },
    });
    const fresh = await accept(row.id);
    expect(fresh.status).toBe(409);
    expect(fresh.body.code).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");
    await prisma.dawarichStay.update({
      where: { id: row.id },
      data: { claimedAt: new Date(Date.now() - 3 * 60_000) },
    });
    expect((await accept(row.id)).status).toBe(200);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });

  it("a lost response then a retry returns the first visit, not covered", async () => {
    const row = await finding();
    const first = await accept(row.id);
    // The answer never reached the phone; a later scan and the inbox read run.
    await resolveCoveredStays(userId);
    const retry = await accept(row.id);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ status: "accepted", visitId: first.body.data.visitId });
  });

  it("points deleted since the scan → 409 EVIDENCE_INVALIDATED, and the row is invalidated even when the response is lost", async () => {
    const row = await finding();
    await deleteTravTrackRange(userId, new Date(BASE - MIN), new Date(BASE + 60 * MIN));
    const res = await accept(row.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVIDENCE_INVALIDATED");
    const fresh = createPrismaClient();
    try {
      const stored = await fresh.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored).toMatchObject({ status: "invalidated", claimToken: null });
      expect(stored.resolvedAt).not.toBeNull();
    } finally {
      await fresh.$disconnect();
    }
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
  });

  it("a range deleted between re-check and publish invalidates instead of accepting", async () => {
    const row = await finding();
    const release = await holdTravTrackLock(userId);
    const pending = accept(row.id).then((r) => r);
    await untilSomeoneWaitsForTheLock();
    // The removal lands while the accept waits to publish, under the same lock.
    await release(async (tx) => {
      await deleteTravTrackRange(userId, new Date(BASE - MIN), new Date(BASE + 60 * MIN), tx);
      await bumpHistoryGeneration(tx, userId);
    });
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVIDENCE_INVALIDATED");
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "invalidated"
    );
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED, the finding stays pending, reject still works", async () => {
    const row = await finding();
    await switches.set({ beta: true, config: false });
    const res = await accept(row.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect(await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "pending",
      claimToken: null,
    });
    expect((await reject(row.id)).status).toBe(200);
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "rejected"
    );
  });

  it("a publisher whose claim was taken over writes nothing: the final write needs its token", async () => {
    const row = await finding();
    // Our claim went stale and another request took the finding over.
    await prisma.dawarichStay.update({
      where: { id: row.id },
      data: { status: "accepting", claimToken: "theirs", claimedAt: new Date() },
    });
    const claimed = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
    await expect(
      prisma.$transaction((tx) =>
        applyStayAcceptance(tx, userId, claimed, stayReviewSchema.parse(seoulReview()), {
          suggestionRef: row.evidenceKey,
          claimToken: "mine",
        })
      )
    ).rejects.toMatchObject({ code: "SUGGESTION_ACCEPT_IN_PROGRESS" });
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    expect(await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "accepting",
      claimToken: "theirs",
    });
  });

  it("evidence that cannot be checked answers EVIDENCE_UNVERIFIABLE and keeps the finding pending", async () => {
    const row = await finding();
    const spy = jest
      .spyOn(recheckModule, "recheckFinding")
      .mockResolvedValue({ outcome: "unverifiable", generation: 0n });
    try {
      const res = await accept(row.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("EVIDENCE_UNVERIFIABLE");
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "pending",
      claimToken: null,
    });
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
  });

  it("a claim abandoned by a failed request goes back to pending", async () => {
    const row = await finding();
    const res = await request(app)
      .post(`/api/v1/dawarich-stays/${row.id}/accept`)
      .set("Cookie", cookie)
      .send({ ...seoulReview(), tripId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(404);
    expect(await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "pending",
      claimToken: null,
    });
  });

  it("the pending list still offers a finding whose claim was left by a crash", async () => {
    const row = await finding();
    await prisma.dawarichStay.update({
      where: { id: row.id },
      data: {
        status: "accepting",
        claimToken: "crashed",
        claimedAt: new Date(Date.now() - 600_000),
      },
    });
    const res = await request(app).get("/api/v1/dawarich-stays").set("Cookie", cookie);
    expect(res.body.data.map((r: { id: string }) => r.id)).toContain(row.id);
  });
});

describe("the list a TravTrack finding is read from", () => {
  it("marks a finding made before the last source switch, and lists invalidated ones", async () => {
    const row = await finding();
    const list = async (status = "pending") =>
      (await request(app).get(`/api/v1/dawarich-stays?status=${status}`).set("Cookie", cookie)).body
        .data as Array<Record<string, unknown>>;
    expect((await list())[0]).not.toHaveProperty("beforeSourceSwitch");
    await prisma.userSettings.update({
      where: { userId },
      data: { locationProviderRev: { increment: 1 } },
    });
    expect((await list())[0]).toMatchObject({ id: row.id, beforeSourceSwitch: true });
    await deleteTravTrackRange(userId, new Date(BASE - MIN), new Date(BASE + 60 * MIN));
    expect((await accept(row.id)).status).toBe(409);
    expect((await list("invalidated")).map((r) => r.id)).toEqual([row.id]);
  });
});

describe("never self-evidence", () => {
  it("the visit made by accepting does not cover its own finding on the next scan, and covers a different overlapping one", async () => {
    const row = await finding();
    expect((await accept(row.id)).status).toBe(200);
    const base = {
      userId,
      sourceStartAt: row.sourceStartAt,
      sourceEndAt: row.sourceEndAt,
      sourceLat: row.sourceLat,
      sourceLon: row.sourceLon,
      startAt: row.startAt,
      endAt: row.endAt,
      lat: row.lat,
      lon: row.lon,
      zone: row.zone,
      pointCount: row.pointCount,
      evidence: row.evidence as object,
      provider: "travtrack",
    };
    // The same evidence key seen again (a second scan before the answer landed).
    const own = await prisma.dawarichStay.create({
      data: { ...base, fingerprint: "own-again", evidenceKey: row.evidenceKey },
    });
    const other = await prisma.dawarichStay.create({
      data: { ...base, fingerprint: "other", evidenceKey: "f".repeat(64) },
    });
    await resolveCoveredStays(userId);
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(
      "pending"
    );
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      "covered"
    );
  });
});

describe("accepts across providers", () => {
  /** Holds a row lock on one stay until released: a transaction touching it waits there. */
  async function holdStayRow(id: string) {
    let release!: () => void;
    let held!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM dawarich_stays WHERE id = ${id} FOR UPDATE`;
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

  async function untilSomeoneWaitsForARowLock() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("nobody waited for the row");
  }

  it("interleaved Dawarich and TravTrack accepts of one stop make one place and one visit", async () => {
    const travtrack = await finding();
    const dawarich = await prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: "dawarich-copy",
        provider: "dawarich",
        sourceStartAt: travtrack.sourceStartAt,
        sourceEndAt: travtrack.sourceEndAt,
        sourceLat: travtrack.sourceLat,
        sourceLon: travtrack.sourceLon,
        startAt: travtrack.startAt,
        endAt: travtrack.endAt,
        lat: travtrack.lat,
        lon: travtrack.lon,
        zone: travtrack.zone,
        pointCount: 4,
        evidence: {
          source: "dawarich",
          zone: travtrack.zone,
          pointIds: [1, 2, 3, 4],
          maxGapMinutes: 10,
          uncertainties: [],
        },
      },
    });
    // The Dawarich accept starts, reads, and stalls on its finding's row …
    const release = await holdStayRow(dawarich.id);
    const fromDawarich = accept(dawarich.id).then((r) => r);
    await untilSomeoneWaitsForARowLock();
    // … while the TravTrack accept of the same stop runs.
    const fromTravTrack = accept(travtrack.id).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await release();
    const [a, b] = await Promise.all([fromDawarich, fromTravTrack]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
    expect(a.body.data.visitId).toBe(b.body.data.visitId);
  });
});

describe("a Dawarich finding", () => {
  it("accepts exactly as before — no re-check, no claim columns written", async () => {
    const dawarichUser = await evidenceAccount(`${PREFIX}dawarich`, "none", true);
    const client: DawarichClient = {
      checkHealth: async () => ({ reachable: true, version: null }),
      getPoints: async () => ({
        points: [0, 10, 20, 30].map((m, i) => ({
          id: i + 1,
          latitude: SEOUL.lat,
          longitude: SEOUL.lon,
          timestampMs: BASE + m * MIN,
          accuracy: 10,
          altitude: null,
          velocity: null,
          trackId: null,
        })),
        truncated: false,
      }),
    };
    await reserveScan(dawarichUser, NOW);
    await scanStays(dawarichUser, { now: NOW, client });
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId: dawarichUser } });
    // TravTrack's switch is not Dawarich's business.
    await switches.set({ beta: true, config: false });
    const res = await accept(row.id, `auth_token=${generateToken(dawarichUser)}`);
    expect(res.status).toBe(200);
    const stored = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ status: "accepted", claimToken: null, claimedAt: null });
    const visit = await prisma.placeVisit.findUniqueOrThrow({ where: { id: stored.visitId! } });
    expect(visit.suggestionRef).toBeNull();
  });
});
