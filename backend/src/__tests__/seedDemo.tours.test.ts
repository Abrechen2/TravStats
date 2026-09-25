import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { STORIES } from "../seedDemo/stories";
import { seedTour } from "../seedDemo/seedTours";

describe("seedTour writes a tour the app can draw", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedTourUser" } });
    const user = await prisma.user.create({
      data: { username: "seedTourUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Tour test" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores ordered stops and one straight leg between each pair", async () => {
    const tour = STORIES.find((s) => s.tour)!.tour!;
    const routeId = await seedTour(userId, tripId, tour, 0);

    const stops = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(stops.map((s) => s.title)).toEqual(tour.stops.map((s) => s.name));
    const legs = await prisma.tripRouteLeg.findMany({ where: { routeId } });
    expect(legs).toHaveLength(stops.length - 1);
    for (const leg of legs) {
      expect(leg.distanceKm).toBeGreaterThan(0);
      expect(leg.source).toBe("straight");
    }
  });

  it("gives every story a consistent date range", () => {
    // Jest's `expect` (v29.7.0 here) takes exactly one argument — a Chai-style
    // message as a second arg throws "Expect takes at most one argument."
    // rather than annotating a failure. Story/stay names are folded into the
    // failure via a throw instead of a second `expect` param.
    for (const story of STORIES) {
      if (Date.parse(story.start) > Date.parse(story.end)) {
        throw new Error(`${story.name}: start is after end`);
      }
      for (const stay of story.stays) {
        if (Date.parse(stay.checkIn) < Date.parse(story.start)) {
          throw new Error(`${stay.name}: checkIn is before the trip's start`);
        }
        if (Date.parse(stay.checkOut) > Date.parse(story.end)) {
          throw new Error(`${stay.name}: checkOut is after the trip's end`);
        }
      }
    }
  });
});
