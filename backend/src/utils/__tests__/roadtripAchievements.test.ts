import { prisma } from "../../db";
import {
  calculateRoadtripAchievementStats,
  checkRoadtripAchievement,
} from "../roadtripAchievements";

/**
 * The roadtrip badges' measures: a planned roadtrip counts for nothing, a
 * night at a linked stay is not a free night, and countries come from the
 * stations.
 */

const USER = "roadtripbadges";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("roadtrip achievements", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Camping", type: "campsite", isoCountryCode: "NO" },
    });
    const stay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: lodging.id, checkIn: d("2024-07-14"), checkOut: d("2024-07-16") },
    });

    const past = await prisma.tripRoute.create({
      data: { userId, name: "Norwegen", mode: "road", kind: "roadtrip" },
    });
    const stations = [
      { title: "Hamburg", lat: 53.55, lon: 9.99, startDate: d("2024-07-12"), overnight: false },
      {
        title: "Aalborg",
        lat: 57.05,
        lon: 9.92,
        startDate: d("2024-07-13"),
        endDate: d("2024-07-14"),
        overnight: true,
      },
      {
        title: "Oslo",
        lat: 59.91,
        lon: 10.75,
        startDate: d("2024-07-14"),
        overnight: true,
        lodgingStayId: stay.id,
      },
    ];
    for (const [i, s] of stations.entries()) {
      const stop = await prisma.tripStop.create({
        data: { ...s, routeId: past.id, routeOrderIdx: i },
      });
      if (i > 0) {
        const prev = await prisma.tripStop.findFirstOrThrow({
          where: { routeId: past.id, routeOrderIdx: i - 1 },
        });
        await prisma.tripRouteLeg.create({
          data: {
            routeId: past.id,
            fromStopId: prev.id,
            toStopId: stop.id,
            distanceKm: 1600,
            source: "straight",
            mode: "road",
          },
        });
      }
    }

    const planned = await prisma.tripRoute.create({
      data: { userId, name: "Nächstes Jahr", mode: "road", kind: "roadtrip" },
    });
    await prisma.tripStop.create({
      data: {
        title: "Salzburg",
        lat: 47.8,
        lon: 13.04,
        startDate: d("2099-06-01"),
        routeId: planned.id,
        routeOrderIdx: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("measures started roadtrips only, and counts only the free nights as free", async () => {
    const stats = await calculateRoadtripAchievementStats(userId, new Date("2026-09-24T12:00:00Z"));
    expect(stats).toEqual({
      roadtripsCount: 1,
      roadtripKm: 3200,
      roadtripFreeNights: 1,
      roadtripLongestKm: 3200,
      roadtripCountriesMax: 3,
    });
  });

  it("checks a roadtrip badge and leaves every other badge to the flight checker", () => {
    const stats = {
      roadtripsCount: 1,
      roadtripKm: 3200,
      roadtripFreeNights: 1,
      roadtripLongestKm: 3200,
      roadtripCountriesMax: 3,
    };
    expect(
      checkRoadtripAchievement({ requirementType: "roadtrip_longest_km", requirement: 3000 }, stats)
    ).toEqual({ isUnlocked: true, progress: 3200 });
    expect(
      checkRoadtripAchievement({ requirementType: "roadtrip_free_nights", requirement: 10 }, stats)
    ).toEqual({ isUnlocked: false, progress: 1 });
    expect(
      checkRoadtripAchievement({ requirementType: "flights_count", requirement: 1 }, stats)
    ).toBeNull();
  });
});
