import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
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
 * A tour on a shared trip (tours-own-domain T1b, Decision 4): its stations, legs AND recorded
 * tracks reach every member who can see tours; notes, tags, odometer, expenses, the source
 * record's own id and everything of the trip around it stay with the owner. A roadtrip is a
 * second type over the same table and must neither follow nor be followed by a tour.
 */
describe("trip sharing — tours", () => {
  jest.setTimeout(60_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;
  let tourId: string;
  let betaBefore: boolean;

  const line = [
    [10, 54],
    [10.2, 54.1],
    [10.4, 54.2],
  ];
  const track = (routeId: string, startHour: number, externalRef: string | null = null) =>
    prisma.tripRouteTrack.create({
      data: {
        routeId,
        source: externalRef ? "strava" : "gpx",
        name: `Lauf ${startHour}`,
        startedAt: new Date(Date.UTC(2026, 5, 1, startHour)),
        endedAt: new Date(Date.UTC(2026, 5, 1, startHour + 1)),
        geometry: line,
        cumulativeKm: [0, 15, 30],
        pointCount: 3,
        distanceKm: 30,
        ascentM: 120,
        externalRef,
      },
    });
  const bensRoutes = (kind: string) =>
    prisma.tripRoute.findMany({
      where: { userId: ben.id, kind },
      include: {
        stops: { orderBy: { routeOrderIdx: "asc" } },
        legs: true,
        tracks: { orderBy: { startedAt: "asc" } },
      },
    });
  const share = async () => {
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
  };
  const change = async (entity: "tour" | "roadtrip", write: () => Promise<unknown>) => {
    const before = await shareSnapshot(prisma, entity, tourId);
    await write();
    await propagateWrite(prisma, anna.id, entity, tourId, before);
  };

  beforeEach(async () => {
    await wipeShareTestAccounts();
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    anna = await makeAccount("anna-tour");
    ben = await makeAccount("ben-tour");
    for (const u of [anna, ben]) {
      await prisma.userSettings.upsert({
        where: { userId: u.id },
        create: { userId: u.id, data: {}, enabledDomains: ["flight", "tour", "roadtrip"] },
        update: { enabledDomains: ["flight", "tour", "roadtrip"] },
      });
    }
    tripId = (await prisma.trip.create({ data: { userId: anna.id, name: "Harz" } })).id;
    tourId = (
      await prisma.tripRoute.create({
        data: {
          userId: anna.id,
          tripId,
          kind: "tour",
          name: "Brocken",
          mode: "foot",
          activity: "hike",
          notes: "PRIVATE tour note",
          tags: ["PRIVATE"],
          startOdometerKm: 5,
        },
      })
    ).id;
    const a = await prisma.tripStop.create({
      data: {
        routeId: tourId,
        tripId: null,
        title: "Start",
        lat: 51.8,
        lon: 10.6,
        routeOrderIdx: 0,
        notes: "PRIVATE stop note",
      },
    });
    const b = await prisma.tripStop.create({
      data: {
        routeId: tourId,
        tripId: null,
        title: "Gipfel",
        lat: 51.8,
        lon: 10.62,
        routeOrderIdx: 1,
      },
    });
    await prisma.tripRouteLeg.create({
      data: {
        routeId: tourId,
        fromStopId: a.id,
        toStopId: b.id,
        distanceKm: 8,
        source: "straight",
        mode: "foot",
      },
    });
    await track(tourId, 8, "strava:98765");
    await track(tourId, 12);
    await prisma.tripExpense.create({
      data: {
        userId: anna.id,
        routeId: tourId,
        kind: "other",
        amount: 12,
        currency: "EUR",
        note: "PRIVATE",
      },
    });
  });
  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("hands the member the tour with stops, legs and tracks — and no id of the source, no private field", async () => {
    await share();
    const [copy] = await bensRoutes("tour");
    expect(copy).toMatchObject({ name: "Brocken", activity: "hike", notes: null, tags: [] });
    expect(copy.startOdometerKm).toBeNull();
    expect(copy.stops.map((s) => s.title)).toEqual(["Start", "Gipfel"]);
    expect(copy.stops.every((s) => s.notes === null)).toBe(true);
    expect(copy.legs).toHaveLength(1);
    expect(copy.tracks).toHaveLength(2);
    expect(copy.tracks.map((t) => t.externalRef)).toEqual([null, null]);
    expect(copy.tracks[0]).toMatchObject({ source: "strava", pointCount: 3, distanceKm: 30 });
    expect(copy.tracks[0].geometry).toEqual(line);
    expect(await prisma.tripExpense.count({ where: { route: { userId: ben.id } } })).toBe(0);
    // It is a tour of its own type: no roadtrip came with it.
    expect(await bensRoutes("roadtrip")).toHaveLength(0);
  });

  it("carries a track Anna records later, and drops one she deletes", async () => {
    await share();
    await change("tour", () => track(tourId, 16));
    expect((await bensRoutes("tour"))[0].tracks).toHaveLength(3);
    const gone = await prisma.tripRouteTrack.findFirstOrThrow({
      where: { routeId: tourId, source: "gpx", startedAt: new Date(Date.UTC(2026, 5, 1, 12)) },
    });
    await change("tour", () => prisma.tripRouteTrack.delete({ where: { id: gone.id } }));
    const tracks = (await bensRoutes("tour"))[0].tracks;
    expect(tracks.map((t) => t.name)).toEqual(["Lauf 8", "Lauf 16"]);
  });

  it("a track deleted through the API leaves the member's copy too, and one stored twice is one track", async () => {
    await track(tourId, 12);
    await share();
    expect((await bensRoutes("tour"))[0].tracks).toHaveLength(2);
    const gone = await prisma.tripRouteTrack.findFirstOrThrow({
      where: { routeId: tourId, name: "Lauf 8" },
    });
    await request(app)
      .delete(`/api/v1/tours/${tourId}/tracks/${gone.id}`)
      .set("Cookie", anna.cookie)
      .expect(204);
    expect((await bensRoutes("tour"))[0].tracks.map((t) => t.name)).toEqual(["Lauf 12"]);
  });

  it("keeps a track Ben recorded himself when Anna changes another one", async () => {
    await share();
    const mine = await bensRoutes("tour");
    await prisma.tripRouteTrack.create({
      data: {
        routeId: mine[0].id,
        source: "gpx",
        name: "Bens Lauf",
        startedAt: new Date(Date.UTC(2026, 5, 2, 8)),
        endedAt: new Date(Date.UTC(2026, 5, 2, 9)),
        geometry: line,
        pointCount: 3,
        distanceKm: 1,
      },
    });
    await change("tour", () => track(tourId, 18));
    const names = (await bensRoutes("tour"))[0].tracks.map((t) => t.name);
    expect(names).toContain("Bens Lauf");
    expect(names).toContain("Lauf 18");
  });

  it("a roadtrip share is unchanged by a tour on the same trip, and the two do not mix", async () => {
    await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, kind: "roadtrip", name: "Rundreise", mode: "road" },
    });
    await share();
    expect((await bensRoutes("roadtrip")).map((r) => r.name)).toEqual(["Rundreise"]);
    expect((await bensRoutes("tour")).map((r) => r.name)).toEqual(["Brocken"]);
    const keys = await prisma.tripRoute.findMany({
      where: { userId: anna.id },
      select: { kind: true, shareKey: true },
    });
    expect(keys.every((k) => k.shareKey !== null)).toBe(true);
    expect(new Set(keys.map((k) => k.shareKey)).size).toBe(2);
  });

  const switchKind = (body: object) =>
    request(app).patch(`/api/v1/tours/${tourId}/kind`).set("Cookie", anna.cookie).send(body);

  it("a tour switched to a roadtrip ends the members' tour entry and shares a roadtrip afresh — no cross-propagation", async () => {
    await share();
    const oldKey = (await prisma.tripRoute.findUniqueOrThrow({ where: { id: tourId } })).shareKey;
    await switchKind({ kind: "roadtrip", vehicle: "car" }).expect(200);

    // Ben keeps his tour copy (told it was removed) and gets a roadtrip copy under a new key.
    expect(await bensRoutes("tour")).toHaveLength(1);
    expect(await bensRoutes("roadtrip")).toHaveLength(1);
    expect(
      await prisma.shareNotice.count({
        where: { userId: ben.id, entityType: "tour", kind: "deleted", entityKey: oldKey! },
      })
    ).toBe(1);
    const newKey = (await prisma.tripRoute.findUniqueOrThrow({ where: { id: tourId } })).shareKey;
    expect(newKey).not.toBe(oldKey);

    // A later change to Anna's roadtrip reaches Ben's roadtrip copy and leaves his tour copy alone.
    await change("roadtrip", () =>
      prisma.tripRoute.update({ where: { id: tourId }, data: { name: "Brocken-Rundreise" } })
    );
    expect((await bensRoutes("roadtrip"))[0].name).toBe("Brocken-Rundreise");
    expect((await bensRoutes("tour"))[0].name).toBe("Brocken");
  });

  it("a roadtrip switched to a tour does the same the other way round", async () => {
    await switchKind({ kind: "roadtrip", vehicle: "car" }).expect(200);
    await share();
    expect(await bensRoutes("tour")).toHaveLength(0);
    await switchKind({ kind: "tour", activity: "hike" }).expect(200);
    expect(await bensRoutes("roadtrip")).toHaveLength(1);
    expect(await bensRoutes("tour")).toHaveLength(1);
    await change("tour", () =>
      prisma.tripRoute.update({ where: { id: tourId }, data: { name: "Brocken-Tour" } })
    );
    expect((await bensRoutes("tour"))[0].name).toBe("Brocken-Tour");
    expect((await bensRoutes("roadtrip"))[0].name).toBe("Brocken");
  });

  it("a member who cannot see tours is not handed one (domain off), the roadtrip still arrives", async () => {
    await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, kind: "roadtrip", name: "Rundreise", mode: "road" },
    });
    await prisma.userSettings.update({
      where: { userId: ben.id },
      data: { enabledDomains: ["flight", "roadtrip"] },
    });
    await share();
    expect(await bensRoutes("tour")).toHaveLength(0);
    expect(await bensRoutes("roadtrip")).toHaveLength(1);
  });

  it("a member on an instance with the beta switch off is not handed a tour", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    await share();
    expect(await bensRoutes("tour")).toHaveLength(0);
  });

  it("a standalone tour is never shared", async () => {
    const own = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId: null, kind: "tour", name: "Solo", mode: "foot" },
    });
    await share();
    expect(
      (await prisma.tripRoute.findUniqueOrThrow({ where: { id: own.id } })).shareKey
    ).toBeNull();
    expect((await bensRoutes("tour")).map((r) => r.name)).toEqual(["Brocken"]);
  });
});
