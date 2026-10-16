import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { propagateWrite } from "../../services/sharing/propagate";
import { SHARE_ENTITIES, SHARE_TYPES } from "../../services/sharing/shareTypes";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * One copy path (spec 2026-10-16, D3): sharing a trip and propagating a new
 * entry both go through `copyInto`, so both join the recipient's own logged
 * flight instead of copying a duplicate — and neither joins a different one.
 */
describe("trip sharing — one copy path", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-copy");
    ben = await makeAccount("ben-copy");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("counts what it created per registered type", async () => {
    const full = await makeFullTrip(anna);
    const companion = await linkWithConsent(anna, ben);
    const result = await shareTrip(anna.id, full.trip.id, companion.id);
    expect(Object.keys(result.created).sort()).toEqual(
      SHARE_ENTITIES.map((e) => SHARE_TYPES[e].countKey).sort()
    );
    expect(result.created.flights).toBe(1);
    expect(result.created.stops).toBe(2);
  });

  it("joins the recipient's own logged flight when a new one is added to the shared trip", async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    const bensOwn = await prisma.flight.create({
      data: {
        userId: ben.id,
        flightNumber: "TP 0576",
        depIata: "LIS",
        arrIata: "FRA",
        depLat: 38.7742,
        depLon: -9.1342,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2025-05-08T18:00:00.000Z"),
        depTimezone: "Europe/Lisbon",
        seatNumber: "BEN-SEAT",
      },
    });
    const annas = await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        depLat: 38.7742,
        depLon: -9.1342,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2025-05-08T18:00:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    await propagateWrite(prisma, anna.id, "flight", annas.id);

    const keyed = await prisma.flight.findUniqueOrThrow({ where: { id: annas.id } });
    const joined = await prisma.flight.findUniqueOrThrow({ where: { id: bensOwn.id } });
    expect(joined.shareKey).toBe(keyed.shareKey);
    expect(joined.tripId).toBe(memberTrip.id);
    expect(joined.seatNumber).toBe("BEN-SEAT");
    expect(
      await prisma.flight.count({ where: { userId: ben.id, flightNumber: { contains: "576" } } })
    ).toBe(1);
    const notice = await prisma.shareNotice.findFirstOrThrow({
      where: { userId: ben.id, kind: "created", entityType: "flight" },
    });
    expect((notice.after as { joined?: boolean }).joined).toBe(true);
  });

  it("does not join the recipient's same flight number on the next local day", async () => {
    const { full } = await sharedPair(anna, ben);
    // Anna's departs 23:30 in Lisbon on the 8th (22:30Z); Ben's 00:30 local on the 9th.
    await prisma.flight.create({
      data: {
        userId: ben.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        depLat: 38.7742,
        depLon: -9.1342,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2025-05-08T23:30:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    const annas = await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        depLat: 38.7742,
        depLon: -9.1342,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2025-05-08T22:30:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    await propagateWrite(prisma, anna.id, "flight", annas.id);
    expect(await prisma.flight.count({ where: { userId: ben.id, flightNumber: "TP576" } })).toBe(2);
  });
});
