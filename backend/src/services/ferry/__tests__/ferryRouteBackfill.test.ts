import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { computeSchematicRoute } from "../../schematicRouter";
import { runFerryRouteBackfill } from "../../../jobs/ferryRouteBackfillScheduler";
import { MAX_ATTEMPTS, nextAttemptAfterFailure } from "../ferryRouteBackfill";

jest.mock("../../schematicRouter", () => ({
  ...jest.requireActual("../../schematicRouter"),
  computeSchematicRoute: jest.fn(),
}));

/** The owner's ruling of 2026-10-21: stored chords are routed once, in the background. */
const dep = { lat: 41.13656, lon: 16.8672687 };
const arr = { lat: 42.6637124, lon: 18.0813509 };
const line: Array<[number, number]> = [
  [dep.lon, dep.lat],
  [16.8291, 41.1676],
  [18.0047, 42.6272],
  [arr.lon, arr.lat],
];
const routed = () => ({
  waypoints: line,
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: true,
  method: "maritime_graph" as const,
});
const noSeaRoute = () => ({
  waypoints: [line[0], line[line.length - 1]],
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: false,
  method: "direct" as const,
});

let userId: string;
const run = (extra: { maxPerRun?: number; batch?: number; now?: () => Date } = {}) =>
  runFerryRouteBackfill({ batchPauseMs: 0, userId, ...extra });

async function crossing(data: Partial<Prisma.FerryJourneyUncheckedCreateInput> = {}) {
  return prisma.ferryJourney.create({
    data: {
      userId,
      depStationName: "Test harbour west",
      depLat: dep.lat,
      depLon: dep.lon,
      arrStationName: "Test harbour east",
      arrLat: arr.lat,
      arrLon: arr.lon,
      departureTime: new Date("2024-06-01T08:00:00Z"),
      distanceKm: 197.3,
      ...data,
    },
  });
}

/** A crossing linked to a roadtrip leg, as `PUT /ferry/:id/roadtrip-leg` leaves it. */
async function linked(legSource = "straight", stopOffset = 0) {
  const trip = await prisma.trip.create({ data: { userId, name: "Synthetic coast trip" } });
  const route = await prisma.tripRoute.create({
    data: { userId, tripId: trip.id, name: "Synthetic coast", kind: "roadtrip", mode: "road" },
  });
  const stop = (title: string, at: { lat: number; lon: number }, orderIdx: number) =>
    prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title, lat: at.lat, lon: at.lon, orderIdx },
    });
  const a = await stop("West", { lat: dep.lat + stopOffset, lon: dep.lon }, 0);
  const b = await stop("East", arr, 1);
  const drawnLine = [
    [dep.lon, dep.lat],
    [17.5, 42],
    [arr.lon, arr.lat],
  ];
  const leg = await prisma.tripRouteLeg.create({
    data: {
      routeId: route.id,
      fromStopId: a.id,
      toStopId: b.id,
      mode: "ferry",
      source: legSource,
      distanceKm: 197.3,
      ...(legSource === "drawn" && { waypoints: drawnLine }),
    },
  });
  const ferry = await crossing({ tripId: trip.id, roadtripLegId: leg.id });
  return { ferry, leg };
}

const stored = (id: string) => prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
const marker = (id: string) =>
  prisma.ferryRouteBackfill.findUnique({ where: { ferryJourneyId: id } });

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: "ferry-backfill-owner", passwordHash: "unused-test-hash" },
  });
  userId = user.id;
});
beforeEach(() => {
  jest.mocked(computeSchematicRoute).mockReset().mockResolvedValue(routed());
});
afterEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("ferry sea-route backfill", () => {
  it("routes a crossing stored as a straight line over the sea", async () => {
    const ferry = await crossing();
    const report = await run();
    expect(report).toMatchObject({ routed: 1, failed: 0, examined: 1 });
    expect(await stored(ferry.id)).toMatchObject({
      geometrySource: "sea_route",
      geometry: line,
      distanceSource: "sea_route",
    });
    expect(await marker(ferry.id)).toMatchObject({ outcome: "routed", nextAttemptAt: null });
  });

  it("keeps a distance the user typed while storing the line", async () => {
    const ferry = await crossing({ distanceKm: 250, distanceSource: "user" });
    await run();
    expect(await stored(ferry.id)).toMatchObject({
      geometrySource: "sea_route",
      distanceKm: 250,
      distanceSource: "user",
    });
  });

  it("never touches a stored line, whatever its source", async () => {
    const sea = await crossing({ geometrySource: "sea_route", geometry: line });
    // A "straight" row that nevertheless carries a line came from elsewhere
    // (a copy, an import); it is not a chord this job may replace.
    const carried = await crossing({ geometry: [line[0], line[2], line[3]] });
    const report = await run();
    expect(report.examined).toBe(0);
    expect(computeSchematicRoute).not.toHaveBeenCalled();
    expect((await stored(sea.id)).updatedAt).toEqual(sea.updatedAt);
    expect(await stored(carried.id)).toMatchObject({
      geometrySource: "straight",
      geometry: [line[0], line[2], line[3]],
      updatedAt: carried.updatedAt,
    });
  });

  it("keeps the straight line when the router fails, and records why", async () => {
    const ferry = await crossing();
    jest.mocked(computeSchematicRoute).mockRejectedValue(new Error("sea graph unavailable"));
    const now = new Date("2026-10-21T12:00:00Z");
    const report = await run({ now: () => now });
    expect(report).toMatchObject({ routed: 0, failed: 1, examined: 1 });
    expect(await stored(ferry.id)).toMatchObject({
      geometrySource: "straight",
      geometry: null,
      distanceKm: 197.3,
      updatedAt: ferry.updatedAt,
    });
    expect(await marker(ferry.id)).toMatchObject({
      outcome: "failed",
      attempts: 1,
      reason: "sea graph unavailable",
      nextAttemptAt: new Date("2026-10-22T12:00:00Z"),
    });
  });

  it("records 'no sea route' as final and keeps the chord", async () => {
    const ferry = await crossing();
    jest.mocked(computeSchematicRoute).mockResolvedValue(noSeaRoute());
    expect(await run()).toMatchObject({ straight: 1, examined: 1 });
    expect(await stored(ferry.id)).toMatchObject({ geometrySource: "straight", geometry: null });
    expect(await marker(ferry.id)).toMatchObject({ outcome: "straight", nextAttemptAt: null });
  });

  it("does nothing on a second run", async () => {
    for (let i = 0; i < 3; i++) await crossing({ depStationName: `Harbour ${i}` });
    // One of each outcome; which crossing gets which does not matter here.
    jest
      .mocked(computeSchematicRoute)
      .mockReset()
      .mockResolvedValueOnce(routed())
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(noSeaRoute());
    expect(await run()).toMatchObject({ routed: 1, failed: 1, straight: 1, examined: 3 });
    jest.mocked(computeSchematicRoute).mockClear();
    expect(await run()).toMatchObject({ examined: 0 });
    expect(computeSchematicRoute).not.toHaveBeenCalled();
  });

  it("retries a failed crossing only when its back-off has passed, and stops after the last try", async () => {
    const ferry = await crossing();
    jest.mocked(computeSchematicRoute).mockRejectedValue(new Error("timeout"));
    let now = new Date("2026-10-21T00:00:00Z");
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect((await run({ now: () => now })).examined).toBe(1);
      const record = await marker(ferry.id);
      expect(record?.attempts).toBe(attempt);
      expect(await run({ now: () => now })).toMatchObject({ examined: 0 });
      if (record?.nextAttemptAt) now = record.nextAttemptAt;
    }
    expect((await marker(ferry.id))?.nextAttemptAt).toBeNull();
    expect(await run({ now: () => new Date("2030-01-01T00:00:00Z") })).toMatchObject({
      examined: 0,
    });
    expect(nextAttemptAfterFailure(1, now)).toEqual(new Date(now.getTime() + 86_400_000));
    expect(nextAttemptAfterFailure(MAX_ATTEMPTS, now)).toBeNull();
  });

  it("stops at the per-run cap and continues on the next run", async () => {
    for (let i = 0; i < 5; i++) await crossing({ depStationName: `Harbour ${i}` });
    expect(await run({ maxPerRun: 3, batch: 2 })).toMatchObject({ routed: 3, examined: 3 });
    expect(computeSchematicRoute).toHaveBeenCalledTimes(3);
    expect(await run({ maxPerRun: 3, batch: 2 })).toMatchObject({ routed: 2, examined: 2 });
  });

  it("carries the sea line onto a linked roadtrip leg whose stops are the piers", async () => {
    const { ferry, leg } = await linked();
    expect(await run()).toMatchObject({ routed: 1 });
    expect(await stored(ferry.id)).toMatchObject({ geometrySource: "sea_route" });
    expect(await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } })).toMatchObject({
      source: "routed",
      waypoints: line,
    });
  });

  it("routes a crossing linked off its piers and keeps that leg as linked", async () => {
    const { ferry, leg } = await linked("straight", 0.1);
    expect(await run()).toMatchObject({ routed: 1, failed: 0 });
    expect(await stored(ferry.id)).toMatchObject({ geometrySource: "sea_route" });
    expect(await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } })).toMatchObject({
      source: "straight",
      waypoints: null,
      distanceKm: 197.3,
      updatedAt: leg.updatedAt,
    });
  });

  it("never replaces a line drawn on the linked leg", async () => {
    const { leg } = await linked("drawn");
    expect(await run()).toMatchObject({ routed: 1 });
    expect(await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } })).toMatchObject({
      source: "drawn",
      waypoints: leg.waypoints,
      updatedAt: leg.updatedAt,
    });
  });
});
