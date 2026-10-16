import { prisma } from "../../../db";
import { routeStraightRide } from "../busRouteAgain";
import type { BusLine } from "../busRouting";

describe("routeStraightRide", () => {
  let userId: string;
  const ends = { depLat: 37.5048, depLon: 127.0046, arrLat: 38.1911, arrLon: 128.5918 };
  const road: BusLine = {
    geometry: [
      [ends.depLon, ends.depLat],
      [ends.arrLon, ends.arrLat],
    ],
    geometrySource: "road",
    routedKm: 180,
    fallback: null,
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "busrouteagain" } });
    userId = (
      await prisma.user.create({ data: { username: "busrouteagain", passwordHash: "unused" } })
    ).id;
  });
  afterEach(async () => {
    await prisma.busJourney.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const createRide = () =>
    prisma.busJourney.create({
      data: {
        userId,
        depStationName: "Seoul",
        arrStationName: "Sokcho",
        ...ends,
        departureTime: new Date("2026-10-12T00:00:00Z"),
        depTimezone: "Asia/Seoul",
        arrTimezone: "Asia/Seoul",
        distanceKm: 150,
        distanceSource: "great_circle",
        geometrySource: "straight",
      },
    });

  it("routes a straight ride and takes the road distance", async () => {
    const ride = await createRide();
    const report = await routeStraightRide(userId, ride.id, async () => road);
    expect(report?.outcome).toBe("routed");
    const after = await prisma.busJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after).toMatchObject({
      geometrySource: "road",
      distanceKm: 180,
      distanceSource: "route",
    });
  });

  it("never overwrites a distance the user typed while the route was being fetched", async () => {
    // The guarded update checked the terminals but not the distance source, so
    // a ticket distance typed during the provider call was replaced by the
    // road distance the stale read thought it was allowed to write.
    const ride = await createRide();
    const report = await routeStraightRide(userId, ride.id, async () => {
      await prisma.busJourney.update({
        where: { id: ride.id },
        data: { distanceKm: 211, distanceSource: "user" },
      });
      return road;
    });
    expect(report?.outcome).toBe("unchanged");
    const after = await prisma.busJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after).toMatchObject({ distanceKm: 211, distanceSource: "user" });
  });
});
