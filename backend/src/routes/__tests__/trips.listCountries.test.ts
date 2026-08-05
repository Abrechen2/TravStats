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
    // Deduplicated (Germany appears at both ends) and sorted.
    expect(trip.countries).toEqual(["Germany", "Spain"]);
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
