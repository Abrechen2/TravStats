import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { findMicroTripCandidates } from "../tripCleanupService";

/**
 * `findMicroTripCandidates` decides a trip "carries no user content" by
 * counting flights, cruises, stops, journal entries and photos — but not
 * `routes`. A trip whose only user content is a named route section was
 * therefore offered for dissolution, and deleting it cascades the section
 * away. The sibling merge path (`tripCleanup.routes.test.ts`) was fixed
 * earlier for the same gap; this pins the dissolution side.
 */
describe("findMicroTripCandidates excludes trips with a route section", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "microrouteguard" } });
    const u = await prisma.user.create({
      data: { username: "microrouteguard", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "microrouteguard" } });
    await prisma.$disconnect();
  });

  it("does not propose a trip whose only content is a TripRoute", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Wohnmobiltour" } });
    await prisma.tripRoute.create({
      data: { tripId: trip.id, name: "Südnorwegen", mode: "road" },
    });

    const candidates = await findMicroTripCandidates(userId);
    expect(candidates.map((c) => c.id)).not.toContain(trip.id);
  });

  it("still proposes a genuinely empty trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Leer" } });

    const candidates = await findMicroTripCandidates(userId);
    expect(candidates.map((c) => c.id)).toContain(trip.id);
  });
});
