import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /places/:id/visit-date-suggestions` — dates the add-visit form offers.
 * Pinned: distance is measured (a hotel 1 km away counts, one in Milan does
 * not), days come out in the PLACE's zone, a recorded day is not offered again,
 * a chosen trip narrows the answer, and nothing of another account leaks.
 */
describe("GET /api/v1/places/:id/visit-date-suggestions", () => {
  let user: { id: string };
  let other: { id: string };
  let authCookie: string;
  let placeId: string;
  let foreignPlaceId: string;
  let tripWithStay: string;
  let tripWithoutEntries: string;
  let longTrip: string;
  let foreignTrip: string;

  // The Colosseum.
  const HERE = { lat: 41.8902, lon: 12.4922 };
  const at = (iso: string) => new Date(iso);

  const suggest = (id: string, query: Record<string, string> = {}) =>
    request(app)
      .get(`/api/v1/places/${id}/visit-date-suggestions`)
      .query(query)
      .set("Cookie", authCookie);

  beforeAll(async () => {
    const ts = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${ts}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("visit-date-suggest");
    other = await make("visit-date-suggest-other");
    authCookie = `auth_token=${generateToken(user.id)}`;

    placeId = (await prisma.place.create({ data: { userId: user.id, name: "Kolosseum", ...HERE } }))
      .id;
    foreignPlaceId = (
      await prisma.place.create({ data: { userId: other.id, name: "Kolosseum", ...HERE } })
    ).id;

    const trip = (userId: string, name: string, start?: string, end?: string) =>
      prisma.trip.create({
        data: {
          userId,
          name,
          startDate: start ? at(`${start}T00:00:00Z`) : null,
          endDate: end ? at(`${end}T00:00:00Z`) : null,
        },
      });
    tripWithStay = (await trip(user.id, "Rom 2024", "2024-05-09", "2024-05-14")).id;
    tripWithoutEntries = (await trip(user.id, "Rom 2021", "2021-06-01", "2021-06-03")).id;
    longTrip = (await trip(user.id, "Sabbatical", "2020-01-01", "2020-03-01")).id;
    foreignTrip = (await trip(other.id, "Fremd", "2019-01-01", "2019-01-02")).id;

    const house = (userId: string, name: string, lat: number, lon: number) =>
      prisma.lodging.create({ data: { userId, name, lat, lon } });
    const rome = await house(user.id, "Hotel Forum", 41.8955, 12.4823); // ~1 km
    const milan = await house(user.id, "Hotel Milano", 45.4642, 9.19);
    const foreignRome = await house(other.id, "Fremdes Hotel", 41.8905, 12.4925);
    const stay = (
      lodgingId: string,
      userId: string,
      checkIn: string,
      checkOut: string,
      tripId?: string
    ) => ({
      lodgingId,
      userId,
      checkIn: at(`${checkIn}T00:00:00Z`),
      checkOut: at(`${checkOut}T00:00:00Z`),
      tripId: tripId ?? null,
    });
    await prisma.lodgingStay.createMany({
      data: [
        stay(rome.id, user.id, "2024-05-10", "2024-05-12", tripWithStay),
        // More recent, but in Milan: not near.
        stay(milan.id, user.id, "2025-01-01", "2025-01-03"),
        // Near, but not yet begun: not "the last time you were here".
        stay(rome.id, user.id, "2099-01-01", "2099-01-02"),
        // Near and more recent — but someone else's.
        stay(foreignRome.id, other.id, "2025-03-01", "2025-03-02"),
      ],
    });

    const flight = (userId: string, arrivalTime: string, lat: number, lon: number) => ({
      userId,
      depLat: 52.36,
      depLon: 13.5,
      arrIata: "FCO",
      arrLat: lat,
      arrLon: lon,
      departureTime: at(arrivalTime),
      arrivalTime: at(arrivalTime),
      status: "flown",
    });
    await prisma.flight.createMany({
      data: [
        // 23:30 UTC is 01:30 the next morning in Rome.
        flight(user.id, "2024-05-09T23:30:00Z", 41.8003, 12.2389),
        flight(other.id, "2025-04-01T10:00:00Z", 41.8003, 12.2389),
      ],
    });

    const photoTrip = await trip(user.id, "Fotos");
    const foreignPhotoTrip = await trip(other.id, "Fremde Fotos");
    const photo = (tripId: string, takenAt: string, lat: number, lon: number) => ({
      tripId,
      filename: `p-${Math.random()}.jpg`,
      mimetype: "image/jpeg",
      sizeBytes: 1,
      takenAt: at(takenAt),
      lat,
      lon,
    });
    await prisma.tripPhoto.createMany({
      data: [
        photo(photoTrip.id, "2023-07-01T09:00:00Z", 41.8903, 12.4923),
        photo(photoTrip.id, "2023-07-01T10:00:00Z", 41.8904, 12.4921),
        photo(photoTrip.id, "2023-07-02T10:00:00Z", 41.8901, 12.4924),
        // Local day 2023-07-04, UTC day 2023-07-03.
        photo(photoTrip.id, "2023-07-03T23:30:00Z", 41.8902, 12.4922),
        // ~1 km away: the town, not the place.
        photo(photoTrip.id, "2023-08-01T10:00:00Z", 41.8992, 12.4922),
        photo(foreignPhotoTrip.id, "2022-01-01T10:00:00Z", 41.8902, 12.4922),
      ],
    });

    // 2023-07-02 is already recorded.
    await prisma.placeVisit.create({
      data: { placeId, userId: user.id, visitedAt: at("2023-07-02T15:00:00.000Z") },
    });
  });

  afterAll(async () => {
    const ids = { in: [user?.id, other?.id] };
    await prisma.lodgingStay.deleteMany({ where: { userId: ids } });
    await prisma.lodging.deleteMany({ where: { userId: ids } });
    await prisma.flight.deleteMany({ where: { userId: ids } });
    await prisma.place.deleteMany({ where: { userId: ids } });
    await prisma.trip.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
  });

  it("offers the last nearby stay and arrival, and the photo days, in the envelope", async () => {
    const res = await suggest(placeId);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const byDate = Object.fromEntries(
      res.body.data.suggestions.map((s: { date: string }) => [s.date, s])
    );

    expect(byDate["2024-05-10"]).toMatchObject({ source: "stay", label: "Hotel Forum" });
    expect(byDate["2024-05-12"]).toMatchObject({ source: "stay" });
    // The arrival, dated in Rome's zone: 23:30 UTC on the 9th is the 10th there,
    // which the stay already offers — so it gains nothing and adds no chip.
    expect(byDate["2024-05-09"]).toBeUndefined();

    expect(byDate["2023-07-01"]).toMatchObject({ source: "photo", photoCount: 2 });
    expect(byDate["2023-07-04"]).toMatchObject({ source: "photo", photoCount: 1 });
    expect(byDate["2023-07-03"]).toBeUndefined();
  });

  it("measures the distance: Milan, the town photo and the future stay stay out", async () => {
    const res = await suggest(placeId);
    const dates = res.body.data.suggestions.map((s: { date: string }) => s.date);
    expect(dates).not.toContain("2025-01-01");
    expect(dates).not.toContain("2023-08-01");
    expect(dates).not.toContain("2099-01-01");
  });

  it("leaves out a day that already carries a visit", async () => {
    const res = await suggest(placeId);
    const dates = res.body.data.suggestions.map((s: { date: string }) => s.date);
    expect(dates).not.toContain("2023-07-02");
  });

  it("never offers another account's stays, flights or photographs", async () => {
    const res = await suggest(placeId);
    const dates = res.body.data.suggestions.map((s: { date: string }) => s.date);
    expect(dates).not.toContain("2025-03-01");
    expect(dates).not.toContain("2025-04-01");
    expect(dates).not.toContain("2022-01-01");
  });

  it("with a trip: that trip's nearby entries, dated in the place's zone", async () => {
    const res = await suggest(placeId, { tripId: tripWithStay });
    const entries = res.body.data.suggestions.filter(
      (s: { source: string }) => s.source !== "photo"
    );
    expect(entries.map((s: { date: string }) => s.date)).toEqual([
      "2024-05-10",
      "2024-05-11",
      "2024-05-12",
    ]);
  });

  it("with a trip that has nothing near: the trip's own days", async () => {
    const res = await suggest(placeId, { tripId: tripWithoutEntries });
    const trip = res.body.data.suggestions.filter((s: { source: string }) => s.source === "trip");
    expect(trip.map((s: { date: string }) => s.date)).toEqual([
      "2021-06-01",
      "2021-06-02",
      "2021-06-03",
    ]);
    expect(trip[0].label).toBe("Rom 2021");
  });

  it("abstains on a trip too long to name a day", async () => {
    const res = await suggest(placeId, { tripId: longTrip });
    expect(
      res.body.data.suggestions.filter((s: { source: string }) => s.source === "trip")
    ).toEqual([]);
  });

  it("treats another account's trip as no trip at all", async () => {
    const res = await suggest(placeId, { tripId: foreignTrip });
    expect(res.status).toBe(200);
    expect(
      res.body.data.suggestions.filter((s: { source: string }) => s.source !== "photo")
    ).toEqual([]);
  });

  it("404s on another account's place and 400s on a malformed trip id", async () => {
    expect((await suggest(foreignPlaceId)).status).toBe(404);
    expect((await suggest(placeId, { tripId: "nope" })).status).toBe(400);
  });
});
