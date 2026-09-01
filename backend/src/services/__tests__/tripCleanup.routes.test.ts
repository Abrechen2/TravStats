import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { mergeTrips } from "../tripCleanupService";

describe("mergeTrips carries route sections", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mergeroutes" } });
    const u = await prisma.user.create({
      data: { username: "mergeroutes", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mergeroutes" } });
    await prisma.$disconnect();
  });

  it("moves a section to the target trip along with its stops", async () => {
    const target = await prisma.trip.create({ data: { userId, name: "Ziel" } });
    const source = await prisma.trip.create({ data: { userId, name: "Quelle" } });

    const route = await prisma.tripRoute.create({
      data: { tripId: source.id, name: "Südnorwegen", mode: "road" },
    });
    const stop = await prisma.tripStop.create({
      data: {
        tripId: source.id,
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        routeId: route.id,
        routeOrderIdx: 0,
      },
    });

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const movedRoute = await prisma.tripRoute.findUnique({ where: { id: route.id } });
    const movedStop = await prisma.tripStop.findUnique({ where: { id: stop.id } });

    // A section left behind on a deleted trip, or pointing at a trip whose
    // stops have gone elsewhere, is the failure this guards.
    expect(movedRoute?.tripId).toBe(target.id);
    expect(movedStop?.tripId).toBe(target.id);
    expect(movedStop?.routeId).toBe(route.id);
  });
});
