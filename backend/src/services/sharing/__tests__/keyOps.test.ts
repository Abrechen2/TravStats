import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import {
  assignShareKeys,
  clearTripKeys,
  keyedDelegate,
  keyedIdsOnTrip,
  sharedIdsOf,
} from "../keyOps";
import { SHARE_ENTITIES } from "../shareTypes";

/**
 * Keying, clearing and finding shared rows is one loop over the registry
 * (spec 2026-10-16, D2) — so a type added there is keyed on share, cleared on
 * detach and found by the bulk sync without a line elsewhere.
 */
describe("key operations over every registered type", () => {
  let anna: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-keys");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  /**
   * makeFullTrip holds one flight, stay, cruise, rail ride and rental and two
   * timeline stops; `addRides` adds one bus and one ferry ride, so every type
   * has a row to key.
   */
  const expected = (entity: string) => (entity === "stop" ? 2 : 1);

  const ride = (tripId: string) => ({
    userId: anna.id,
    tripId,
    depStationName: "Kiel",
    depLat: 54.3167,
    depLon: 10.1394,
    arrStationName: "Göteborg",
    arrLat: 57.6995,
    arrLon: 11.9364,
    departureTime: new Date("2026-06-01T16:45:00Z"),
  });
  const addRides = async (tripId: string) => ({
    bus: await prisma.busJourney.create({ data: ride(tripId) }),
    ferry: await prisma.ferryJourney.create({ data: ride(tripId) }),
  });
  /** A roadtrip station and a route correction: on the trip, never keyed (S1 copies no roadtrip). */
  const addStations = async (tripId: string) => {
    const route = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, name: "Südschweden", mode: "car", kind: "roadtrip" },
    });
    return Promise.all([
      prisma.tripStop.create({
        data: { tripId, routeId: route.id, orderIdx: 10, title: "Station" },
      }),
      prisma.tripStop.create({
        data: { tripId, orderIdx: 11, title: "Korrektur", viaPoint: true },
      }),
    ]);
  };

  it("keys every entry of the trip once, and clears them again", async () => {
    const full = await makeFullTrip(anna);
    const rides = await addRides(full.trip.id);
    const stations = await addStations(full.trip.id);
    await prisma.$transaction((tx) => assignShareKeys(tx, anna.id, full.trip.id));
    // Read directly too: the loop below only sees the types in the registry.
    const bus = await prisma.busJourney.findUniqueOrThrow({ where: { id: rides.bus.id } });
    const ferry = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: rides.ferry.id } });
    expect({ bus: bus.shareKey !== null, ferry: ferry.shareKey !== null }).toEqual({
      bus: true,
      ferry: true,
    });
    const unkeyed = await prisma.tripStop.findMany({
      where: { id: { in: stations.map((s) => s.id) } },
      select: { title: true, shareKey: true },
      orderBy: { orderIdx: "asc" },
    });
    expect(unkeyed).toEqual([
      { title: "Station", shareKey: null },
      { title: "Korrektur", shareKey: null },
    ]);
    for (const entity of SHARE_ENTITIES) {
      const ids = await prisma.$transaction((tx) =>
        keyedIdsOnTrip(tx, entity, anna.id, full.trip.id)
      );
      expect({ entity, n: ids.length }).toEqual({ entity, n: expected(entity) });
    }
    const first = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    await prisma.$transaction((tx) => assignShareKeys(tx, anna.id, full.trip.id));
    const again = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(again.shareKey).toBe(first.shareKey);

    await prisma.$transaction((tx) => clearTripKeys(tx, anna.id, full.trip.id));
    for (const entity of SHARE_ENTITIES) {
      const left = await prisma.$transaction((tx) =>
        keyedDelegate(tx, entity).findMany({
          where: entity === "stop" ? { tripId: full.trip.id } : { userId: anna.id },
          select: { id: true, shareKey: true },
        })
      );
      expect({ entity, keyed: left.filter((r) => r.shareKey).length }).toEqual({
        entity,
        keyed: 0,
      });
    }
  });

  it("finds a user's rows on a shared trip for the bulk sync", async () => {
    const full = await makeFullTrip(anna);
    await addRides(full.trip.id);
    const group = await prisma.tripShareGroup.create({ data: { createdById: anna.id } });
    await prisma.trip.update({ where: { id: full.trip.id }, data: { shareGroupId: group.id } });
    for (const entity of SHARE_ENTITIES) {
      const ids = await prisma.$transaction((tx) => sharedIdsOf(tx, anna.id, entity));
      expect({ entity, n: ids.length }).toEqual({ entity, n: expected(entity) });
    }
  });
});
