import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `trips.countries` is a stored column nobody derives, so 2.5.0 taught
 * GET /trips/:id to fall back to the countries of the trip's flights. The trip
 * LIST endpoint was left alone — and the list is what feeds the trip cards on
 * the Reisen overview, so every card read "?" for a trip whose detail page
 * showed five countries. Same defect, one surface fixed.
 *
 * These pin both surfaces on the same derivation.
 */
describe("trip countries are derived on the list, not only on the detail", () => {
  let authCookie: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripListCountries" } });
    const user = await prisma.user.create({
      data: {
        username: "tripListCountries",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    // Airports the derivation resolves through. Upserted so the test does not
    // depend on the catalogue seed having run.
    for (const a of [
      { iata: "XQA", name: "Test A", country: "Germany", timezone: "Europe/Berlin" },
      { iata: "XQB", name: "Test B", country: "Spain", timezone: "Europe/Madrid" },
      { iata: "XQC", name: "Test C", country: "Germany", timezone: "Europe/Berlin" },
    ]) {
      // The unique key is (iata, isClosed), not iata alone.
      await prisma.airport.upsert({
        where: { airports_iata_is_closed_key: { iata: a.iata, isClosed: false } },
        update: { country: a.country, timezone: a.timezone },
        create: {
          iata: a.iata,
          name: a.name,
          country: a.country,
          timezone: a.timezone,
          lat: 0,
          lon: 0,
          isClosed: false,
        },
      });
    }

    const trip = await prisma.trip.create({
      data: { userId, name: "Countries derivation", status: "completed" },
    });
    tripId = trip.id;

    await prisma.flight.createMany({
      data: [
        {
          userId,
          tripId,
          depIata: "XQA",
          arrIata: "XQB",
          departureTime: new Date("2026-03-01T08:00:00.000Z"),
          status: "flown",
          depLat: 0,
          depLon: 0,
          arrLat: 0,
          arrLon: 0,
        },
        {
          userId,
          tripId,
          depIata: "XQB",
          arrIata: "XQC",
          departureTime: new Date("2026-03-08T08:00:00.000Z"),
          status: "flown",
          depLat: 0,
          depLon: 0,
          arrLat: 0,
          arrLon: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.airport.deleteMany({ where: { iata: { in: ["XQA", "XQB", "XQC"] } } });
  });

  it("derives the countries of the trip's flights on the LIST endpoint", async () => {
    const res = await request(app)
      .get("/api/v1/trips")
      .set("Cookie", authCookie)
      .expect(200);

    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    expect(trip).toBeDefined();
    // Deduplicated (Germany appears at both ends), folded to ISO, sorted.
    expect(trip.countries).toEqual(["DE", "ES"]);
  });

  it("agrees with the detail endpoint — the bug was the two disagreeing", async () => {
    const [list, detail] = await Promise.all([
      request(app).get("/api/v1/trips").set("Cookie", authCookie).expect(200),
      request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", authCookie).expect(200),
    ]);
    const fromList = list.body.trips.find((t: { id: string }) => t.id === tripId).countries;
    expect(fromList).toEqual(detail.body.trip.countries);
  });

  it("prefers a stored country list over the derivation", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { countries: ["Japan"] },
    });
    try {
      const res = await request(app)
        .get("/api/v1/trips")
        .set("Cookie", authCookie)
        .expect(200);
      const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
      expect(trip.countries).toEqual(["Japan"]);
    } finally {
      await prisma.trip.update({ where: { id: tripId }, data: { countries: [] } });
    }
  });

  it("derives countries for a CRUISE-ONLY trip from the ports it called at", async () => {
    // A cruise-only trip carries no flights at all, so a flight-only
    // derivation left it reading "?" for a voyage that plainly visited
    // several countries — measured on the RC against production data.
    const ports = await Promise.all(
      [
        { name: "UAT Port IT", country: "Italy", unlocode: "ZZUA1" },
        { name: "UAT Port GR", country: "Greece", unlocode: "ZZUA2" },
        { name: "UAT Port HR", country: "Croatia", unlocode: "ZZUA3" },
      ].map((p) =>
        prisma.port.upsert({
          where: { unlocode: p.unlocode },
          update: { country: p.country },
          create: { ...p, lat: 0, lon: 0 },
          select: { id: true },
        }),
      ),
    );

    const trip = await prisma.trip.create({
      data: { userId, name: "Cruise only", status: "completed" },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        startDate: new Date("2026-05-01"),
        endDate: new Date("2026-05-08"),
        departurePortId: ports[0].id,
        arrivalPortId: ports[0].id,
      },
    });
    await prisma.cruiseStop.createMany({
      data: [
        { cruiseId: cruise.id, portId: ports[1].id, dayNumber: 1, isAtSea: false },
        { cruiseId: cruise.id, portId: ports[2].id, dayNumber: 2, isAtSea: false },
        { cruiseId: cruise.id, portId: null, dayNumber: 3, isAtSea: true },
      ],
    });

    try {
      const res = await request(app)
        .get("/api/v1/trips")
        .set("Cookie", authCookie)
        .expect(200);
      const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
      // Departure/arrival port + both calls, folded to ISO, deduplicated and
      // sorted. The sea day contributes nothing, as it should.
      expect(listed.countries).toEqual(["GR", "HR", "IT"]);

      const detail = await request(app)
        .get(`/api/v1/trips/${trip.id}`)
        .set("Cookie", authCookie)
        .expect(200);
      expect(detail.body.trip.countries).toEqual(listed.countries);
    } finally {
      await prisma.cruiseStop.deleteMany({ where: { cruiseId: cruise.id } });
      await prisma.cruise.delete({ where: { id: cruise.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.port.deleteMany({ where: { unlocode: { in: ["ZZUA1", "ZZUA2", "ZZUA3"] } } });
    }
  });

  it("counts a country once when a flight AND a cruise both reach it", async () => {
    // The catalogues speak different languages: the airport says "DE", the port
    // says "Germany". Without folding, this trip would carry both and report
    // one country too many — the same defect the cross-domain stats KPI had.
    const port = await prisma.port.upsert({
      where: { unlocode: "ZZUA4" },
      update: { country: "Germany" },
      create: { name: "UAT Port DE", country: "Germany", unlocode: "ZZUA4", lat: 0, lon: 0 },
      select: { id: true },
    });

    const trip = await prisma.trip.create({
      data: { userId, name: "Flight and cruise", status: "completed" },
    });
    const flight = await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        depIata: "XQA", // Germany
        arrIata: "XQB", // Spain
        departureTime: new Date("2026-06-01T08:00:00.000Z"),
        status: "flown",
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
      select: { id: true },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        startDate: new Date("2026-06-05"),
        endDate: new Date("2026-06-12"),
        departurePortId: port.id, // Germany again, spelled the other way
        arrivalPortId: port.id,
      },
      select: { id: true },
    });

    try {
      const res = await request(app)
        .get("/api/v1/trips")
        .set("Cookie", authCookie)
        .expect(200);
      const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
      // DE once, not "DE" plus "Germany".
      expect(listed.countries).toEqual(["DE", "ES"]);
    } finally {
      await prisma.cruise.delete({ where: { id: cruise.id } });
      await prisma.flight.delete({ where: { id: flight.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.port.deleteMany({ where: { unlocode: "ZZUA4" } });
    }
  });

  it("keeps a country the catalogues do not recognise instead of dropping it", async () => {
    const port = await prisma.port.upsert({
      where: { unlocode: "ZZUA5" },
      update: { country: "Freedonia" },
      create: { name: "UAT Port XX", country: "Freedonia", unlocode: "ZZUA5", lat: 0, lon: 0 },
      select: { id: true },
    });
    const trip = await prisma.trip.create({
      data: { userId, name: "Unknown country", status: "completed" },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        startDate: new Date("2026-07-01"),
        endDate: new Date("2026-07-08"),
        departurePortId: port.id,
        arrivalPortId: port.id,
      },
      select: { id: true },
    });
    try {
      const res = await request(app)
        .get("/api/v1/trips")
        .set("Cookie", authCookie)
        .expect(200);
      const listed = res.body.trips.find((t: { id: string }) => t.id === trip.id);
      expect(listed.countries).toEqual(["Freedonia"]);
    } finally {
      await prisma.cruise.delete({ where: { id: cruise.id } });
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.port.deleteMany({ where: { unlocode: "ZZUA5" } });
    }
  });

  it("returns an empty list for a trip with no flights rather than failing", async () => {
    const empty = await prisma.trip.create({
      data: { userId, name: "No segments", status: "planned" },
    });
    try {
      const res = await request(app)
        .get("/api/v1/trips")
        .set("Cookie", authCookie)
        .expect(200);
      const trip = res.body.trips.find((t: { id: string }) => t.id === empty.id);
      expect(trip.countries).toEqual([]);
    } finally {
      await prisma.trip.delete({ where: { id: empty.id } });
    }
  });
});
