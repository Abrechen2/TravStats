import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "crypto";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import {
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Sharing UAT 2 (2026-11-27): the owner's Nile cruise calls at catalogue ports without a UN/LOCODE
 * (Esna, Edfu, Kom Ombo). Imported from a `.travstats` file into another account, the import
 * matched ports by code only: six stops arrived unresolved and ten of eleven legs with them were
 * dropped, although the receiving catalogue holds the very same ports.
 */
describe("a trip file keeps catalogue ports that have no UN/LOCODE", () => {
  jest.setTimeout(60_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;
  const portIds: number[] = [];

  beforeAll(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-up");
    ben = await makeAccount("ben-up");
    tripId = (await makeFullTrip(anna)).trip.id;
    const tag = randomUUID().slice(0, 6);
    const esna = await prisma.port.create({
      data: { name: `Esna ${tag}`, unlocode: null, country: "Egypt", lat: 25.2933, lon: 32.5536 },
    });
    const edfu = await prisma.port.create({
      data: { name: `Edfu ${tag}`, unlocode: null, country: "Egypt", lat: 24.9781, lon: 32.8731 },
    });
    portIds.push(esna.id, edfu.id);
    const cruise = await prisma.cruise.create({
      data: {
        userId: anna.id,
        tripId,
        shipNameOverride: "MS Solaris II",
        departurePortId: esna.id,
        arrivalPortId: edfu.id,
        startDay: new Date("2025-05-04T00:00:00Z"),
        endDay: new Date("2025-05-05T00:00:00Z"),
        stops: {
          create: [
            { dayNumber: 1, portId: esna.id, position: 0 },
            { dayNumber: 2, portId: edfu.id, position: 1 },
          ],
        },
        legs: {
          create: [
            {
              ordinal: 0,
              fromPortId: esna.id,
              toPortId: edfu.id,
              distanceKm: 60,
              method: "river-osm",
              routerVersion: "t",
            },
          ],
        },
      },
    });
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId: cruise.id,
        fromKind: "port",
        fromRef: String(esna.id),
        toKind: "port",
        toRef: String(edfu.id),
        waypoints: [
          [32.5536, 25.2933],
          [32.7, 25.1],
          [32.8731, 24.9781],
        ],
      },
    });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.$disconnect();
  });

  it("matches the ports by name, country and place, and keeps the legs and the line", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/export`)
      .set("Cookie", anna.cookie)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });
    const { tripId: imported } = await commitTripFile(ben.id, readTripArchive(res.body as Buffer));

    const cruise = await prisma.cruise.findFirstOrThrow({
      where: { userId: ben.id, tripId: imported as string, shipNameOverride: "MS Solaris II" },
      include: { stops: { orderBy: { position: "asc" } }, legs: true, legRoutes: true },
    });
    expect(cruise.stops.map((s) => [s.portId, s.unresolvedPortName])).toEqual([
      [portIds[0], null],
      [portIds[1], null],
    ]);
    expect([cruise.departurePortId, cruise.arrivalPortId]).toEqual(portIds);
    expect(cruise.legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([[portIds[0], portIds[1]]]);
    expect(cruise.legRoutes).toHaveLength(1);
  });
});
