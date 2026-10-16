import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A trip's status is a cache of its entries' dates. When a propagated change
 * moved the dates of a member's copy, the member's trip kept the status it had
 * — "planned" for a journey that, by its own flight, was already under way.
 */
describe("sharing — a propagated date change re-derives the member's trip status", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("Ben's copy of the trip follows when Anna moves the flight", async () => {
    const trip = await prisma.trip.create({
      data: { userId: anna.id, name: "Later", status: "planned" },
    });
    const flight = await prisma.flight.create({
      data: {
        userId: anna.id,
        tripId: trip.id,
        flightNumber: "LH400",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
        depTimezone: "Europe/Berlin",
        arrTimezone: "America/New_York",
        departureTime: new Date("2099-05-01T10:00:00.000Z"),
        arrivalTime: new Date("2099-05-01T18:00:00.000Z"),
        status: "scheduled",
      },
    });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, trip.id, companion.id);
    const bensTrip = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bensTrip.status).toBe("planned");

    await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ departureLocal: "2020-05-01T12:00", arrivalLocal: "2020-05-01T14:00" })
      .expect(200);

    const bensFlight = await prisma.flight.findFirstOrThrow({ where: { userId: ben.id } });
    expect(bensFlight.departureTime?.getUTCFullYear()).toBe(2020);
    const after = await prisma.trip.findUniqueOrThrow({ where: { id: bensTrip.id } });
    expect(after.status).toBe("completed");
  });
});
