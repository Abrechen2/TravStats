import { afterAll, afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import { propagateWrite, shareSnapshot } from "../../services/sharing/propagate";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A copy's status is derived for its RECIPIENT (spec 2026-10-16, D4). A stay's
 * status is a day question answered on the user's own calendar (ADR 0002 D4,
 * `stayWrites.ts`); the copy path answered it on the server's clock.
 */
describe("trip sharing — derived columns of a copy", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-derive");
    ben = await makeAccount("ben-derive");
    await prisma.userSettings.create({
      data: { userId: ben.id, data: { display: { timezone: "Pacific/Kiritimati" } } },
    });
    // 12:00Z on the 9th: still the 9th in UTC, already 02:00 on the 10th in Kiritimati (UTC+14).
    setClockForTests("2026-03-09T12:00:00.000Z");
  });
  afterEach(() => setClockForTests(null));
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("completes a copied stay on the recipient's calendar", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Kiribati" } });
    const lodging = await prisma.lodging.create({
      data: { userId: anna.id, name: "Ocean Lodge", city: "London", country: "KI" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: anna.id,
        tripId: trip.id,
        lodgingId: lodging.id,
        checkIn: day("2026-03-05"),
        checkOut: day("2026-03-10"),
        checkInDate: day("2026-03-05"),
        checkOutDate: day("2026-03-10"),
        status: "in_progress",
      },
    });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, trip.id, companion.id);

    const bens = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bens.status).toBe("completed");
    const annas = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: anna.id } });
    expect(annas.status).toBe("in_progress");
  });
  /** Anna's trip with one stay (5th to `checkOut`), shared with Ben. */
  async function sharedStay(checkOut: string) {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Kiribati" } });
    const lodging = await prisma.lodging.create({
      data: { userId: anna.id, name: "Ocean Lodge", city: "London", country: "KI" },
    });
    const stay = await prisma.lodgingStay.create({
      data: {
        userId: anna.id,
        tripId: trip.id,
        lodgingId: lodging.id,
        checkIn: day("2026-03-05"),
        checkOut: day(checkOut),
        checkInDate: day("2026-03-05"),
        checkOutDate: day(checkOut),
        status: "in_progress",
      },
    });
    await shareTrip(anna.id, trip.id, (await linkWithConsent(anna, ben)).id);
    return stay;
  }

  /** What a write path does: snapshot, write, propagate. */
  async function annaMovesCheckOut(stayId: string, checkOut: string) {
    const before = await shareSnapshot(prisma, "lodgingStay", stayId);
    await prisma.lodgingStay.update({
      where: { id: stayId },
      data: { checkOut: day(checkOut), checkOutDate: day(checkOut) },
    });
    await propagateWrite(prisma, anna.id, "lodgingStay", stayId, before);
  }

  it("re-derives a propagated stay change on the recipient's calendar", async () => {
    const stay = await sharedStay("2026-03-12");
    expect((await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } })).status).toBe(
      "in_progress"
    );

    await annaMovesCheckOut(stay.id, "2026-03-10");

    const bens = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bens.checkOut).toEqual(day("2026-03-10"));
    expect(bens.status).toBe("completed");
  });

  it("keeps a cancelled copy cancelled when a stay change propagates", async () => {
    const stay = await sharedStay("2026-03-12");
    await prisma.lodgingStay.updateMany({
      where: { userId: ben.id },
      data: { status: "cancelled" },
    });

    await annaMovesCheckOut(stay.id, "2026-03-10");

    const bens = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bens.checkOut).toEqual(day("2026-03-10"));
    expect(bens.status).toBe("cancelled");
  });

  it("keeps a cancelled copy cancelled when a flight change propagates", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Flights" } });
    const flight = await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: trip.id,
        flightNumber: "TP576",
        depIata: "LIS",
        arrIata: "FRA",
        depLat: 38.7742,
        depLon: -9.1342,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2026-03-01T18:00:00.000Z"),
        depTimezone: "Europe/Lisbon",
      },
    });
    await shareTrip(anna.id, trip.id, (await linkWithConsent(anna, ben)).id);
    await prisma.flight.updateMany({ where: { userId: ben.id }, data: { status: "cancelled" } });

    const before = await shareSnapshot(prisma, "flight", flight.id);
    const moved = new Date("2026-03-02T18:00:00.000Z");
    await prisma.flight.update({ where: { id: flight.id }, data: { departureTime: moved } });
    await propagateWrite(prisma, anna.id, "flight", flight.id, before);

    const bens = await prisma.flight.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bens.departureTime).toEqual(moved);
    expect(bens.status).toBe("cancelled");
  });
});
