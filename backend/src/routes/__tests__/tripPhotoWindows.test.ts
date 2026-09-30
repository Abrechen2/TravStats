import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Package 9, item 4: trip photos on a stay, a flight and a cruise, found at
 * read time by when and where they were taken.
 *
 * The lodging case pins the zone (a photo at 00:30 Rome time the day after
 * check-out does not count, though its UTC day is the check-out day) and the
 * 500 m radius. The flight case pins the window and
 * the abstention on a wall clock stored as UTC. Every case pins ownership.
 */
describe("trip photos by when and where", () => {
  const stamp = Date.now();
  let cookie: string;
  let strangerCookie: string;
  let userId: string;
  let strangerId: string;
  let tripId: string;
  const ids: Record<string, string> = {};

  const photo = async (key: string, takenAt: string, lat: number | null, lon: number | null) => {
    ids[key] = (
      await prisma.tripPhoto.create({
        data: {
          tripId,
          filename: `win-${stamp}-${key}.jpg`,
          mimetype: "image/jpeg",
          sizeBytes: 1,
          takenAt: new Date(takenAt),
          lat,
          lon,
        },
      })
    ).id;
  };
  const photoIds = (res: request.Response): string[] =>
    res.body.data.photos.map((p: { id: string }) => p.id);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `win-${stamp}`, passwordHash } })).id;
    strangerId = (
      await prisma.user.create({ data: { username: `win-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Roma" } })).id;

    // At the hotel (Rome, UTC+2 in May), during the stay 1–3 May.
    await photo("atHotel", "2024-05-02T10:00:00Z", 41.9, 12.49);
    // 00:30 local on 3 May, the check-out day.
    await photo("checkoutNight", "2024-05-02T22:30:00Z", 41.9001, 12.4901);
    // 00:30 local on 4 May: after the stay, though its UTC day is 3 May.
    await photo("afterStay", "2024-05-03T22:30:00Z", 41.9001, 12.4901);
    // During the stay, but across town.
    await photo("acrossTown", "2024-05-02T11:00:00Z", 41.95, 12.55);
    // In the air on 1 May, 08:00–10:00 UTC.
    await photo("inFlight", "2024-05-01T09:00:00Z", null, null);
    await photo("beforeFlight", "2024-05-01T07:00:00Z", null, null);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `win-` } } });
  });

  it("shows a lodging the photos of its stay days taken near it", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Roma", lat: 41.9, lon: 12.49 },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2024-05-01T00:00:00Z"),
        checkOut: new Date("2024-05-03T00:00:00Z"),
      },
    });

    const res = await request(app)
      .get(`/api/v1/lodging/${lodging.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(photoIds(res)).toEqual([ids.atHotel, ids.checkoutNight]);
    expect(res.body.data.photos[0].url).toBe(`/api/v1/trips/${tripId}/photos/${ids.atHotel}/file`);
    // forgejo#132 items 10 and 11: the rule that found them, and where each was taken.
    expect(res.body.data.photos[0]).toMatchObject({ lat: 41.9, lon: 12.49 });
    expect(res.body.data).toMatchObject({
      total: 2,
      limit: 48,
      reason: null,
      window: {
        basis: "localDay",
        ranges: [{ from: "2024-05-01", to: "2024-05-03" }],
        timeZone: "Europe/Rome",
        radiusKm: 0.5,
        center: { lat: 41.9, lon: 12.49 },
      },
    });

    const stranger = await request(app)
      .get(`/api/v1/lodging/${lodging.id}/trip-photos`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);
  });

  it("shows a flight its trip's photos between departure and arrival", async () => {
    const flight = await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "FCO",
        arrLat: 41.8,
        arrLon: 12.25,
        departureTime: new Date("2024-05-01T08:00:00Z"),
        arrivalTime: new Date("2024-05-01T10:00:00Z"),
        status: "flown",
      },
    });
    const res = await request(app)
      .get(`/api/v1/flights/${flight.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(photoIds(res)).toEqual([ids.inFlight]);
    expect(res.body.data).toMatchObject({
      total: 1,
      reason: null,
      window: {
        basis: "instant",
        ranges: [{ from: "2024-05-01T08:00:00.000Z", to: "2024-05-01T10:00:00.000Z" }],
        timeZone: null,
        radiusKm: null,
        center: null,
      },
    });

    // A wall clock stored as UTC is hours off; no window rather than a wrong one.
    await prisma.flight.update({
      where: { id: flight.id },
      data: { depTimeSemantics: "LEGACY_FAKE_UTC" },
    });
    const legacy = await request(app)
      .get(`/api/v1/flights/${flight.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(photoIds(legacy)).toEqual([]);
    expect(legacy.body.data).toMatchObject({ total: 0, window: null, reason: "notRealInstants" });

    const stranger = await request(app)
      .get(`/api/v1/flights/${flight.id}/trip-photos`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);
  });

  // Rail (rail spec): a ride is a flight by train — the same window, and the
  // same abstention when its times are not real instants.
  it("shows a train ride its trip's photos between departure and arrival", async () => {
    const ride = await prisma.railJourney.create({
      data: {
        userId,
        tripId,
        depStationName: "Frankfurt (Main) Hbf",
        arrStationName: "Roma Termini",
        depLat: 50.107,
        depLon: 8.663,
        arrLat: 41.901,
        arrLon: 12.501,
        depTimezone: "Europe/Berlin",
        arrTimezone: "Europe/Rome",
        departureTime: new Date("2024-05-01T08:00:00Z"),
        arrivalTime: new Date("2024-05-01T10:00:00Z"),
        status: "completed",
      },
    });
    const url = `/api/v1/rail/${ride.id}/trip-photos`;
    expect(photoIds(await request(app).get(url).set("Cookie", cookie))).toEqual([ids.inFlight]);

    await prisma.railJourney.update({ where: { id: ride.id }, data: { depTimezone: null } });
    expect(photoIds(await request(app).get(url).set("Cookie", cookie))).toEqual([]);

    expect((await request(app).get(url).set("Cookie", strangerCookie)).status).toBe(404);
  });

  it("shows a cruise its trip's photos from its first to its last day", async () => {
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId,
        cruiseLine: "Test Line",
        startDate: new Date("2024-05-02T00:00:00Z"),
        endDate: new Date("2024-05-02T00:00:00Z"),
        status: "flown",
      },
    });
    const res = await request(app)
      .get(`/api/v1/cruises/${cruise.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(photoIds(res)).toEqual([ids.atHotel, ids.acrossTown, ids.checkoutNight]);
    expect(res.body.data.window).toEqual({
      basis: "utcDay",
      ranges: [{ from: "2024-05-02", to: "2024-05-02" }],
      timeZone: null,
      radiusKm: null,
      center: null,
    });

    const stranger = await request(app)
      .get(`/api/v1/cruises/${cruise.id}/trip-photos`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);
  });

  it("says how many there are when the strip is capped, and why an entry has no window", async () => {
    const bigTrip = (await prisma.trip.create({ data: { userId, name: "Viele Fotos" } })).id;
    await prisma.tripPhoto.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        tripId: bigTrip,
        filename: `win-${stamp}-many-${i}.jpg`,
        mimetype: "image/jpeg",
        sizeBytes: 1,
        takenAt: new Date(Date.UTC(2030, 5, 1, 8, i)),
      })),
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: bigTrip,
        cruiseLine: "Test Line",
        startDate: new Date("2030-06-01T00:00:00Z"),
        endDate: new Date("2030-06-01T00:00:00Z"),
        status: "planned",
      },
    });
    const res = await request(app)
      .get(`/api/v1/cruises/${cruise.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(res.body.data.photos).toHaveLength(48);
    expect(res.body.data).toMatchObject({ total: 50, limit: 48 });

    const offTrip = await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: "Test Line",
        startDate: new Date("2030-06-01"),
        status: "planned",
      },
    });
    const none = await request(app)
      .get(`/api/v1/cruises/${offTrip.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(none.body.data).toEqual({
      photos: [],
      total: 0,
      limit: 48,
      window: null,
      reason: "notOnTrip",
    });

    const unplaced = await prisma.lodging.create({ data: { userId, name: "Ohne Ort" } });
    const noPlace = await request(app)
      .get(`/api/v1/lodging/${unplaced.id}/trip-photos`)
      .set("Cookie", cookie);
    expect(noPlace.body.data).toMatchObject({ window: null, reason: "noCoordinates" });
  });

  it("never shows another user's photos, even where a record points at their trip", async () => {
    // The stranger was at the same hotel, on the same flight, at the same time.
    const theirTrip = (await prisma.trip.create({ data: { userId: strangerId, name: "Roma" } })).id;
    const theirs = await Promise.all(
      [
        ["2024-05-02T10:30:00Z", 41.9, 12.49],
        ["2024-05-01T09:30:00Z", null, null],
      ].map(
        async ([takenAt, lat, lon]) =>
          (
            await prisma.tripPhoto.create({
              data: {
                tripId: theirTrip,
                filename: `win-${stamp}-theirs-${takenAt}.jpg`,
                mimetype: "image/jpeg",
                sizeBytes: 1,
                takenAt: new Date(takenAt as string),
                lat: lat as number | null,
                lon: lon as number | null,
              },
            })
          ).id
      )
    );

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Roma bis", lat: 41.9, lon: 12.49 },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2024-05-01T00:00:00Z"),
        checkOut: new Date("2024-05-03T00:00:00Z"),
      },
    });
    // A foreign key proves the trip exists, not that it is the caller's.
    const flight = await prisma.flight.create({
      data: {
        userId,
        tripId: theirTrip,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "FCO",
        arrLat: 41.8,
        arrLon: 12.25,
        departureTime: new Date("2024-05-01T08:00:00Z"),
        arrivalTime: new Date("2024-05-01T10:00:00Z"),
        status: "flown",
      },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: theirTrip,
        cruiseLine: "Test Line",
        startDate: new Date("2024-05-01T00:00:00Z"),
        endDate: new Date("2024-05-02T00:00:00Z"),
        status: "flown",
      },
    });

    const seen = await Promise.all(
      [
        `/api/v1/lodging/${lodging.id}/trip-photos`,
        `/api/v1/flights/${flight.id}/trip-photos`,
        `/api/v1/cruises/${cruise.id}/trip-photos`,
      ].map(async (url) => {
        const res = await request(app).get(url).set("Cookie", cookie);
        expect(res.status).toBe(200);
        return photoIds(res);
      })
    );
    expect(seen[0]).toContain(ids.atHotel);
    for (const list of seen) for (const id of theirs) expect(list).not.toContain(id);
  });
});
