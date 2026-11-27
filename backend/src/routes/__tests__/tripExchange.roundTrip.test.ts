import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "crypto";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { replaceStations } from "../../services/roadtrip/replaceStations";
import { tripRows } from "../../services/sharing/linkPreview";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import {
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

jest.mock("../../services/tour/routing/autoRouteLegs", () => ({
  ...jest.requireActual<object>("../../services/tour/routing/autoRouteLegs"),
  autoRouteNewLegs: jest.fn(async () => undefined),
}));

/**
 * UAT 2026-11-27: a `.travstats` export and import dropped ferry and cruise lines, roadtrip
 * stations, gate and terminal, and a stop. The round trip is judged by the share facts — the
 * whitelist that says what an entry IS (`services/sharing/facts`): every entry of every type must
 * arrive with the same facts. Only references that name ids of the other account differ.
 */
const LINE = Array.from({ length: 30 }, (_, i) => [10 + i * 0.05, 54 + i * 0.1]);
const portIds: number[] = [];

/** Facts that legitimately differ between two accounts: ids of rows and of the catalogue. */
const ID_FACTS = new Set(["sourceRef", "lodgingStayRef", "status"]);

function comparable(rows: Awaited<ReturnType<typeof tripRows>>) {
  return rows
    .map((r) => ({
      entity: r.entity,
      facts: Object.fromEntries(Object.entries(r.row.facts).filter(([k]) => !ID_FACTS.has(k))),
    }))
    .sort((a, b) =>
      `${a.entity}${JSON.stringify(a.facts)}`.localeCompare(`${b.entity}${JSON.stringify(b.facts)}`)
    );
}

describe("a trip file round-trips completely (UAT 2026-11-27)", () => {
  jest.setTimeout(90_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  beforeAll(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-rt");
    ben = await makeAccount("ben-rt");
    const full = await makeFullTrip(anna);
    tripId = full.trip.id;
    await prisma.flight.update({
      where: { id: full.flight.id },
      data: { gate: "B12", terminal: "1" },
    });
    await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        operator: "Color Line",
        depStationName: "Kiel",
        depLat: 54.32,
        depLon: 10.14,
        depTimezone: "Europe/Berlin",
        arrStationName: "Oslo",
        arrLat: 59.9,
        arrLon: 10.74,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2025-05-02T12:00:00Z"),
        arrivalTime: new Date("2025-05-03T08:00:00Z"),
        geometry: LINE,
        geometrySource: "manual",
        manualScope: "pair",
      },
    });
    const tag = randomUUID().slice(0, 5).toUpperCase();
    const from = await prisma.port.create({
      data: { name: "Kiel", unlocode: `DE${tag.slice(0, 3)}`, country: "DE", lat: 54, lon: 10 },
    });
    const to = await prisma.port.create({
      data: { name: "Oslo", unlocode: `NO${tag.slice(0, 3)}`, country: "NO", lat: 56, lon: 12 },
    });
    portIds.push(from.id, to.id);
    const cruise = await prisma.cruise.create({
      data: {
        userId: anna.id,
        tripId,
        shipNameOverride: "Color Fantasy",
        departurePortId: from.id,
        arrivalPortId: to.id,
        startDay: new Date("2025-05-04T00:00:00Z"),
        endDay: new Date("2025-05-05T00:00:00Z"),
        stops: {
          create: [
            { dayNumber: 1, portId: from.id, position: 0 },
            { dayNumber: 2, portId: to.id, position: 1 },
          ],
        },
        legs: {
          create: [
            {
              ordinal: 0,
              fromPortId: from.id,
              toPortId: to.id,
              distanceKm: 400,
              method: "manual",
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
        fromRef: String(from.id),
        toKind: "port",
        toRef: String(to.id),
        waypoints: [
          [10, 54],
          [11, 55],
          [12, 56],
        ],
      },
    });
    const route = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId, kind: "roadtrip", name: "Rundreise", mode: "road" },
    });
    await replaceStations(anna.id, route.id, [
      { title: "Kiel", lat: 54.3, lon: 10.1, night: { kind: "free" } },
      { title: "Aarhus", lat: 56.15, lon: 10.2, night: { kind: "pass" } },
      { title: "Malmö", lat: 55.6, lon: 13, night: { kind: "free" } },
    ]);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.$disconnect();
  });

  it("every entry arrives with every fact: lines, stations, gate, terminal, stops", async () => {
    // Version 6: the file names what an older reader could not take.
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/export?private=1`)
      .set("Cookie", anna.cookie)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });
    const archive = readTripArchive(res.body as Buffer);
    expect(archive.manifest.formatVersion).toBe(6);
    const { tripId: imported } = await commitTripFile(ben.id, archive);

    const before = comparable(await prisma.$transaction((tx) => tripRows(tx, anna.id, tripId)));
    const after = comparable(
      await prisma.$transaction((tx) => tripRows(tx, ben.id, imported as string))
    );
    expect(after.map((r) => r.entity)).toEqual(before.map((r) => r.entity));
    for (let i = 0; i < before.length; i++) expect(after[i]).toEqual(before[i]);
  });
});
