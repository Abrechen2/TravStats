import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { loadPools } from "../seedDemoAccount";
import { STORIES } from "../seedDemo/stories";
import { seedStories } from "../seedDemo/seedStories";

describe("seedStories", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedStoriesUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedStoriesUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
    const { airports } = await loadPools();
    await seedStories(userId, airports);
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("writes every narrated trip with all of its parts linked", async () => {
    for (const story of STORIES) {
      const trip = await prisma.trip.findFirst({
        where: { userId, name: story.name },
        include: { flights: true, lodgingStays: true, placeVisits: true, routes: true, journalEntries: true, cruises: true },
      });
      if (!trip) throw new Error(`${story.name}: trip not found`);
      expect(trip.flights).toHaveLength(story.flights.length);
      expect(trip.lodgingStays).toHaveLength(story.stays.length);
      expect(trip.placeVisits.length).toBe(story.places.filter((p) => p.visitedAt).length);
      expect(trip.routes).toHaveLength(story.tour ? 1 : 0);
      expect(trip.journalEntries).toHaveLength(story.journal.length);
      expect(trip.cruises).toHaveLength(story.cruise ? 1 : 0);
    }
  });

  it("keeps a cruise's stops in the 3-state invariant, numbered from 1", async () => {
    const cruises = await prisma.cruise.findMany({ where: { userId }, include: { stops: { orderBy: { dayNumber: "asc" } } } });
    for (const cruise of cruises) {
      cruise.stops.forEach((stop, i) => {
        expect(stop.dayNumber).toBe(i + 1);
        expect(stop.isAtSea ? stop.portId === null : stop.portId !== null).toBe(true);
      });
    }
  });

  it("marks planned stories' flights and stays as not yet taken", async () => {
    const planned = STORIES.filter((s) => s.status === "planned").map((s) => s.name);
    const trips = await prisma.trip.findMany({ where: { userId, name: { in: planned } }, include: { flights: true, lodgingStays: true } });
    for (const trip of trips) {
      for (const f of trip.flights) expect(f.status).toBe("scheduled");
      for (const s of trip.lodgingStays) expect(s.status).toBe("scheduled");
    }
  });
});
