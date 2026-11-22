import { prisma } from "../../../../db";
import { clearJobs } from "../../../jobs/jobRegistry";
import { resetProviderBudget } from "../providerBudget";
import {
  cancelRerouteRun,
  executeRerouteRun,
  nextQuotaWindow,
  resumeDueRerouteRuns,
  type RunDeps,
} from "../rerouteRun";
import type { RouteFailure, RouteProvider, RouteRequest, RouteResult } from "../types";

/**
 * forgejo#436: the bulk re-route. Each test names the defect it guards:
 * a straight-only pass touching routed lines, a quota hit losing its place,
 * a failed call downgrading a stored line, a drawn or recorded leg replaced,
 * a cancel that keeps going.
 */

const A = { lat: 53.55, lon: 9.99 };
const B = { lat: 54.5, lon: 11.22 };

type Answer = RouteResult | RouteFailure | null;
function fakeProvider(answer: (req: RouteRequest) => Answer, id: RouteProvider["id"] = "custom") {
  const calls: RouteRequest[] = [];
  const provider: RouteProvider = {
    id,
    route: async (req) => {
      calls.push(req);
      return answer(req);
    },
  };
  return { provider, calls };
}
const okLine = (): RouteResult => ({
  waypoints: [
    [A.lon, A.lat],
    [10.5, 54],
    [B.lon, B.lat],
  ],
  distanceKm: 200,
  drivingMinutes: 150,
});

describe("bulk re-route run", () => {
  let userId: string;
  let routeId: string;
  const deps = (provider: RouteProvider | null, extra: Partial<RunDeps> = {}): RunDeps => ({
    pauseMs: () => 0,
    resolveProvider: async () => provider,
    ...extra,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rerouterun" } });
    userId = (await prisma.user.create({ data: { username: "rerouterun", passwordHash: "x" } })).id;
    routeId = (
      await prisma.tripRoute.create({
        data: { userId, name: "Nord", mode: "road", kind: "roadtrip" },
      })
    ).id;
  });
  beforeEach(() => {
    resetProviderBudget();
    clearJobs();
  });
  afterEach(async () => {
    await prisma.tripRouteLeg.deleteMany({ where: { routeId } });
    await prisma.tripStop.deleteMany({ where: { routeId } });
    await prisma.busJourney.deleteMany({ where: { userId } });
    await prisma.rerouteRun.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  let stopSeq = 10;
  /** Every leg needs its own stop pair: (route, from, to) is unique. */
  const leg = async (source: string, extra: Record<string, unknown> = {}) => {
    const mk = (title: string, p: { lat: number; lon: number }) =>
      prisma.tripStop.create({
        data: { title, lat: p.lat, lon: p.lon, routeId, routeOrderIdx: stopSeq++ },
      });
    const [from, to] = [await mk("a", A), await mk("b", B)];
    return prisma.tripRouteLeg.create({
      data: {
        routeId,
        fromStopId: from.id,
        toStopId: to.id,
        distanceKm: 111,
        source,
        mode: "road",
        ...(source === "routed" || source === "drawn"
          ? {
              waypoints: [
                [A.lon, A.lat],
                [B.lon, B.lat],
              ],
            }
          : {}),
        ...extra,
      },
    });
  };
  const run = (mode: "straight" | "all", scope: "instance" | "roadtrip" = "instance") =>
    prisma.rerouteRun.create({
      data: {
        userId,
        scope,
        mode,
        status: "running",
        routeId: scope === "roadtrip" ? routeId : null,
      },
    });
  const legOf = (id: string) => prisma.tripRouteLeg.findUniqueOrThrow({ where: { id } });

  it("only-straight mode routes straight legs and leaves routed ones alone", async () => {
    const straight = await leg("straight");
    const routed = await leg("routed", { distanceKm: 99 });
    const { provider, calls } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("straight")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "done", processed: 1, routed: 1 });
    expect(calls).toHaveLength(1);
    expect(await legOf(straight.id)).toMatchObject({ source: "routed", distanceKm: 200 });
    expect(await legOf(routed.id)).toMatchObject({ source: "routed", distanceKm: 99 });
  });

  it("all mode routes the provider's earlier lines again", async () => {
    const routed = await leg("routed", { distanceKm: 99 });
    const { provider } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("all")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "done", routed: 1 });
    expect(await legOf(routed.id)).toMatchObject({ source: "routed", distanceKm: 200 });
  });

  it("a hand-drawn or recorded leg is never replaced, not even in all mode", async () => {
    const drawn = await leg("drawn");
    const track = await leg("track");
    const { provider, calls } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("all")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "done", total: 0, processed: 0 });
    expect(calls).toHaveLength(0);
    expect((await legOf(drawn.id)).source).toBe("drawn");
    expect((await legOf(track.id)).source).toBe("track");
  });

  it("a leg drawn while the provider answers keeps the drawn line", async () => {
    const l = await leg("straight");
    const { provider } = fakeProvider(() => okLine());
    const slow: RouteProvider = {
      id: "custom",
      route: async (req) => {
        await prisma.tripRouteLeg.update({ where: { id: l.id }, data: { source: "drawn" } });
        return provider.route(req);
      },
    };
    const r = await executeRerouteRun((await run("straight")).id, undefined, deps(slow));
    expect(r).toMatchObject({ routed: 0, kept: 1, failureCounts: { changed: 1 } });
    expect((await legOf(l.id)).source).toBe("drawn");
  });

  it("a failed call keeps the stored geometry and names the reason", async () => {
    const l = await leg("routed", { distanceKm: 99 });
    const before = await legOf(l.id);
    const { provider } = fakeProvider(() => ({ failure: "no_route" }));
    const r = await executeRerouteRun((await run("all")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "done", routed: 0, kept: 1, failureCounts: { no_route: 1 } });
    expect(r.failureSample).toEqual([{ kind: "leg", id: l.id, reason: "no_route" }]);
    const after = await legOf(l.id);
    expect(after.waypoints).toEqual(before.waypoints);
    expect(after).toMatchObject({ source: "routed", distanceKm: 99 });
  });

  it("stops at the quota, keeps the cursor, and resumes the next day where it stopped", async () => {
    const legs = [await leg("straight"), await leg("straight"), await leg("straight")];
    legs.sort((x, y) => x.id.localeCompare(y.id));
    let answered = 0;
    const { provider } = fakeProvider(() =>
      answered++ < 2 ? okLine() : { failure: "rate_limited" }
    );
    const created = await run("straight");
    const first = await executeRerouteRun(created.id, undefined, deps(provider));
    expect(first).toMatchObject({
      status: "paused",
      stopReason: "rate_limited",
      processed: 2,
      routed: 2,
    });
    expect(first.resumeAfter).not.toBeNull();
    expect(new Date(first.resumeAfter!).getTime()).toBeGreaterThan(Date.now());
    expect((await legOf(legs[2].id)).source).toBe("straight");

    // Not due yet: the scheduler leaves it.
    expect(await resumeDueRerouteRuns(new Date(), deps(provider))).toBe(0);

    const next = fakeProvider(okLine);
    const second = await executeRerouteRun(created.id, undefined, deps(next.provider));
    expect(second).toMatchObject({ status: "done", processed: 3, routed: 3 });
    // Only the leg the quota refused is asked again.
    expect(next.calls).toHaveLength(1);
  });

  it("the daily scheduler tick starts a paused run once its window has opened", async () => {
    await leg("straight");
    const created = await prisma.rerouteRun.create({
      data: {
        userId,
        scope: "instance",
        mode: "straight",
        status: "paused",
        stopReason: "rate_limited",
        resumeAfter: new Date(Date.now() - 1000),
      },
    });
    const { provider } = fakeProvider(okLine);
    expect(await resumeDueRerouteRuns(new Date(), deps(provider))).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    const { settleAllJobs } = await import("../../../jobs/jobRegistry");
    await settleAllJobs();
    expect((await prisma.rerouteRun.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(
      "done"
    );
  });

  it("stops the whole run on a refused key instead of failing every leg", async () => {
    await leg("straight");
    await leg("straight");
    const { provider, calls } = fakeProvider(() => ({ failure: "auth" }));
    const r = await executeRerouteRun((await run("straight")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "failed", stopReason: "auth", processed: 0 });
    expect(calls).toHaveLength(1);
  });

  it("fails with provider_off when no provider is usable", async () => {
    const l = await leg("straight");
    const r = await executeRerouteRun((await run("straight")).id, undefined, deps(null));
    expect(r).toMatchObject({ status: "failed", stopReason: "no_provider" });
    expect((await legOf(l.id)).source).toBe("straight");
  });

  it("one account without a provider keeps its lines and the pass goes on to the next account", async () => {
    const other = await prisma.user.create({
      data: { username: "rerouterun2", passwordHash: "x" },
    });
    const oroute = await prisma.tripRoute.create({
      data: { userId: other.id, name: "Other", mode: "road", kind: "roadtrip" },
    });
    const oa = await prisma.tripStop.create({
      data: { title: "a", lat: A.lat, lon: A.lon, routeId: oroute.id },
    });
    const ob = await prisma.tripStop.create({
      data: { title: "b", lat: B.lat, lon: B.lon, routeId: oroute.id },
    });
    const theirs = await prisma.tripRouteLeg.create({
      data: {
        routeId: oroute.id,
        fromStopId: oa.id,
        toStopId: ob.id,
        distanceKm: 1,
        source: "straight",
        mode: "road",
      },
    });
    const mine = await leg("straight");
    const { provider } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("straight")).id, undefined, {
      pauseMs: () => 0,
      resolveProvider: async (uid) => (uid === other.id ? null : provider),
    });
    expect(r).toMatchObject({
      status: "done",
      routed: 1,
      kept: 1,
      failureCounts: { no_provider: 1 },
    });
    expect((await legOf(mine.id)).source).toBe("routed");
    expect((await legOf(theirs.id)).source).toBe("straight");
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("a cancelled run is not revived by a resume that picked it up before the cancel", async () => {
    await leg("straight");
    const created = await run("straight");
    await cancelRerouteRun(created.id, { userId });
    const { provider, calls } = fakeProvider(okLine);
    const r = await executeRerouteRun(created.id, undefined, deps(provider));
    expect(r.status).toBe("cancelled");
    expect(calls).toHaveLength(0);
  });

  it("cancel ends the run before the next item and keeps what was written", async () => {
    await leg("straight");
    await leg("straight");
    await leg("straight");
    const created = await run("straight");
    const { provider } = fakeProvider(() => okLine());
    let n = 0;
    const cancelling: RouteProvider = {
      id: "custom",
      route: async (req) => {
        if (++n === 1) await cancelRerouteRun(created.id, { userId });
        return provider.route(req);
      },
    };
    const r = await executeRerouteRun(created.id, undefined, deps(cancelling));
    expect(r.status).toBe("cancelled");
    expect(n).toBe(1);
    const left = await prisma.tripRouteLeg.count({ where: { routeId, source: "straight" } });
    expect(left).toBe(2);
  });

  it("a roadtrip run touches only that roadtrip's legs", async () => {
    await leg("straight");
    const other = await prisma.tripRoute.create({
      data: { userId, name: "Süd", mode: "road", kind: "roadtrip" },
    });
    const oa = await prisma.tripStop.create({
      data: { title: "x", lat: A.lat, lon: A.lon, routeId: other.id },
    });
    const ob = await prisma.tripStop.create({
      data: { title: "y", lat: B.lat, lon: B.lon, routeId: other.id },
    });
    const otherLeg = await prisma.tripRouteLeg.create({
      data: {
        routeId: other.id,
        fromStopId: oa.id,
        toStopId: ob.id,
        distanceKm: 5,
        source: "straight",
        mode: "road",
      },
    });
    const { provider } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("all", "roadtrip")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "done", processed: 1 });
    expect((await legOf(otherLeg.id)).source).toBe("straight");
    await prisma.tripRoute.delete({ where: { id: other.id } });
  });

  it("skips rail and ferry legs: a road router would draw a silent detour", async () => {
    await leg("straight", { mode: "ferry" });
    await leg("straight", { mode: "rail" });
    const { provider, calls } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("straight")).id, undefined, deps(provider));
    expect(r.total).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("routes coach rides after the legs, and never replaces a drawn (manual) ride line", async () => {
    const mk = (geometrySource: string) =>
      prisma.busJourney.create({
        data: {
          userId,
          depStationName: "A",
          arrStationName: "B",
          depLat: A.lat,
          depLon: A.lon,
          arrLat: B.lat,
          arrLon: B.lon,
          departureTime: new Date("2026-10-12T00:00:00Z"),
          depTimezone: "Europe/Berlin",
          arrTimezone: "Europe/Berlin",
          distanceKm: 100,
          distanceSource: "great_circle",
          geometrySource,
        },
      });
    const straight = await mk("straight");
    const manual = await mk("manual");
    const { provider } = fakeProvider(okLine);
    const r = await executeRerouteRun((await run("all")).id, undefined, deps(provider));
    expect(r).toMatchObject({ status: "done", processed: 1, routed: 1 });
    expect(
      (await prisma.busJourney.findUniqueOrThrow({ where: { id: straight.id } })).geometrySource
    ).toBe("road");
    expect(
      (await prisma.busJourney.findUniqueOrThrow({ where: { id: manual.id } })).geometrySource
    ).toBe("manual");
  });

  it("nextQuotaWindow is five minutes past the next UTC midnight", () => {
    expect(nextQuotaWindow(new Date("2026-11-22T23:59:00Z")).toISOString()).toBe(
      "2026-11-23T00:05:00.000Z"
    );
  });
});
