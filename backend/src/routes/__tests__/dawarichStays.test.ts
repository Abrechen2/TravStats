import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import { DawarichError } from "../../services/dawarich/errors";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";
jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
const now = new Date("2026-10-11T06:00:00Z");
const points: DawarichPoint[] = [0, 10, 20, 30].map((m, i) => ({
  id: i + 1,
  latitude: 37.57,
  longitude: 126.97,
  timestampMs: Date.parse("2026-10-10T14:50:00Z") + m * 60_000,
  accuracy: 10,
  altitude: null,
  velocity: null,
  trackId: null,
}));
const client: DawarichClient = {
  checkHealth: async () => ({ reachable: true, version: null }),
  getPoints: async () => ({ points, truncated: false }),
};
let userId: string, otherId: string, cookie: string;
const api = () => request(app);
const review = {
  name: "Seoul stop",
  placeId: null,
  tripId: null,
  lat: 37.57,
  lon: 126.97,
  startAt: { local: "2026-10-10T23:50" },
  endAt: { local: "2026-10-11T00:20" },
};
async function scan() {
  await reserveScan(userId);
  await scanStays(userId, { now, client });
  return prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
}
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  otherId = (
    await prisma.user.create({
      data: { username: `stay-other-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});
beforeEach(async () => {
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.upsert({
    where: { userId },
    create: { userId, enabled: true },
    update: { enabled: true, leaseUntil: null, result: null },
  });
});
describe("Dawarich stay review (forgejo#294)", () => {
  it("requires own connection and explicit opt-in; Immich cannot enable it", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: false } });
    await expect(reserveScan(userId)).rejects.toMatchObject({ statusCode: 409 });
    const r = await api()
      .patch("/api/v1/dawarich-stays/settings")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DAWARICH_OWN_CONNECTION_REQUIRED");
  });
  it("stores only suggestions, matches an own place, and repeated scans do not duplicate them", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Palace", lat: 37.57, lon: 126.97 },
    });
    const first = await scan();
    expect(first.placeId).toBe(place.id);
    await scan();
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.pointCount).toBe(4);
    expect(state.dataThrough?.toISOString()).toBe("2026-10-10T15:20:00.000Z");
  });
  it("keeps rejection memory across repeat scans", async () => {
    const row = await scan();
    expect(
      (await api().post(`/api/v1/dawarich-stays/${row.id}/reject`).set("Cookie", cookie).send({}))
        .status
    ).toBe(200);
    await scan();
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
    expect(await prisma.dawarichStay.count({ where: { userId, status: "pending" } })).toBe(0);
  });
  it("accepts corrected local times across midnight once and preserves original evidence", async () => {
    const row = await scan();
    const url = `/api/v1/dawarich-stays/${row.id}/accept`;
    const first = await api()
      .post(url)
      .set("Cookie", cookie)
      .send({ ...review, startAt: { local: "2026-10-10T23:55" } });
    expect(first.status).toBe(200);
    const second = await api().post(url).set("Cookie", cookie).send(review);
    expect(second.body.data.visitId).toBe(first.body.data.visitId);
    const visit = await prisma.placeVisit.findUniqueOrThrow({
      where: { id: first.body.data.visitId },
    });
    expect(visit.visitedAtUtc?.toISOString()).toBe("2026-10-10T14:55:00.000Z");
    expect(visit.visitedZone).toBe("Asia/Seoul");
    expect(first.body.data.sourceStartAt).toBe("2026-10-10T14:50:00.000Z");
    await scan();
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });
  it("reuses a visit in the same interval, but keeps two separate visits to the same place", async () => {
    const row = await scan();
    const first = await api()
      .post(`/api/v1/dawarich-stays/${row.id}/accept`)
      .set("Cookie", cookie)
      .send(review);
    const second = await prisma.dawarichStay.create({
      data: { ...row, id: undefined, fingerprint: "repeat-visit", status: "pending" },
    });
    const accepted = await api()
      .post(`/api/v1/dawarich-stays/${second.id}/accept`)
      .set("Cookie", cookie)
      .send(review);
    expect(accepted.body.data.visitId).toBe(first.body.data.visitId);
    const third = await prisma.dawarichStay.create({
      data: { ...row, id: undefined, fingerprint: "later-visit", status: "pending" },
    });
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${third.id}/accept`)
          .set("Cookie", cookie)
          .send({
            ...review,
            startAt: { local: "2026-10-11T05:00" },
            endAt: { local: "2026-10-11T06:00" },
          })
      ).status
    ).toBe(200);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(2);
  });
  it("never accepts somebody else's place or finding", async () => {
    const row = await scan();
    const foreign = await prisma.place.create({
      data: { userId: otherId, name: "Private", lat: 37.57, lon: 126.97 },
    });
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${row.id}/accept`)
          .set("Cookie", cookie)
          .send({ ...review, placeId: foreign.id })
      ).status
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${row.id}/reject`)
          .set("Cookie", `auth_token=${generateToken(otherId)}`)
          .send({})
      ).status
    ).toBe(404);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
  });
  it("reports upstream failure without erasing previous findings or pretending data is fresh", async () => {
    await scan();
    await reserveScan(userId);
    await expect(
      scanStays(userId, {
        now,
        client: {
          ...client,
          getPoints: async () => {
            throw new DawarichError("unreachable", "offline");
          },
        },
      })
    ).rejects.toMatchObject({ statusCode: 502 });
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.error).toBe("unreachable");
    expect(state.result).toBe("failed");
    expect(state.dataThrough?.toISOString()).toBe("2026-10-10T15:20:00.000Z");
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
  });
  it("excludes overlapping scans and permits recovery from an expired lease", async () => {
    await reserveScan(userId);
    await expect(reserveScan(userId)).rejects.toMatchObject({ statusCode: 409 });
    await prisma.dawarichStayScan.update({ where: { userId }, data: { leaseUntil: new Date(0) } });
    await expect(reserveScan(userId)).resolves.toBeUndefined();
  });
  it("refuses invalid intervals without creating any place or visit", async () => {
    const row = await scan();
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${row.id}/accept`)
          .set("Cookie", cookie)
          .send({ ...review, endAt: { local: "2026-10-10T20:00" } })
      ).status
    ).toBe(400);
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "pending"
    );
  });
  it("serializes simultaneous acceptance without creating duplicate visits", async () => {
    const row = await scan();
    const results = await Promise.all(
      [1, 2].map(() =>
        api().post(`/api/v1/dawarich-stays/${row.id}/accept`).set("Cookie", cookie).send(review)
      )
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(new Set(results.map((r) => r.body.data.visitId)).size).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });
  it("matches a trip on the place's local day and identifies an existing visit", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Korea midnight",
        startDate: new Date("2026-10-11"),
        endDate: new Date("2026-10-11"),
      },
    });
    const place = await prisma.place.create({
      data: { userId, name: "Already recorded", lat: 37.57, lon: 126.97 },
    });
    const visit = await prisma.placeVisit.create({
      data: {
        userId,
        placeId: place.id,
        tripId: trip.id,
        visitedAt: new Date("2026-10-11T00:00:00Z"),
        visitedAtUtc: new Date("2026-10-10T15:00:00Z"),
        visitedZone: "Asia/Seoul",
        visitedPrecision: "minute",
      },
    });
    const row = await scan();
    expect(row.tripId).toBe(trip.id);
    expect(row.evidence).toMatchObject({ matchingVisitId: visit.id });
    const result = await api()
      .post(`/api/v1/dawarich-stays/${row.id}/accept`)
      .set("Cookie", cookie)
      .send({ ...review, tripId: trip.id, placeId: place.id });
    expect(result.body.data.visitId).toBe(visit.id);
    await prisma.trip.delete({ where: { id: trip.id } });
  });
  it("survives fifty cycles with outages without reviving a rejected finding", async () => {
    const row = await scan();
    await api().post(`/api/v1/dawarich-stays/${row.id}/reject`).set("Cookie", cookie).send({});
    for (let cycle = 0; cycle < 50; cycle++) {
      await reserveScan(userId);
      const failed = cycle % 5 === 0;
      const run = scanStays(userId, {
        now,
        client: {
          ...client,
          getPoints: async () => {
            if (failed) throw new DawarichError("unreachable", "synthetic outage");
            return {
              points: [
                ...points,
                { ...points[3], id: 5, timestampMs: points[3].timestampMs + 600_000 },
              ],
              truncated: cycle % 3 === 0,
            };
          },
        },
      });
      if (failed) await expect(run).rejects.toMatchObject({ statusCode: 502 });
      else await run;
      expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
      expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    }
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "rejected"
    );
  });
  it("serializes a burst of twelve accept requests into one visit", async () => {
    const row = await scan();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        api().post(`/api/v1/dawarich-stays/${row.id}/accept`).set("Cookie", cookie).send(review)
      )
    );
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
  });
  it("does not create a finding when consent is revoked during the upstream request", async () => {
    await reserveScan(userId);
    await scanStays(userId, {
      now,
      client: {
        ...client,
        getPoints: async () => {
          await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: false } });
          return { points, truncated: false };
        },
      },
    });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });
  it.each([false, true])(
    "a superseded scan cannot overwrite the current lease (upstream failure=%s)",
    async (fail) => {
      await reserveScan(userId);
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((r) => {
        entered = r;
      });
      const blocked = new Promise<void>((r) => {
        release = r;
      });
      const old = scanStays(userId, {
        now,
        client: {
          ...client,
          getPoints: async () => {
            entered();
            await blocked;
            if (fail) throw new DawarichError("unreachable", "late outage");
            return { points, truncated: false };
          },
        },
      }).catch(() => null);
      await waiting;
      await prisma.dawarichStayScan.update({
        where: { userId },
        data: { leaseUntil: new Date(0) },
      });
      const takeover = new Date(Date.now() + 1000);
      await reserveScan(userId, takeover);
      release();
      await old;
      const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
      expect(state.result).toBe("running");
      expect(state.startedAt).toEqual(takeover);
      expect(state.leaseUntil).not.toBeNull();
      expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
    }
  );
});
