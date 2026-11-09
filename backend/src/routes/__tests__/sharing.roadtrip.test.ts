import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { prisma } from "../../db";
import { replaceStations } from "../../services/roadtrip/replaceStations";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

jest.mock("../../services/tour/routing/autoRouteLegs", () => ({
  ...jest.requireActual<object>("../../services/tour/routing/autoRouteLegs"),
  autoRouteNewLegs: jest.fn(async () => undefined),
}));

/**
 * A roadtrip in a shared trip (forgejo#404, spec 2026-10-17 §6.8): the route
 * itself, its stations, its legs and the crossing linked to a leg reach every
 * member. Notes, odometer readings, expenses and tracks stay with their owner.
 */
describe("trip sharing — roadtrips", () => {
  jest.setTimeout(60_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;
  let routeId: string;

  const night = { kind: "free" as const };
  const station = (title: string, lon: number, extra: object = {}) => ({
    title,
    lat: 54 + lon / 10,
    lon,
    night,
    ...extra,
  });
  const bensRoute = () =>
    prisma.tripRoute.findFirst({
      where: { userId: ben.id, kind: "roadtrip" },
      include: {
        stops: { orderBy: { routeOrderIdx: "asc" } },
        legs: { include: { ferryJourney: { select: { shareKey: true } } } },
      },
    });
  const crossing = (userId: string) =>
    prisma.ferryJourney.create({
      data: {
        userId,
        tripId,
        operator: "Stena Line",
        depStationName: "Kiel",
        depLat: 54.3,
        depLon: 10.1,
        arrStationName: "Göteborg",
        arrLat: 57.7,
        arrLon: 11.9,
        departureTime: new Date("2026-06-01T16:45:00Z"),
      },
    });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-rt");
    ben = await makeAccount("ben-rt");
    tripId = (await prisma.trip.create({ data: { userId: anna.id, name: "Südschweden" } })).id;
    routeId = (
      await prisma.tripRoute.create({
        data: {
          userId: anna.id,
          tripId,
          kind: "roadtrip",
          name: "Rundreise",
          mode: "road",
          vehicle: "car",
          notes: "PRIVATE route note",
          startOdometerKm: 1000,
          endOdometerKm: 2000,
        },
      })
    ).id;
    await replaceStations(anna.id, routeId, [
      station("Kiel", 10, { notes: "PRIVATE station note" }),
      station("Hamburg", 11),
      station("Malmö", 12),
    ]);
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const share = async () => {
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
  };

  it("hands the member the route with its stations, legs and the ferry link — and no private field", async () => {
    const ferry = await crossing(anna.id);
    const leg = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    await prisma.ferryJourney.update({ where: { id: ferry.id }, data: { roadtripLegId: leg.id } });
    await share();

    const copy = await bensRoute();
    expect(copy).toMatchObject({ name: "Rundreise", vehicle: "car", notes: null });
    expect(copy?.startOdometerKm).toBeNull();
    expect(copy?.stops.map((s) => s.title)).toEqual(["Kiel", "Hamburg", "Malmö"]);
    expect(copy?.stops.every((s) => s.notes === null)).toBe(true);
    expect(copy?.legs).toHaveLength(2);
    const linked = copy?.legs.filter((l) => l.ferryJourney);
    expect(linked).toHaveLength(1);
    const bensFerry = await prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bensFerry.roadtripLegId).toBe(linked?.[0].id);
  });

  it("carries a station Anna adds later, and keeps the station note Ben wrote", async () => {
    await share();
    const before = await bensRoute();
    await prisma.tripStop.update({
      where: { id: before!.stops[1].id },
      data: { notes: "Ben's own note" },
    });
    const stations = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    await replaceStations(anna.id, routeId, [
      { ...station("Kiel", 10), id: stations[0].id },
      { ...station("Lübeck", 10.5) },
      { ...station("Hamburg", 11), id: stations[1].id },
      { ...station("Malmö", 12), id: stations[2].id },
    ]);
    const after = await bensRoute();
    expect(after?.stops.map((s) => s.title)).toEqual(["Kiel", "Lübeck", "Hamburg", "Malmö"]);
    expect(after?.stops.find((s) => s.title === "Hamburg")?.notes).toBe("Ben's own note");
    expect(after?.legs).toHaveLength(3);
    expect(after?.stops.map((s) => s.id)).toContain(before!.stops[1].id);
  });

  it("keeps a station Ben wrote on when Anna drops it, and removes the ones he left bare", async () => {
    await share();
    const before = await bensRoute();
    await prisma.tripStop.update({
      where: { id: before!.stops[2].id },
      data: { notes: "Ben was here" },
    });
    const stations = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    await replaceStations(anna.id, routeId, [{ ...station("Kiel", 10), id: stations[0].id }]);
    const after = await bensRoute();
    expect(after?.stops.map((s) => s.title)).toEqual(["Kiel", "Malmö"]);
    // It is no longer Anna's station: it left her key behind.
    expect(after?.stops[1].shareKey).not.toBe(before!.stops[2].shareKey);
  });

  it("a tour does not arrive as a roadtrip (a tour is its own type; sharing.tour.test.ts)", async () => {
    await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, kind: "tour", name: "Tagestour", mode: "foot" },
    });
    await share();
    // Ben has the roadtrip domain only: the tour is not handed to an account that cannot see tours.
    expect(await prisma.tripRoute.count({ where: { userId: ben.id, kind: "tour" } })).toBe(0);
    expect(await prisma.tripRoute.count({ where: { userId: ben.id, kind: "roadtrip" } })).toBe(1);
  });

  it("a member with the roadtrip domain switched off still receives the route (hidden, not refused)", async () => {
    await prisma.userSettings.upsert({
      where: { userId: ben.id },
      create: { userId: ben.id, data: {}, enabledDomains: ["flight"] },
      update: { enabledDomains: ["flight"] },
    });
    await share();
    expect((await bensRoute())?.stops).toHaveLength(3);
  });

  it("a ferry link the member cannot resolve leaves the route without it, not broken", async () => {
    const ferry = await crossing(anna.id);
    const leg = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    await prisma.ferryJourney.update({ where: { id: ferry.id }, data: { roadtripLegId: leg.id } });
    await share();
    // Ben removes his copy of the crossing; Anna edits the route afterwards.
    await prisma.ferryJourney.deleteMany({ where: { userId: ben.id } });
    const stations = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    await replaceStations(
      anna.id,
      routeId,
      stations.map((s, i) => ({ ...station(s.title, 10 + i, { notes: null }), id: s.id }))
    );
    const copy = await bensRoute();
    expect(copy?.stops).toHaveLength(3);
    expect(copy?.legs.every((l) => l.ferryJourney === null)).toBe(true);
  });

  it("Anna's later change to a leg reaches Ben's copy as a notice", async () => {
    await share();
    const leg = await prisma.tripRouteLeg.findFirstOrThrow({
      where: { routeId },
      orderBy: { distanceKm: "asc" },
    });
    const { propagateWrite, shareSnapshot } = await import("../../services/sharing/propagate");
    const snapshot = await shareSnapshot(prisma, "roadtrip", routeId);
    await prisma.tripRouteLeg.update({ where: { id: leg.id }, data: { distanceKm: 123.4 } });
    await propagateWrite(prisma, anna.id, "roadtrip", routeId, snapshot);
    const copy = await bensRoute();
    expect(copy?.legs.map((l) => l.distanceKm)).toContain(123.4);
    expect(
      await prisma.shareNotice.count({
        where: { userId: ben.id, entityType: "roadtrip", kind: "updated" },
      })
    ).toBe(1);
  });
});
