import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { shareTrip } from "../../services/sharing/shareTrip";
import { detachTrip } from "../../services/sharing/detach";
import { mergeTrips } from "../../services/tripCleanupService";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Bus rides in a shared trip (forgejo#288 sweep). Bus was added to the domain
 * contract after sharing was written, so a shared trip carried no bus ride at
 * all: not copied, not followed, and its key left behind on detach. Rail's
 * rule: operator, line, kind, terminals, times and distance are facts; fare
 * class, seat, booking reference, price, notes and companions stay private.
 */
describe("trip sharing — bus rides", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;
  let rideId: string;
  let bensTripId: string;

  const as = (who: TestAccount) => ({
    patch: (url: string, body: object) =>
      request(app).patch(`/api/v1${url}`).set("Cookie", who.cookie).send(body),
    post: (url: string, body: object) =>
      request(app).post(`/api/v1${url}`).set("Cookie", who.cookie).send(body),
    del: (url: string) => request(app).delete(`/api/v1${url}`).set("Cookie", who.cookie),
  });
  const bens = () => prisma.busJourney.findFirstOrThrow({ where: { userId: ben.id } });
  const notices = () =>
    prisma.shareNotice.findMany({ where: { userId: ben.id }, orderBy: { createdAt: "asc" } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-bus");
    ben = await makeAccount("ben-bus");
    const trip = await prisma.trip.create({
      data: {
        userId: anna.id,
        name: "Busreise",
        startDate: new Date("2026-05-08T00:00:00Z"),
        endDate: new Date("2026-05-09T00:00:00Z"),
      },
    });
    tripId = trip.id;
    const ride = await prisma.busJourney.create({
      data: {
        userId: anna.id,
        tripId,
        operator: "FlixBus",
        lineName: "N17",
        rideKind: "intercity",
        depStationName: "Lisboa Sete Rios",
        depAddress: "Av. Casal Ribeiro",
        depLat: 38.73,
        depLon: -9.17,
        depCountry: "PT",
        depTimezone: "Europe/Lisbon",
        arrStationName: "Porto Campanhã",
        arrLat: 41.15,
        arrLon: -8.59,
        arrTimezone: "Europe/Lisbon",
        departureTime: new Date("2026-05-08T09:15:00Z"),
        arrivalTime: new Date("2026-05-08T11:30:00Z"),
        depPrecision: "minute",
        arrPrecision: "minute",
        distanceKm: 313,
        distanceSource: "route",
        status: "scheduled",
        fareClass: "Premium",
        seat: "B7",
        bookingReference: "FLX-4711",
        price: 19.9,
        notes: "PRIVATE bus note",
        tags: ["private-tag"],
      },
    });
    rideId = ride.id;
    const companion = await linkWithConsent(anna, ben);
    const shared = await shareTrip(anna.id, tripId, companion.id);
    expect(shared.created.busJourneys).toBe(1);
    bensTripId = (await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } })).id;
    // Settle what the fixture left underived (status, distance), then start
    // from a clean inbox — as the other sharing suites do.
    await as(anna).patch(`/bus/${rideId}`, { notes: "settle" }).expect(200);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [anna.id, ben.id] } } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("copies the ride's facts, on the terminals' clocks, and none of its private fields", async () => {
    const copy = await bens();
    const own = await prisma.busJourney.findUniqueOrThrow({ where: { id: rideId } });
    expect(copy).toMatchObject({
      userId: ben.id,
      tripId: bensTripId,
      operator: "FlixBus",
      lineName: "N17",
      rideKind: "intercity",
      depStationName: "Lisboa Sete Rios",
      depAddress: "Av. Casal Ribeiro",
      depTimezone: "Europe/Lisbon",
      departureTime: new Date("2026-05-08T09:15:00Z"),
      arrivalTime: new Date("2026-05-08T11:30:00Z"),
      depPrecision: "minute",
    });
    expect(copy.distanceKm).toBe(own.distanceKm);
    expect(copy.distanceKm).not.toBeNull();
    expect(copy.shareKey).toBe(own.shareKey);
    expect(copy.shareKey).not.toBeNull();
    expect(copy.fareClass).toBeNull();
    expect(copy.seat).toBeNull();
    expect(copy.bookingReference).toBeNull();
    expect(copy.price).toBeNull();
    expect(copy.notes).toBeNull();
    expect(copy.tags).toEqual([]);
    expect(own.seat).toBe("B7");
  });

  it("follows a fact change, says so in the inbox, and ignores a private one", async () => {
    await as(anna).patch(`/bus/${rideId}`, { seat: "C1", notes: "mine" }).expect(200);
    expect(await notices()).toHaveLength(0);
    expect((await bens()).seat).toBeNull();

    await as(anna).patch(`/bus/${rideId}`, { lineName: "N18" }).expect(200);
    expect((await bens()).lineName).toBe("N18");
    expect((await notices()).map((n) => [n.kind, n.entityType])).toEqual([["updated", "bus"]]);
  });

  it("copies a ride created later on the shared trip", async () => {
    const res = await as(anna)
      .post("/bus", {
        tripId,
        operator: "Alsa",
        departureStation: { name: "Porto Campanhã", lat: 41.15, lon: -8.59, country: "PT" },
        arrivalStation: { name: "Braga", lat: 41.55, lon: -8.42, country: "PT" },
        departureLocal: "2026-05-09T10:00",
      })
      .expect(201);
    const mine = await prisma.busJourney.findMany({ where: { userId: ben.id } });
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.operator).sort()).toEqual(["Alsa", "FlixBus"]);
    expect(res.body.data.id).toBeTruthy();
  });

  it("a delete is a notice only: the other member keeps the ride", async () => {
    await as(anna).del(`/bus/${rideId}`).expect(204);
    expect(await bens()).toBeTruthy();
    expect((await notices()).map((n) => [n.kind, n.entityType])).toEqual([["deleted", "bus"]]);
  });

  it("leaving the group clears the ride's key with the others'", async () => {
    await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
      await detachTrip(tx, anna.id, trip);
    });
    const own = await prisma.busJourney.findUniqueOrThrow({ where: { id: rideId } });
    expect(own.shareKey).toBeNull();
    expect(own.tripId).toBe(tripId);
  });

  it("merging trips moves a ride to the surviving trip instead of unfiling it", async () => {
    const target = await prisma.trip.create({ data: { userId: anna.id, name: "Ziel" } });
    const lone = await prisma.trip.create({ data: { userId: anna.id, name: "Quelle" } });
    const ride = await prisma.busJourney.create({
      data: {
        userId: anna.id,
        tripId: lone.id,
        depStationName: "A",
        depLat: 1,
        depLon: 1,
        arrStationName: "B",
        arrLat: 2,
        arrLon: 2,
        departureTime: new Date("2026-06-01T08:00:00Z"),
      },
    });
    const rental = await prisma.rentalBooking.create({
      data: {
        userId: anna.id,
        tripId: lone.id,
        provider: "Sixt",
        pickupStationName: "X",
        pickupLat: 1,
        pickupLon: 1,
        pickupTimezone: "UTC",
        returnStationName: "X",
        returnLat: 1,
        returnLon: 1,
        returnTimezone: "UTC",
        pickupTime: new Date("2026-06-01T09:00:00Z"),
        returnTime: new Date("2026-06-02T09:00:00Z"),
      },
    });
    await mergeTrips(anna.id, { tripIds: [target.id, lone.id], targetId: target.id });
    expect((await prisma.busJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId).toBe(
      target.id
    );
    expect(
      (await prisma.rentalBooking.findUniqueOrThrow({ where: { id: rental.id } })).tripId
    ).toBe(target.id);
  });
});
