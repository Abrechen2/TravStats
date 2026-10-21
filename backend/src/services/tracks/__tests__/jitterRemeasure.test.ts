import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import type { DawarichClient, DawarichPoint } from "../../dawarich/dawarichClient";
import { DawarichError } from "../../dawarich/errors";
import { ingestTrack } from "../../tour/tracks/ingestTrack";
import { toParsedTrack } from "../../tour/tracks/pullDawarichTrack";
import { remeasureStoredTracks, type DawarichSource } from "../jitterRemeasure";
import { runTrackJitterRemeasure } from "../../../jobs/trackJitterRemeasureScheduler";
import { standThenMove, type SyntheticFix } from "./jitterFixtures";

/**
 * The one-time re-measure of recordings stored before the jitter filter
 * (forgejo#319). Only a Dawarich pull still has its raw points somewhere, so
 * only it is re-measured — and only when Dawarich still holds exactly the
 * points the row was measured from. Everything else stays as recorded.
 */

const PREFIX = "jitremeasure";
const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);

const rec = standThenMove({
  at: { lat: 60.39, lon: 5.32 },
  startMs: T0,
  standMinutes: 20,
  wanderM: 30,
  kmh: 60,
  moveSeconds: 600,
  stepS: 30,
});

function dawarichPoints(fixes: readonly SyntheticFix[]): DawarichPoint[] {
  return fixes.map((f, i) => ({
    id: i + 1,
    latitude: f.lat,
    longitude: f.lon,
    timestampMs: f.t,
    altitude: null,
    accuracy: null,
    velocity: null,
    trackId: null,
  }));
}

/** A row as the pull wrote it before the filter: every fix measured, nothing marked. */
function oldColumns(fixes: readonly SyntheticFix[]) {
  const ingested = ingestTrack(toParsedTrack(dawarichPoints(fixes)))!;
  return {
    startedAt: ingested.startedAt,
    endedAt: ingested.endedAt,
    geometry: ingested.geometry as unknown as Prisma.InputJsonValue,
    segmentStarts: ingested.segmentStarts as unknown as Prisma.InputJsonValue,
    cumulativeKm: ingested.cumulativeKm as unknown as Prisma.InputJsonValue,
    pointCount: ingested.pointCount,
    distanceKm: ingested.distanceKm,
  };
}

/** Pulls answered by every fake Dawarich, for the tests that count retries. */
const pulls = { count: 0 };

function fakeClient(points: DawarichPoint[] | Error): DawarichSource {
  const client: DawarichClient = {
    checkHealth: async () => ({ ok: true }) as never,
    getPoints: async (window) => {
      pulls.count += 1;
      if (points instanceof Error) throw points;
      return {
        points: points.filter(
          (p) =>
            p.timestampMs >= window.startAt.getTime() && p.timestampMs <= window.endAt.getTime()
        ),
        truncated: false,
      };
    },
  };
  return { client, sourceUrl: "https://dawarich.test" };
}

describe("re-measuring recordings stored before the jitter filter", () => {
  let userId: string;
  let strangerId: string;
  let routeId: string;
  let cruiseId: string;
  let portIds: number[] = [];
  const clients = new Map<string, DawarichSource | null>();
  const clientFor = async (id: string) => clients.get(id) ?? null;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = (await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } })).id;
    strangerId = (await prisma.user.create({ data: { username: `${PREFIX}b`, passwordHash: "x" } }))
      .id;
    const ports = await Promise.all(
      [60.39, 60.5].map((lat, i) =>
        prisma.port.create({
          data: { name: `Jitter Port ${i}`, lat, lon: 5.32, isUserAdded: true },
        })
      )
    );
    portIds = ports.map((p) => p.id);
  });

  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.cruise.deleteMany({ where: { userId } });
    routeId = (await prisma.tripRoute.create({ data: { userId, name: "Fjord", mode: "road" } })).id;
    cruiseId = (
      await prisma.cruise.create({
        data: {
          userId,
          departurePortId: portIds[0],
          arrivalPortId: portIds[1],
          status: "completed",
        },
      })
    ).id;
    clients.set(userId, fakeClient(dawarichPoints(rec.fixes)));
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.$disconnect();
  });

  const tourTrack = (data: Partial<Prisma.TripRouteTrackUncheckedCreateInput> = {}) =>
    prisma.tripRouteTrack.create({
      data: { routeId, source: "dawarich", ...oldColumns(rec.fixes), ...data },
    });

  it("re-pulls a Dawarich tour track and stores the filtered line and distance", async () => {
    const row = await tourTrack();
    expect(row.distanceKm).toBeGreaterThan(rec.trueKm + 1);

    const report = await remeasureStoredTracks({ limit: 50, attempted: new Set(), clientFor });

    expect(report.remeasured).toBeGreaterThanOrEqual(1);
    const after = await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.jitterDropped).toBeGreaterThanOrEqual(rec.standing - 3);
    expect(after.pointCount).toBe(rec.fixes.length);
    expect(Math.abs(after.distanceKm - rec.trueKm) / rec.trueKm).toBeLessThan(0.02);
    expect(after.startedAt).toEqual(row.startedAt);
    expect(after.endedAt).toEqual(row.endedAt);
  });

  it("re-pulls a Dawarich cruise track and recomputes the cruise in the same write", async () => {
    const row = await prisma.cruiseTrack.create({
      data: { cruiseId, source: "dawarich", ...oldColumns(rec.fixes) },
    });
    await remeasureStoredTracks({ limit: 50, attempted: new Set(), clientFor });
    const after = await prisma.cruiseTrack.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.jitterDropped).toBeGreaterThan(0);
    expect(after.distanceKm).toBeLessThan(row.distanceKm);
  });

  it("leaves a row alone when Dawarich no longer holds the points it was measured from", async () => {
    const row = await tourTrack();
    const extra = { ...rec.fixes[5], t: rec.fixes[5].t + 1000 };
    clients.set(
      userId,
      fakeClient(dawarichPoints([...rec.fixes, extra].sort((a, b) => a.t - b.t)))
    );

    const report = await remeasureStoredTracks({ limit: 50, attempted: new Set(), clientFor });

    expect(report.skipped.sourceChanged).toBeGreaterThanOrEqual(1);
    const after = await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.jitterDropped).toBeNull();
    expect(after.distanceKm).toBe(row.distanceKm);
  });

  it("leaves a row alone when Dawarich is unreachable or not configured, and says why", async () => {
    const mine = await tourTrack();
    const strangerRoute = await prisma.tripRoute.create({
      data: { userId: strangerId, name: "Elsewhere", mode: "road" },
    });
    const theirs = await prisma.tripRouteTrack.create({
      data: { routeId: strangerRoute.id, source: "dawarich", ...oldColumns(rec.fixes) },
    });
    clients.set(userId, fakeClient(new DawarichError("unreachable", "down")));

    const report = await remeasureStoredTracks({ limit: 50, attempted: new Set(), clientFor });

    expect(report.skipped.unavailable).toBeGreaterThanOrEqual(1);
    expect(report.skipped.notConfigured).toBeGreaterThanOrEqual(1);
    for (const id of [mine.id, theirs.id]) {
      const after = await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id } });
      expect(after.jitterDropped).toBeNull();
    }
  });

  it("never touches a file upload, a truncated pull, or a row already measured", async () => {
    const gpx = await tourTrack({ source: "gpx" });
    const truncated = await tourTrack({ truncated: true });
    const measured = await tourTrack({ jitterDropped: 4 });

    const attempted = new Set<string>();
    await remeasureStoredTracks({ limit: 500, attempted, clientFor });

    for (const row of [gpx, truncated, measured]) {
      expect(attempted.has(row.id)).toBe(false);
      const after = await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.distanceKm).toBe(row.distanceKm);
      expect(after.jitterDropped).toBe(row.jitterDropped);
    }
  });

  it("works in bounded batches and resumes where it stopped", async () => {
    const rows = await Promise.all([tourTrack(), tourTrack(), tourTrack()]);
    const attempted = new Set<string>();
    const first = await remeasureStoredTracks({ limit: 1, attempted, clientFor });
    expect(first.examined).toBe(1);

    // The whole run: batch after batch until nothing is left to try.
    await runTrackJitterRemeasure(0, { clientFor });
    for (const row of rows) {
      const after = await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.jitterDropped).not.toBeNull();
    }
    // A second run finds none of them again.
    const again = new Set<string>();
    await remeasureStoredTracks({ limit: 500, attempted: again, clientFor });
    for (const row of rows) expect(again.has(row.id)).toBe(false);
  });

  // Review findings 4 and 5 (forgejo#319).

  it("refuses a source whose points differ although their number matches", async () => {
    const row = await tourTrack();
    // Same count and span, every position moved 200 m: an edited history or
    // another person's Dawarich behind the same account.
    const moved = rec.fixes.map((f) => ({ ...f, lat: f.lat + 0.0018 }));
    clients.set(userId, fakeClient(dawarichPoints(moved)));

    const report = await remeasureStoredTracks({ limit: 50, attempted: new Set(), clientFor });

    expect(report.skipped.sourceChanged).toBeGreaterThanOrEqual(1);
    const after = await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.jitterDropped).toBeNull();
    expect(after.geometry).toEqual(row.geometry);
    const record = await prisma.trackJitterRemeasure.findUniqueOrThrow({
      where: { routeTrackId: row.id },
    });
    expect(record).toMatchObject({ outcome: "sourceChanged", nextAttemptAt: null });
  });

  it("keeps the replaced measurement so a re-measure can be undone", async () => {
    const row = await tourTrack();
    await remeasureStoredTracks({ limit: 50, attempted: new Set(), clientFor });
    const record = await prisma.trackJitterRemeasure.findUniqueOrThrow({
      where: { routeTrackId: row.id },
    });
    expect(record.outcome).toBe("remeasured");
    expect(record.previous).toMatchObject({
      distanceKm: row.distanceKm,
      pointCount: row.pointCount,
      geometry: row.geometry,
      sourceUrl: "https://dawarich.test",
    });
  });

  it("never tries a final skip again, in any later run", async () => {
    const row = await tourTrack();
    clients.set(userId, fakeClient(dawarichPoints(rec.fixes.slice(1))));
    await runTrackJitterRemeasure(0, { clientFor });
    const before = pulls.count;
    await runTrackJitterRemeasure(0, { clientFor });
    expect(pulls.count).toBe(before);
    const record = await prisma.trackJitterRemeasure.findUniqueOrThrow({
      where: { routeTrackId: row.id },
    });
    expect(record.attempts).toBe(1);
  });

  it("backs off an unreachable Dawarich across runs instead of retrying at once", async () => {
    const row = await tourTrack();
    clients.set(userId, fakeClient(new DawarichError("unreachable", "down")));
    await runTrackJitterRemeasure(0, { clientFor });
    const record = await prisma.trackJitterRemeasure.findUniqueOrThrow({
      where: { routeTrackId: row.id },
    });
    expect(record.outcome).toBe("unavailable");
    expect(record.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    const before = pulls.count;
    await runTrackJitterRemeasure(0, { clientFor });
    expect(pulls.count).toBe(before);
  });

  it("stops a user's backlog after three failures of their connection in a row", async () => {
    await Promise.all(Array.from({ length: 6 }, () => tourTrack()));
    clients.set(userId, fakeClient(new DawarichError("unreachable", "down")));
    const before = pulls.count;
    await runTrackJitterRemeasure(0, { clientFor });
    expect(pulls.count - before).toBe(3);
  });
});
