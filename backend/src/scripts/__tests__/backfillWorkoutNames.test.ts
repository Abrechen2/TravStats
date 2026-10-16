import { prisma } from "../../db";
import { backfillWorkoutNames } from "../backfillWorkoutNames";

/**
 * The repair for workouts named before the upload re-read their clock: on
 * prod "Wanderung am 28.05.2026, 14:10" (Seoul's clock) for an 08:10 start
 * in Madagascar. Dry run by default; a tour the user renamed keeps its name.
 */
describe("backfillWorkoutNames", () => {
  let userId: string;
  const MADAGASCAR_LINE = [
    [44.77054, -19.02348],
    [44.771, -19.024],
  ];

  async function workout(tourName: string, trackName: string, source = "healthkit") {
    const route = await prisma.tripRoute.create({
      data: { userId, name: tourName, kind: "tour", mode: "foot" },
    });
    const track = await prisma.tripRouteTrack.create({
      data: {
        routeId: route.id,
        source,
        name: trackName,
        startedAt: new Date("2026-05-28T05:10:58.997Z"),
        endedAt: new Date("2026-05-28T06:10:00Z"),
        geometry: MADAGASCAR_LINE,
        segmentStarts: [0],
        cumulativeKm: [0, 0.1],
        pointCount: 2,
        distanceKm: 0.1,
      },
    });
    return { route, track };
  }

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `workout-names-${Date.now()}`, passwordHash: "synthetic-test-hash" },
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("reports without writing, then renames track and tour on --apply, then has nothing left", async () => {
    const { route, track } = await workout(
      "Wanderung am 28.05.2026, 14:10",
      "Wanderung am 28.05.2026, 14:10"
    );

    const dry = await backfillWorkoutNames({ apply: false, userId });
    expect(dry).toEqual([
      {
        trackId: track.id,
        routeId: route.id,
        from: "Wanderung am 28.05.2026, 14:10",
        to: "Wanderung am 28.05.2026, 08:10",
        renamesTour: true,
      },
    ]);
    expect((await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: track.id } })).name).toBe(
      "Wanderung am 28.05.2026, 14:10"
    );

    await backfillWorkoutNames({ apply: true, userId });
    expect((await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: track.id } })).name).toBe(
      "Wanderung am 28.05.2026, 08:10"
    );
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: route.id } })).name).toBe(
      "Wanderung am 28.05.2026, 08:10"
    );
    expect(await backfillWorkoutNames({ apply: false, userId })).toEqual([]);
  });

  it("keeps a tour name the user chose, and leaves non-workout tracks alone", async () => {
    const own = await workout("Isalo mit Mia", "Wanderung am 28.05.2026, 14:10");
    const gpx = await workout("GPX", "Wanderung am 28.05.2026, 14:10", "gpx");

    await backfillWorkoutNames({ apply: true, userId });
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: own.route.id } })).name).toBe(
      "Isalo mit Mia"
    );
    expect(
      (await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: own.track.id } })).name
    ).toBe("Wanderung am 28.05.2026, 08:10");
    expect(
      (await prisma.tripRouteTrack.findUniqueOrThrow({ where: { id: gpx.track.id } })).name
    ).toBe("Wanderung am 28.05.2026, 14:10");
  });
});
