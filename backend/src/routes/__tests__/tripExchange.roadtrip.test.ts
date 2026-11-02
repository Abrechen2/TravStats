import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { replaceStations } from "../../services/roadtrip/replaceStations";
import { shareTrip } from "../../services/sharing/shareTrip";
import { commitTripFile } from "../../services/trip/exchange/commit";
import {
  TRIP_FILE_SUPPORTED_VERSIONS,
  tripFileSchema,
  tripFileVersionFor,
} from "../../services/trip/exchange/format";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
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
 * Exchange format version 4 (forgejo#404, spec §6.8): the file carries the
 * trip's roadtrips with their stations, legs and the crossing linked to a leg.
 * Version 3 files keep importing; a file without roadtrips is still stamped
 * with the lowest version that carries it, so an older importer reads it.
 */
describe("trip file — roadtrips (format version 4)", () => {
  jest.setTimeout(60_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let carl: TestAccount;
  let tripId: string;

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };
  const archiveOfAnna = async (query = "private=1") => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/export?${query}`)
      .set("Cookie", anna.cookie)
      .buffer(true)
      .parse(binary);
    return readTripArchive(res.body as Buffer);
  };
  const routeOf = (userId: string) =>
    prisma.tripRoute.findFirst({
      where: { userId, kind: "roadtrip" },
      include: {
        stops: { orderBy: { routeOrderIdx: "asc" } },
        legs: { include: { ferryJourney: { select: { id: true } } } },
      },
    });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xrt");
    ben = await makeAccount("ben-xrt");
    carl = await makeAccount("carl-xrt");
    tripId = (
      await prisma.trip.create({
        data: { userId: anna.id, name: "Südschweden", startDate: new Date("2026-06-01T00:00:00Z") },
      })
    ).id;
    const route = await prisma.tripRoute.create({
      data: {
        userId: anna.id,
        tripId,
        kind: "roadtrip",
        name: "Rundreise",
        mode: "road",
        notes: "PRIVATE route note",
        startOdometerKm: 10,
      },
    });
    await replaceStations(anna.id, route.id, [
      { title: "Kiel", lat: 54.3, lon: 10.1, night: { kind: "free" }, notes: "PRIVATE stop" },
      { title: "Malmö", lat: 55.6, lon: 13, night: { kind: "pass" } },
    ]);
    const ferry = await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        depStationName: "Kiel",
        depLat: 54.3,
        depLon: 10.1,
        arrStationName: "Göteborg",
        arrLat: 57.7,
        arrLon: 11.9,
        departureTime: new Date("2026-06-01T16:45:00Z"),
      },
    });
    const leg = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId: route.id } });
    await prisma.ferryJourney.update({ where: { id: ferry.id }, data: { roadtripLegId: leg.id } });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("writes version 4 with the route, and its private fields only when asked", async () => {
    const priv = await archiveOfAnna("private=1");
    expect(priv.manifest.formatVersion).toBe(4);
    const [road] = priv.file.roadtrips;
    expect(road).toMatchObject({ name: "Rundreise", private: { notes: "PRIVATE route note" } });
    expect(road.stations.map((s) => s.title)).toEqual(["Kiel", "Malmö"]);
    expect(road.stations[0].private?.notes).toBe("PRIVATE stop");
    expect(road.legs).toHaveLength(1);
    expect(road.legs[0].ferryKey).not.toBeNull();

    const shared = await archiveOfAnna("private=0");
    expect(shared.file.roadtrips[0].private).toBeUndefined();
    expect(JSON.stringify(shared.file)).not.toContain("PRIVATE");
  });

  it("imports the route with its stations, legs and ferry link, once", async () => {
    const archive = await archiveOfAnna();
    await commitTripFile(ben.id, archive);
    const mine = await routeOf(ben.id);
    expect(mine?.stops.map((s) => s.title)).toEqual(["Kiel", "Malmö"]);
    expect(mine?.legs).toHaveLength(1);
    expect(mine?.legs[0].ferryJourney).not.toBeNull();
    expect(mine?.notes).toBe("PRIVATE route note");

    // Into the same trip again: the roadtrip of that name is already there.
    const tripOfBen = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    await commitTripFile(ben.id, archive, { tripName: tripOfBen.name });
    expect(await prisma.tripRoute.count({ where: { userId: ben.id, kind: "roadtrip" } })).toBe(1);
  });

  it("copies an imported roadtrip to the members of a shared trip", async () => {
    const carlsTrip = await prisma.trip.create({
      data: { userId: carl.id, name: "Südschweden", startDate: new Date("2026-06-01T00:00:00Z") },
    });
    const companion = await linkWithConsent(carl, ben);
    await shareTrip(carl.id, carlsTrip.id, companion.id);
    await commitTripFile(carl.id, await archiveOfAnna());
    const theirs = await routeOf(ben.id);
    expect(theirs?.stops.map((s) => s.title)).toEqual(["Kiel", "Malmö"]);
    expect(theirs?.notes).toBeNull();
    expect(theirs?.legs[0].ferryJourney).not.toBeNull();
  });

  it("stamps a trip without roadtrips with the lowest version, so a v3 reader still takes it", () => {
    expect(tripFileVersionFor({ ferry: [1], roadtrips: [] })).toBe(3);
    expect(tripFileVersionFor({ ferry: [1], roadtrips: [1] })).toBe(4);
    // What a v3 importer's list lacks is refused by name, not read half-way.
    expect(TRIP_FILE_SUPPORTED_VERSIONS.filter((v) => v <= 3)).toEqual([1, 2, 3]);
  });

  it("reads a version 3 file that has no roadtrips key", async () => {
    const { file } = await archiveOfAnna();
    const { roadtrips: _dropped, ...v3 } = file;
    const parsed = tripFileSchema.parse(v3);
    expect(parsed.roadtrips).toEqual([]);
  });

  it("refuses a leg that names a station or crossing the file does not hold", async () => {
    const { file } = await archiveOfAnna();
    const broken = {
      ...file,
      roadtrips: file.roadtrips.map((r) => ({
        ...r,
        legs: r.legs.map((l) => ({ ...l, ferryKey: "fe999" })),
      })),
    };
    expect(tripFileSchema.safeParse(broken).success).toBe(false);
  });
});
