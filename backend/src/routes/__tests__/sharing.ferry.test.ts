import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { computeSchematicRoute } from "../../services/schematicRouter";
import { detachTrip } from "../../services/sharing/detach";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

jest.mock("../../services/schematicRouter", () => ({
  ...jest.requireActual<object>("../../services/schematicRouter"),
  computeSchematicRoute: jest.fn(),
}));

/**
 * Ferry crossings in a shared trip (spec 2026-10-16, G2). Rail's and bus's
 * rule: operator, vessel, terminals, times and distance are facts; fare class,
 * seat, cabin, booking and ticket references, price, notes, companions, the
 * vehicle on board and the roadtrip leg stay private.
 */
describe("trip sharing — ferry crossings", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  const crossing = (userId: string, extra: object = {}) =>
    prisma.ferryJourney.create({
      data: {
        userId,
        operator: "Stena Line",
        vesselName: "Stena Germanica",
        vesselMmsi: "265177000",
        depStationName: "Kiel Schwedenkai",
        depLat: 54.3167,
        depLon: 10.1394,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationName: "Göteborg Stigberget",
        arrLat: 57.6995,
        arrLon: 11.9364,
        arrCountry: "SE",
        arrTimezone: "Europe/Stockholm",
        departureTime: new Date("2026-06-01T16:45:00Z"),
        arrivalTime: new Date("2026-06-02T07:15:00Z"),
        depPrecision: "minute",
        arrPrecision: "minute",
        distanceKm: 452,
        status: "scheduled",
        fareClass: "Comfort",
        seat: "PRIVATE-SEAT",
        cabinType: "outside",
        ticketReference: "TICKET-PRIV",
        bookingReference: "BOOK-PRIV",
        vehicleType: "car",
        vehicleRegistration: "KI-AB 123",
        price: 389,
        notes: "PRIVATE ferry note",
        ...extra,
      },
    });
  const bens = () => prisma.ferryJourney.findMany({ where: { userId: ben.id } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-ferry");
    ben = await makeAccount("ben-ferry");
    tripId = (await prisma.trip.create({ data: { userId: anna.id, name: "Schweden" } })).id;
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("copies a crossing's facts and none of its private fields", async () => {
    await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    const result = await shareTrip(anna.id, tripId, companion.id);
    expect(result.created.ferryJourneys).toBe(1);
    const [copy] = await bens();
    expect(copy).toMatchObject({
      operator: "Stena Line",
      vesselName: "Stena Germanica",
      // The MMSI binds the live position to the owner's booking; it is private.
      vesselMmsi: null,
      depStationName: "Kiel Schwedenkai",
      distanceKm: 452,
      seat: null,
      cabinType: null,
      ticketReference: null,
      bookingReference: null,
      vehicleType: null,
      vehicleRegistration: null,
      price: null,
      notes: null,
      roadtripLegId: null,
    });
    expect(copy.shareKey).not.toBeNull();
  });

  it("joins Ben's own logged crossing instead of copying it", async () => {
    await crossing(anna.id, { tripId });
    const own = await crossing(ben.id, { depLat: 54.317, seat: "BEN-SEAT" });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const rows = await bens();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: own.id, seat: "BEN-SEAT" });
    // Joined, not merely left alone: it took the key and was filed on Ben's trip.
    const bensTrip = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    expect(rows[0].shareKey).not.toBeNull();
    expect(rows[0].tripId).toBe(bensTrip.id);
  });

  it.each([
    ["a terminal about 1.5 km away", { depLat: 54.3167 + 0.0135 }],
    // 22:45 UTC is 00:45 on the next day in Berlin — inside the 2-day window.
    ["a different local day", { departureTime: new Date("2026-06-01T22:45:00Z") }],
    ["a cancelled crossing", { status: "cancelled" }],
  ])("does not join Ben's own crossing with %s", async (_label, differs) => {
    await crossing(anna.id, { tripId });
    const own = await crossing(ben.id, { seat: "BEN-SEAT", ...differs });
    const companion = await linkWithConsent(anna, ben);
    const result = await shareTrip(anna.id, tripId, companion.id);
    expect(result.created.ferryJourneys).toBe(1);
    const rows = await bens();
    expect(rows).toHaveLength(2);
    const untouched = rows.find((r) => r.id === own.id);
    expect(untouched).toMatchObject({ seat: "BEN-SEAT", shareKey: null, tripId: null });
    expect(rows.find((r) => r.id !== own.id)?.shareKey).not.toBeNull();
  });

  it("follows an edit and tells Ben about a delete", async () => {
    const annas = await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    await prisma.shareNotice.deleteMany({ where: { userId: ben.id } });

    const patched = await request(app)
      .patch(`/api/v1/ferry/${annas.id}`)
      .set("Cookie", anna.cookie)
      .send({ vesselName: "Stena Scandinavica" });
    expect(patched.status).toBe(200);
    expect((await bens())[0].vesselName).toBe("Stena Scandinavica");
    const updated = await prisma.shareNotice.findFirstOrThrow({
      where: { userId: ben.id, kind: "updated" },
    });
    expect(updated.entityType).toBe("ferry");

    const removed = await request(app)
      .delete(`/api/v1/ferry/${annas.id}`)
      .set("Cookie", anna.cookie);
    expect(removed.status).toBe(204);
    expect(await bens()).toHaveLength(1);
    expect(
      await prisma.shareNotice.count({
        where: { userId: ben.id, kind: "deleted", entityType: "ferry" },
      })
    ).toBe(1);
  });

  it("hands a computed sea route on to Ben's copy", async () => {
    const annas = await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const line: Array<[number, number]> = [
      [10.1394, 54.3167],
      [10.9, 55.4],
      [11.6, 57.2],
      [11.9364, 57.6995],
    ];
    jest.mocked(computeSchematicRoute).mockResolvedValueOnce({
      waypoints: line,
      protectedPrefixCount: 0,
      protectedSuffixCount: 0,
      routed: true,
      method: "maritime_graph",
    });
    const res = await request(app)
      .post(`/api/v1/ferry/${annas.id}/route`)
      .set("Cookie", anna.cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("routed");
    const [copy] = await bens();
    expect(copy.geometrySource).toBe("sea_route");
    expect(copy.geometry).toEqual(line);
  });

  it("routes the roadtrip leg Ben linked to his copy as well", async () => {
    const annas = await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const [copy] = await bens();
    const route = await prisma.tripRoute.create({
      data: {
        userId: ben.id,
        tripId: copy.tripId!,
        name: "Bens roadtrip",
        kind: "roadtrip",
        mode: "road",
      },
    });
    const stop = (title: string, lat: number, lon: number, orderIdx: number) =>
      prisma.tripStop.create({
        data: { tripId: copy.tripId!, routeId: route.id, title, lat, lon, orderIdx },
      });
    const from = await stop("Kiel", 54.3167, 10.1394, 0);
    const to = await stop("Göteborg", 57.6995, 11.9364, 1);
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: from.id,
        toStopId: to.id,
        mode: "road",
        source: "straight",
        distanceKm: 420,
      },
    });
    await request(app)
      .put(`/api/v1/ferry/${copy.id}/roadtrip-leg`)
      .set("Cookie", ben.cookie)
      .send({ legId: leg.id })
      .expect(200);
    const line: Array<[number, number]> = [
      [10.1394, 54.3167],
      [10.9, 55.4],
      [11.6, 57.2],
      [11.9364, 57.6995],
    ];
    jest.mocked(computeSchematicRoute).mockResolvedValueOnce({
      waypoints: line,
      protectedPrefixCount: 0,
      protectedSuffixCount: 0,
      routed: true,
      method: "maritime_graph",
    });
    await request(app)
      .post(`/api/v1/ferry/${annas.id}/route`)
      .set("Cookie", anna.cookie)
      .send({})
      .expect(200);
    expect(await prisma.tripRouteLeg.findUnique({ where: { id: leg.id } })).toMatchObject({
      mode: "ferry",
      source: "routed",
      waypoints: line,
    });
  });

  it("clears the crossing's key when Ben leaves", async () => {
    await crossing(anna.id, { tripId });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const bensTrip = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    await prisma.$transaction((tx) => detachTrip(tx, ben.id, bensTrip));
    expect((await bens())[0].shareKey).toBeNull();
  });

  it("linking a crossing to a leg of a shared trip copies it without the leg", async () => {
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    const route = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, name: "Südschweden", mode: "car", kind: "roadtrip" },
    });
    const [from, to] = await Promise.all(
      [0, 1].map((orderIdx) =>
        prisma.tripStop.create({
          data: { tripId, routeId: route.id, orderIdx, title: orderIdx ? "Göteborg" : "Kiel" },
        })
      )
    );
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: from.id,
        toStopId: to.id,
        distanceKm: 460,
        source: "osrm",
        mode: "car",
      },
    });
    const annas = await crossing(anna.id);

    const linked = await request(app)
      .put(`/api/v1/ferry/${annas.id}/roadtrip-leg`)
      .set("Cookie", anna.cookie)
      .send({ legId: leg.id });
    expect(linked.status).toBe(200);

    const rows = await bens();
    expect(rows).toHaveLength(1);
    expect(rows[0].roadtripLegId).toBeNull();
    expect(rows[0].roadtripLegBefore).toBeNull();
  });
});
