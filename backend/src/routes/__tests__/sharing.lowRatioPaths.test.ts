import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { mergeTrips } from "../../services/tripCleanupService";
import { SHARE_ENTITIES, SHARE_TYPES } from "../../services/sharing/shareTypes";
import {
  makeAccount,
  makeFullTrip,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * The write paths the old per-file guard rated weakest (2026-10-16 count:
 * trip/exchange/commit.ts 8 writes / 1 propagate call, tripCleanupService.ts
 * 8/2, lodgingImportBatches.ts 3/1, routes/trips.ts 3/2), run end to end on a
 * shared trip: whatever they write must reach — or be reported to — Ben.
 */
describe("trip sharing — the low-ratio write paths", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-low");
    ben = await makeAccount("ben-low");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const countsOf = async (userId: string) =>
    Object.fromEntries(
      await Promise.all(
        SHARE_ENTITIES.filter((e) => e !== "stop").map(async (e) => [
          e,
          await prisma
            .$queryRawUnsafe<{ n: bigint }[]>(
              `SELECT count(*)::bigint AS n FROM ${SHARE_TYPES[e].table} WHERE user_id = $1`,
              userId
            )
            .then((r) => Number(r[0].n)),
        ])
      )
    );

  it("a .travstats file imported into the shared trip reaches Ben", async () => {
    const { memberTrip } = await sharedPair(anna, ben);
    // Carl's trip covers the same days (the import attaches to Anna's sole
    // overlapping trip, the shared one) but holds different journeys, so the
    // proposal creates every entry instead of matching Anna's own: a ride
    // matches on its stations and day, a stop on its title.
    const carl = await makeAccount("carl-low");
    const carls = await makeFullTrip(carl);
    await prisma.flight.update({
      where: { id: carls.flight.id },
      data: { flightNumber: "LH1172" },
    });
    await prisma.lodging.update({ where: { id: carls.lodging.id }, data: { name: "Casa Carl" } });
    await prisma.cruise.update({
      where: { id: carls.cruise.id },
      data: { cruiseLine: "TUI Cruises" },
    });
    await prisma.railJourney.update({
      where: { id: carls.rail.id },
      data: { trainNumber: "777", depStationName: "Coimbra-B", arrStationName: "Aveiro" },
    });
    await prisma.rentalBooking.update({
      where: { id: carls.rental.id },
      data: { provider: "Europcar" },
    });
    await prisma.tripStop.update({ where: { id: carls.stops[1].id }, data: { title: "Sintra" } });
    const exported = await request(app)
      .get(`/api/v1/trips/${carls.trip.id}/export`)
      .set("Cookie", carl.cookie)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);

    const before = await countsOf(ben.id);
    await commitTripFile(anna.id, readTripArchive(exported.body as Buffer));
    const after = await countsOf(ben.id);
    for (const e of ["flight", "lodgingStay", "cruise", "rail", "rental"]) {
      expect({ e, grew: after[e] > before[e] }).toEqual({ e, grew: true });
    }
    expect(await prisma.tripStop.count({ where: { tripId: memberTrip.id } })).toBeGreaterThan(2);
  });

  it("merging a trip into the shared one copies what moved", async () => {
    const { full } = await sharedPair(anna, ben);
    const other = await makeFullTrip(anna);
    const before = await countsOf(ben.id);
    await mergeTrips(anna.id, { tripIds: [full.trip.id, other.trip.id], targetId: full.trip.id });
    const after = await countsOf(ben.id);
    expect(after.flight).toBe(before.flight + 1);
    expect(after.rail).toBe(before.rail + 1);
  });

  it("deleting the shared trip detaches it and tells Ben", async () => {
    const { full } = await sharedPair(anna, ben);
    const res = await request(app)
      .delete(`/api/v1/trips/${full.trip.id}`)
      .set("Cookie", anna.cookie);
    expect(res.status).toBe(204);
    expect(await prisma.shareNotice.count({ where: { userId: ben.id, kind: "left" } })).toBe(1);
    // detachTrip clears the leaver's keys only; her entries survive, unfiled.
    expect(await prisma.flight.count({ where: { userId: anna.id, shareKey: { not: null } } })).toBe(
      0
    );
    expect(await prisma.flight.count({ where: { userId: anna.id, tripId: null } })).toBe(1);
  });

  // A station of a tour drawn over the timeline is not copied while it is one
  // (`adapters/stop.ts`, `excluded`); released, it is an ordinary stop of the
  // shared trip again — whether the tour is deleted or only drops it.
  const tourOverSharedTrip = async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    const route = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId: full.trip.id, name: "Sintra-Runde", mode: "road" },
    });
    await prisma.tripStop.create({
      data: {
        tripId: full.trip.id,
        orderIdx: 2,
        title: "Sintra",
        lat: 38.7975,
        lon: -9.3906,
        routeId: route.id,
        routeOrderIdx: 0,
      },
    });
    const benStops = async () =>
      (
        await prisma.tripStop.findMany({
          where: { tripId: memberTrip.id },
          select: { title: true },
        })
      ).map((s) => s.title);
    return { tripId: full.trip.id, routeId: route.id, benStops, before: (await benStops()).length };
  };

  it("deleting a tour over the shared trip hands its stations to Ben", async () => {
    const { tripId, routeId, benStops, before } = await tourOverSharedTrip();
    const res = await request(app)
      .delete(`/api/v1/trips/${tripId}/routes/${routeId}`)
      .set("Cookie", anna.cookie);
    expect(res.status).toBe(204);
    const titles = await benStops();
    expect(titles).toHaveLength(before + 1);
    expect(titles).toContain("Sintra");
  });

  it("a station dropped from a tour over the shared trip reaches Ben", async () => {
    const { tripId, routeId, benStops, before } = await tourOverSharedTrip();
    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", anna.cookie)
      .send({ stopIds: [] });
    expect(res.status).toBe(200);
    const titles = await benStops();
    expect(titles).toHaveLength(before + 1);
    expect(titles).toContain("Sintra");
  });
});
