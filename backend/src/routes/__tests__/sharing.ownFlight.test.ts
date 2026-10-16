import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A companion has often logged the flight they took together already. Sharing
 * the trip then created a second row of the same flight in their account —
 * counted twice in every statistic. The share now joins the recipient's own
 * row (same flight number, same local departure day, same route) instead.
 */
describe("sharing — a flight the recipient already logged is joined, not copied", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;
  let companionId: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    full = await makeFullTrip(anna);
    companionId = (await linkWithConsent(anna, ben)).id;
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bensFlight = (departureTime: Date, flightNumber = "TP 571") =>
    prisma.flight.create({
      data: {
        userId: ben.id,
        flightNumber,
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 38.7742,
        arrLon: -9.1342,
        departureTime,
        depTimezone: "Europe/Berlin",
        status: "flown",
        seatNumber: "14C",
      },
    });

  it("attaches the share key to Ben's own TP571 and keeps his seat", async () => {
    // 07:30 in Frankfurt on 1 May — Anna's row says 10:00 local (08:00Z).
    const own = await bensFlight(new Date("2025-05-01T05:30:00.000Z"));
    const result = await shareTrip(anna.id, full.trip.id, companionId);

    expect(result.created.flights).toBe(0);
    const flights = await prisma.flight.findMany({ where: { userId: ben.id } });
    expect(flights).toHaveLength(1);
    const annas = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(flights[0].id).toBe(own.id);
    expect(flights[0].shareKey).toBe(annas.shareKey);
    expect(flights[0].seatNumber).toBe("14C");
    const bensTrip = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    expect(flights[0].tripId).toBe(bensTrip.id);

    // Sharing again finds it by key and creates nothing.
    const again = await shareTrip(anna.id, full.trip.id, companionId);
    expect(again.created.flights).toBe(0);
    expect(await prisma.flight.count({ where: { userId: ben.id } })).toBe(1);
  });

  it("copies when the day differs — a flight number repeats every day", async () => {
    await bensFlight(new Date("2025-05-02T08:00:00.000Z"));
    const result = await shareTrip(anna.id, full.trip.id, companionId);
    expect(result.created.flights).toBe(1);
    expect(await prisma.flight.count({ where: { userId: ben.id } })).toBe(2);
  });
});
