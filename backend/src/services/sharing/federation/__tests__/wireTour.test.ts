import { afterAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "crypto";

import { prisma } from "../../../../db";
import { ADAPTERS } from "../../adapters";
import { fromWireEntries } from "../wire/decode";
import { toWireEntries } from "../wire/encode";
import { wireEntrySchema } from "../wire/shapes";

/**
 * A tour on the trip-share wire (tours-own-domain T1b): stops, legs and recorded tracks travel; the
 * source record's own id and every private column do not, and a track whose line did not fit the
 * wire is not turned into an empty track on the receiving side.
 */
describe("the wire — a tour", () => {
  const users: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("carries tracks without their external reference, and reads back what it sent", async () => {
    const u = await prisma.user.create({
      data: { username: `wire-tour-${randomUUID().slice(0, 8)}`, passwordHash: "x" },
    });
    users.push(u.id);
    const route = await prisma.tripRoute.create({
      data: {
        userId: u.id,
        kind: "tour",
        name: "Brocken",
        mode: "foot",
        activity: "hike",
        shareKey: randomUUID(),
        notes: "NOTE-PRIVATE",
        tags: ["TAG-PRIVATE"],
      },
    });
    await prisma.tripRouteTrack.create({
      data: {
        routeId: route.id,
        source: "strava",
        externalRef: "strava:EXTERNAL-ID",
        name: "Morgenlauf",
        startedAt: new Date("2030-06-01T08:00:00Z"),
        endedAt: new Date("2030-06-01T09:00:00Z"),
        geometry: [
          [10, 54],
          [10.1, 54.1],
        ],
        pointCount: 2,
        distanceKm: 14.2,
        ascentM: 80,
      },
    });
    const rows = await ADAPTERS.tour.load(prisma, [route.id]);
    const [entry] = await toWireEntries(prisma, "tour", rows);
    const json = JSON.stringify(entry);
    expect(json).not.toContain("EXTERNAL-ID");
    expect(json).not.toContain("PRIVATE");

    const parsed = wireEntrySchema.parse(entry);
    const [{ row }] = await fromWireEntries(prisma, [parsed as never]);
    const tracks = row.facts.tracks as { name: string; distanceKm: number; geometry: unknown }[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ name: "Morgenlauf", distanceKm: 14.2 });
    expect(row.facts).toMatchObject({ name: "Brocken", activity: "hike" });
  });

  it("drops a track whose line did not fit the wire rather than copying an empty one", async () => {
    const parsed = wireEntrySchema.parse({
      entity: "tour",
      shareKey: randomUUID(),
      facts: {
        name: "Lang",
        mode: "foot",
        orderIdx: 0,
        activity: null,
        tourDate: null,
        tourStartMinute: null,
        stations: [],
        routeLegs: [],
        tracks: [
          {
            key: "gpx|1|2",
            source: "gpx",
            name: null,
            startedAt: "2030-06-01T08:00:00.000Z",
            endedAt: "2030-06-01T09:00:00.000Z",
            geometry: null,
            segmentStarts: null,
            cumulativeKm: null,
            pointCount: 9000,
            jitterDropped: null,
            distanceKm: 40,
            truncated: false,
            elevations: null,
            ascentM: null,
            descentM: null,
            movingSeconds: null,
          },
        ],
      },
    });
    const [{ row }] = await fromWireEntries(prisma, [parsed as never]);
    expect(row.facts.tracks).toEqual([]);
  });
});
