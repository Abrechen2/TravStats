import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { loadPools } from "../seedDemoAccount";
import { STORIES } from "../seedDemo/stories";
import { seedStories } from "../seedDemo/seedStories";
import { classifyLodging, classifyStay } from "../shared/lodgingCounting";

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

  /**
   * Finding B5 of the independent review of 2026-09-17: the stop times were
   * the EMBARKATION instant plus n days, so the last stop of the Mittelmeer
   * cruise (embarking 16:00, disembarking 08:00) arrived eight hours after the
   * passengers had left the ship.
   */
  it("keeps every stop's arrival and departure inside its own cruise", async () => {
    const cruises = await prisma.cruise.findMany({ where: { userId }, include: { stops: true } });
    expect(cruises.length).toBeGreaterThan(0);
    for (const cruise of cruises) {
      for (const stop of cruise.stops) {
        for (const [label, time] of [
          ["arrival", stop.arrivalTime],
          ["departure", stop.departureTime],
        ] as const) {
          if (time === null) continue;
          if (time < cruise.startDate || time > cruise.endDate) {
            throw new Error(
              `stop ${stop.dayNumber}'s ${label} ${time.toISOString()} is outside ` +
                `${cruise.startDate.toISOString()}..${cruise.endDate.toISOString()}`,
            );
          }
        }
      }
    }
  });

  it("dual-writes FlightCompanion and CruiseCompanion join rows alongside the denormalized arrays", async () => {
    for (const story of STORIES) {
      if (story.companions.length === 0) continue;
      const trip = await prisma.trip.findFirst({
        where: { userId, name: story.name },
        include: { flights: { include: { companionLinks: true } }, cruises: { include: { companionLinks: true } } },
      });
      if (!trip) throw new Error(`${story.name}: trip not found`);
      for (const flight of trip.flights) expect(flight.companionLinks).toHaveLength(story.companions.length);
      for (const cruise of trip.cruises) expect(cruise.companionLinks).toHaveLength(story.companions.length);
    }
  });

  /**
   * Finding B3 of the independent review of 2026-09-17: the seed wrote
   * `visited: !planned` on the LODGING, so the two booked Portugal hotels were
   * classified as bookmarks — `classifyLodging` returns "excluded" for
   * `visited === false`, whatever the stays say — and the trip that exists to
   * show what is coming up counted nowhere.
   *
   * A booked stay is `visited: true`; whether it has happened is the dates'
   * answer, not the flag's (see shared/lodgingCounting.ts).
   */
  it("counts a booked stay on a planned trip as planned, not as a bookmark", async () => {
    const planned = STORIES.filter((s) => s.status === "planned" && s.stays.length > 0);
    expect(planned.length).toBeGreaterThan(0);
    for (const story of planned) {
      const stays = await prisma.lodgingStay.findMany({
        where: { userId, trip: { name: story.name } },
        include: { lodging: true },
      });
      expect(stays).toHaveLength(story.stays.length);
      for (const stay of stays) {
        const stayState = classifyStay(stay);
        expect(stayState).toBe("planned");
        expect(classifyLodging(stay.lodging, [stayState])).toBe("planned");
      }
    }
  });

  /** The narrated side of finding B4 — see seedDemo.bulk.test.ts. */
  it("snapshots every narrated stay into the base currency", async () => {
    const stays = await prisma.lodgingStay.findMany({ where: { userId, totalPrice: { not: null } } });
    expect(stays.length).toBeGreaterThan(0);
    for (const stay of stays) {
      expect(stay.totalPriceBase).not.toBeNull();
      expect(stay.fxBaseCurrency).toBe("EUR");
      expect(stay.fxRate).not.toBeNull();
      expect(stay.fxSource).toBe("manual");
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
