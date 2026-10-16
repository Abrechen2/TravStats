import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { stopZoneOf } from "../trips/stopTime";
import { buildTripView, loadOwnedTrip } from "../../services/shareLinks/tripView";
import type { ShareLinkField } from "../../schemas/shareLinks";

/**
 * Where a trip is read for what it holds, bus beside rail (forgejo#288/#289
 * sweep): the countries a trip reaches, the zone of a stop that wraps a ride,
 * and the public trip view's totals and route. Each case fails without the
 * bus half.
 */
describe("a trip's bus rides, wherever the trip is read", () => {
  let userId: string;
  let cookie: string;
  let busTripId: string;
  let railTripId: string;
  let rideId: string;

  const end = (name: string, lat: number, lon: number, country: string) => ({
    name,
    lat,
    lon,
    country,
  });
  const ride = (tripId: string, from = "Porto", to = "Vigo") => ({
    userId,
    tripId,
    depStationName: from,
    depLat: 41.15,
    depLon: -8.6,
    depCountry: "PT",
    depTimezone: "Europe/Lisbon",
    arrStationName: to,
    arrLat: 42.24,
    arrLon: -8.72,
    arrCountry: "ES",
    arrTimezone: "Europe/Madrid",
    departureTime: new Date("2026-05-08T09:00:00Z"),
    arrivalTime: new Date("2026-05-08T12:00:00Z"),
  });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `busContract-${Date.now()}`,
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    busTripId = (await prisma.trip.create({ data: { userId, name: "Nur Bus" } })).id;
    railTripId = (await prisma.trip.create({ data: { userId, name: "Nur Bahn" } })).id;
    rideId = (await prisma.busJourney.create({ data: ride(busTripId) })).id;
    await prisma.railJourney.create({ data: ride(railTripId, "Lisboa", "Vigo") });
    // A cancelled ride never went anywhere.
    await prisma.busJourney.create({
      data: { ...ride(busTripId), arrCountry: "FR", status: "cancelled" },
    });
    void end;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists the countries a bus-only and a rail-only trip reach, and not a cancelled ride's", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const byId = new Map<string, { countries: string[] }>(
      res.body.trips.map((t: { id: string; countries: string[] }) => [t.id, t])
    );
    expect(byId.get(busTripId)?.countries).toEqual(["ES", "PT"]);
    expect(byId.get(railTripId)?.countries).toEqual(["ES", "PT"]);
    const detail = await request(app).get(`/api/v1/trips/${busTripId}`).set("Cookie", cookie);
    expect(detail.body.trip.countries).toEqual(["ES", "PT"]);
  });

  it("reads the zone of a stop that wraps a bus ride from the ride", async () => {
    const zone = await stopZoneOf(
      { lat: null, lon: null, domain: "bus", sourceId: rideId },
      userId
    );
    expect(zone).toBe("Europe/Lisbon");
  });

  it("counts a bus ride and draws it on the public trip view's route", async () => {
    const trip = await loadOwnedTrip(userId, busTripId);
    const fields = new Set(["totals", "route", "countries"]) as ReadonlySet<ShareLinkField<"trip">>;
    const view = await buildTripView(userId, trip!, fields, null, []);
    // The cancelled ride still sits on the trip, but it was never travelled: the
    // public view leaves it out like a cancelled flight, and like the trip list
    // leaves out its country (FR) in the first test above.
    expect(view.totals?.busRides).toBe(1);
    expect(view.route?.filter((leg) => leg.mode === "bus")).toHaveLength(1);
    expect(view.route?.[0]).toEqual({ mode: "bus", from: "Porto", to: "Vigo" });
    expect(view.countries).toEqual(["ES", "PT"]);
  });
});
