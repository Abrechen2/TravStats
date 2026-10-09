import { prisma } from "../../db";
import { calculateRoadtripAchievementStats } from "../roadtripAchievements";

/**
 * forgejo#260 (the extension to #179): once a roadtrip has STARTED, only what
 * has happened reaches its badges — next week's ferry does not. And the three
 * Part K badges: base camp, land and water, tours from three stations.
 */
const USER = "roadtripbadgesinprogress";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const NOW = new Date("2026-07-15T12:00:00Z");

describe("roadtrip badges while the roadtrip is under way", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    const trip = await prisma.tripRoute.create({
      data: { userId, name: "Skandinavien", mode: "road", kind: "roadtrip" },
    });
    // Hamburg (10th) → Hirtshals (11th) → ferry to Kristiansand (12th–15th,
    // free pitch) → Bergen (20th, still ahead on the 15th).
    const stations = [
      { title: "Hamburg", lat: 53.55, lon: 9.99, startDate: d("2026-07-10") },
      {
        title: "Hirtshals",
        lat: 57.59,
        lon: 9.96,
        startDate: d("2026-07-11"),
        endDate: d("2026-07-12"),
        overnight: true,
      },
      {
        title: "Kristiansand",
        lat: 58.15,
        lon: 7.99,
        startDate: d("2026-07-12"),
        endDate: d("2026-07-15"),
        overnight: true,
      },
      {
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        startDate: d("2026-07-20"),
        endDate: d("2026-07-21"),
        overnight: true,
      },
    ];
    const ids: string[] = [];
    for (const [i, s] of stations.entries()) {
      ids.push(
        (await prisma.tripStop.create({ data: { ...s, routeId: trip.id, routeOrderIdx: i } })).id
      );
    }
    const legs = [
      { from: 0, to: 1, km: 400, mode: "road" },
      { from: 1, to: 2, km: 140, mode: "ferry" },
      { from: 2, to: 3, km: 450, mode: "road" },
    ];
    for (const l of legs) {
      await prisma.tripRouteLeg.create({
        data: {
          routeId: trip.id,
          fromStopId: ids[l.from],
          toStopId: ids[l.to],
          distanceKm: l.km,
          source: "routed",
          mode: l.mode,
        },
      });
    }
    // Two hikes from Kristiansand (the base camp), one planned from Bergen.
    for (const [name, date, anchor] of [
      ["Hike A", "2026-07-13", ids[2]],
      ["Hike B", "2026-07-14", ids[2]],
      ["Hike C", "2026-07-20", ids[3]],
    ] as const) {
      await prisma.tripRoute.create({
        data: {
          userId,
          name,
          mode: "foot",
          kind: "tour",
          activity: "hike",
          tourDate: d(date),
          anchorStopId: anchor,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  it("counts the driven and the ferried stretch, never the stretch still ahead", async () => {
    const stats = await calculateRoadtripAchievementStats(userId, NOW);
    expect(stats.roadtripsCount).toBe(1);
    // 400 road + 140 ferry; Bergen's 450 km is next week.
    expect(stats.roadtripKm).toBe(540);
    expect(stats.roadtripLandAndWater).toBe(1);
    // Hirtshals (1) + Kristiansand (3) — Bergen's night is ahead.
    expect(stats.roadtripFreeNights).toBe(4);
    // Base camp: three nights at Kristiansand and two hikes from it.
    expect(stats.roadtripBaseCamps).toBe(1);
    // Hikes from one station so far; Bergen's is planned.
    expect(stats.roadtripTourStations).toBe(1);
  });
});
