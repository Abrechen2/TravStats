import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { ensureUserSettings } from "../seedDemoAccount";
import { seedRealisticDemo, type RealisticCounts } from "../seedDemo/realistic";
import { SPECIAL_FLIGHT_TYPES } from "../schemas/flight";
import { classifyLodging, classifyStay } from "../shared/lodgingCounting";
import { computeTripSuggestions } from "../services/tripSuggestions/engine";
import { isTracedShape } from "../services/rail/railGeometryMath";
import { greatCircleKm } from "../services/rail/railJourneyWrite";

/**
 * The realistic demo account (owner request 2026-09-26), checked against what
 * the owner asked for and against the invariants the app holds everywhere
 * else. It replaced a coverage seed whose tests (stories, bulk, tours) pinned
 * the findings of the 2026-09-17 review — B3 (a booked stay is not a
 * bookmark), B4 (priced stays carry an FX snapshot), B5 (stop times inside the
 * cruise) — and those findings are asserted here against the new content, so
 * retiring the old seed retired none of them.
 */
describe("the realistic demo account", () => {
  let userId: string;
  let counts: RealisticCounts;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "realisticDemoUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "realisticDemoUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
    await ensureUserSettings(userId);
    // The seed runs on first boot, possibly offline: any request it made
    // would fail here, and so would the seed.
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("the demo seed must not use the network"));
    counts = await seedRealisticDemo(userId, new Date());
  }, 180_000);

  afterAll(async () => {
    fetchSpy.mockRestore();
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("never touched the network", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flies like an enthusiast from Köln/Bonn and Düsseldorf, not like a bot", async () => {
    const flights = await prisma.flight.findMany({ where: { userId } });
    expect(flights.length).toBeGreaterThanOrEqual(130);
    expect(flights.length).toBeLessThanOrEqual(160);
    const home = flights.filter(
      (f) => ["CGN", "DUS"].includes(f.depIata ?? "") || ["CGN", "DUS"].includes(f.arrIata ?? "")
    );
    // 90 % start or end at home; the rest are onward legs and the sightseeing loop.
    expect(home.length / flights.length).toBeGreaterThanOrEqual(0.9);
    // Only CGN and DUS are home: a trip that sets off by plane sets off from
    // one of them (a trip that sets off by train may fly from its hub).
    const firstLegs = await prisma.trip.findMany({
      where: { userId, railJourneys: { none: {} } },
      include: { flights: { orderBy: { departureTime: "asc" }, take: 1 } },
    });
    for (const trip of firstLegs) {
      const first = trip.flights[0];
      if (first && !["CGN", "DUS"].includes(first.depIata ?? "")) {
        throw new Error(`${trip.name} starts with a flight from ${first.depIata}`);
      }
    }
  });

  it("travels to more than 30 countries on four continents", async () => {
    const trips = await prisma.trip.findMany({ where: { userId }, select: { countries: true } });
    const countries = new Set(trips.flatMap((t) => t.countries));
    expect(countries.size).toBeGreaterThanOrEqual(30);
    for (const iso of ["DE", "US", "JP", "ZA"]) expect(countries.has(iso)).toBe(true);
  });

  it("keeps a delay null where none was noted, and never invents one for a flight not flown", async () => {
    const flights = await prisma.flight.findMany({ where: { userId } });
    expect(flights.some((f) => f.status === "flown" && f.delayMinutes === null)).toBe(true);
    for (const f of flights.filter((x) => x.status !== "flown")) expect(f.delayMinutes).toBeNull();
    const cancelled = flights.filter((f) => f.status === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].seatNumber).toBeNull();
    expect(flights.some((f) => f.seatClass === "business")).toBe(true);
    expect(flights.some((f) => (f.notes ?? "").includes("umgeleitet"))).toBe(true);
  });

  it("has special flights of the app's own types", async () => {
    const special = await prisma.flight.findMany({ where: { userId, specialType: { not: null } } });
    expect(special.length).toBeGreaterThanOrEqual(2);
    for (const f of special) {
      expect(SPECIAL_FLIGHT_TYPES).toContain(f.specialType);
      expect(f.eventLat).not.toBeNull();
    }
  });

  it("draws every roadtrip and tour leg along a road, a path or a crossing — never a straight line", async () => {
    const routes = await prisma.tripRoute.findMany({
      where: { userId },
      include: { legs: true, tracks: true },
    });
    expect(
      routes
        .filter((r) => r.kind === "roadtrip")
        .map((r) => r.vehicle)
        .sort()
    ).toEqual(["car", "car", "motorcycle", "motorhome"]);
    for (const route of routes) {
      for (const leg of route.legs) {
        expect(leg.source).not.toBe("straight");
        expect((leg.waypoints as unknown[]).length).toBeGreaterThan(route.kind === "tour" ? 20 : 2);
      }
      if (route.kind === "tour") {
        expect(route.legs.every((l) => l.source === "track")).toBe(true);
        expect(route.tracks.length).toBeGreaterThan(0);
      }
    }
    expect(routes.flatMap((r) => r.legs).some((l) => l.mode === "ferry")).toBe(true);
  });

  // Board item realistic-demo-account (a): the 44 rides were stored as chords.
  it("draws every train ride over the tracks, labelled as routed, and measures along it", async () => {
    const rides = await prisma.railJourney.findMany({ where: { userId } });
    expect(rides).toHaveLength(counts.rail);
    expect(rides.length).toBeGreaterThanOrEqual(44);
    for (const ride of rides) {
      expect(ride.geometrySource).toBe("brouter");
      expect(ride.distanceSource).toBe("route");
      const line = ride.geometry as Array<[number, number]>;
      expect(line.length).toBeGreaterThan(20);
      // From the departure station to the arrival station, not the reverse.
      expect(line[0]).toEqual([ride.depLon, ride.depLat]);
      expect(line[line.length - 1]).toEqual([ride.arrLon, ride.arrLat]);
      expect(isTracedShape(line)).toBe(true);
      // Along the tracks: longer than the chord, never absurdly so. The Albula
      // line St. Moritz – Chur is the longest ratio by nature (90 km of track
      // for a 46 km chord, loops and spiral tunnels); a detour to the wrong
      // bank of the Rhine measured 1.75 and a wrong Shinkansen snap 2.4.
      const chord = greatCircleKm(ride);
      expect(ride.distanceKm!).toBeGreaterThan(chord);
      expect(ride.distanceKm!).toBeLessThan(
        chord * (ride.arrStationName === "Chur" || ride.depStationName === "Chur" ? 2 : 1.7)
      );
    }
  });

  it("stores recordings with elevation, a moving time shorter than the day, and a measured distance", async () => {
    const tracks = await prisma.tripRouteTrack.findMany({ where: { route: { userId } } });
    expect(tracks).toHaveLength(counts.tracks);
    for (const t of tracks) {
      const span = (t.endedAt.getTime() - t.startedAt.getTime()) / 1000;
      expect(t.ascentM).toBeGreaterThan(0);
      expect(t.movingSeconds).not.toBeNull();
      // Pauses are in the recording: moving time is less than the whole day.
      expect(t.movingSeconds!).toBeLessThan(span);
      expect(t.distanceKm).toBeGreaterThan(5);
      expect(t.pointCount).toBeGreaterThan(300);
    }
  });

  it("keeps every cruise stop in the three-state invariant, numbered by day, inside its cruise", async () => {
    const cruises = await prisma.cruise.findMany({
      where: { userId },
      include: { stops: { orderBy: { dayNumber: "asc" } }, legs: true },
    });
    expect(cruises).toHaveLength(4);
    expect(cruises.filter((c) => c.status === "scheduled")).toHaveLength(1);
    for (const cruise of cruises) {
      expect(cruise.legs.length).toBeGreaterThan(0);
      cruise.stops.forEach((stop, i) => {
        expect(stop.dayNumber).toBe(i + 1);
        const matched = stop.portId !== null && !stop.isAtSea && stop.unresolvedPortName === null;
        const seaDay = stop.portId === null && stop.isAtSea && stop.unresolvedPortName === null;
        expect(matched || seaDay).toBe(true);
        for (const time of [stop.arrivalTime, stop.departureTime]) {
          if (time === null) continue;
          expect(time.getTime()).toBeGreaterThanOrEqual(cruise.startDate!.getTime());
          expect(time.getTime()).toBeLessThanOrEqual(cruise.endDate!.getTime());
        }
      });
    }
  });

  it("counts a booked stay on a planned trip as planned, not as a bookmark (finding B3)", async () => {
    const stays = await prisma.lodgingStay.findMany({
      where: { userId, trip: { status: "planned" } },
      include: { lodging: true },
    });
    expect(stays.length).toBeGreaterThan(0);
    for (const stay of stays) {
      expect(classifyStay(stay)).toBe("planned");
      expect(classifyLodging(stay.lodging, [classifyStay(stay)])).toBe("planned");
    }
  });

  it("snapshots priced stays into the base currency, and leaves the rand honestly unconverted (B4)", async () => {
    const priced = await prisma.lodgingStay.findMany({
      where: { userId, totalPrice: { not: null } },
    });
    const rand = priced.filter((s) => s.currency === "ZAR");
    expect(rand.length).toBeGreaterThan(0);
    for (const stay of rand) expect(stay.totalPriceBase).toBeNull();
    for (const stay of priced.filter((s) => s.currency !== "ZAR")) {
      expect(stay.totalPriceBase).not.toBeNull();
      expect(stay.fxSource).toBe("manual");
    }
  });

  it("links companions both ways, and credits stays to the loyalty cards", async () => {
    const withCompanions = await prisma.flight.findMany({
      where: { userId, NOT: { companions: { isEmpty: true } } },
      include: { companionLinks: true },
    });
    expect(withCompanions.length).toBeGreaterThan(0);
    for (const f of withCompanions) expect(f.companionLinks).toHaveLength(f.companions.length);

    const cards = await prisma.loyaltyMembership.findMany({
      where: { userId },
      include: { stays: true },
    });
    expect(cards.map((c) => c.programName).sort()).toEqual([
      "ALL – Accor Live Limitless",
      "Marriott Bonvoy",
      "Miles & More",
    ]);
    for (const card of cards) expect(card.tier).not.toBeNull();
    expect(cards.find((c) => c.programName === "Marriott Bonvoy")!.stays.length).toBeGreaterThan(3);
  });

  it("has upcoming trips and one trip from the last weeks", async () => {
    const planned = await prisma.trip.findMany({ where: { userId, status: "planned" } });
    expect(planned).toHaveLength(3);
    const scheduled = await prisma.flight.count({ where: { userId, status: "scheduled" } });
    expect(scheduled).toBeGreaterThan(0);
  });

  it("leaves exactly two questions open in the inbox", async () => {
    const { suggestions } = await computeTripSuggestions(userId);
    expect(suggestions.map((s) => s.kind).sort()).toEqual(["new_trip", "place_visit"]);
    expect(counts.openSuggestions).toBe(2);
  });
});
