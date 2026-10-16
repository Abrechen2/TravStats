import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { shareTrip } from "../../services/sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

// The rate lookup is a network call; the snapshot it returns is what matters here.
jest.mock("../../services/fx/snapshot", () => ({
  ...jest.requireActual<typeof import("../../services/fx/snapshot")>("../../services/fx/snapshot"),
  fxColumnsFor: jest.fn(async (input: { amount: number }, base: string) => ({
    priceBase: input.amount * 0.1,
    fxRate: 0.1,
    fxRateDate: new Date("2026-07-01T00:00:00Z"),
    fxBaseCurrency: base,
    fxSource: "ecb",
  })),
}));

/**
 * A crossing imported from a `.travstats` file into a trip that is already
 * shared travels to the other members like any other write, and a crossing
 * priced in a foreign currency keeps its base-currency snapshot on import.
 */
describe("trip file import — ferry crossings on a shared trip", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let carl: TestAccount;
  let sourceTripId: string;

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xshared");
    ben = await makeAccount("ben-xshared");
    carl = await makeAccount("carl-xshared");
    sourceTripId = (
      await prisma.trip.create({
        data: { userId: anna.id, name: "Norwegen", startDate: new Date("2026-07-01T00:00:00Z") },
      })
    ).id;
    await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId: sourceTripId,
        operator: "Fjord Line",
        depStationName: "Hirtshals",
        depLat: 57.5927,
        depLon: 9.9628,
        depTimezone: "Europe/Copenhagen",
        arrStationName: "Bergen",
        arrLat: 60.3958,
        arrLon: 5.3141,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2026-07-01T18:00:00Z"),
        status: "scheduled",
        price: 4000,
        currency: "NOK",
      },
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const archiveOfAnna = async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${sourceTripId}/export?private=1`)
      .set("Cookie", anna.cookie)
      .buffer(true)
      .parse(binary);
    return readTripArchive(res.body as Buffer);
  };

  it("copies a crossing imported into an already shared trip to the member, under one key", async () => {
    const carlsTrip = await prisma.trip.create({
      data: { userId: carl.id, name: "Norwegen", startDate: new Date("2026-07-01T00:00:00Z") },
    });
    const companion = await linkWithConsent(carl, ben);
    await shareTrip(carl.id, carlsTrip.id, companion.id);

    await commitTripFile(carl.id, await archiveOfAnna());

    const mine = await prisma.ferryJourney.findFirstOrThrow({
      where: { userId: carl.id, tripId: carlsTrip.id },
    });
    expect(mine.shareKey).not.toBeNull();
    const theirs = await prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben.id } });
    expect(theirs.shareKey).toBe(mine.shareKey);
  });

  it("imports a crossing priced in a foreign currency with its base price set", async () => {
    await commitTripFile(ben.id, await archiveOfAnna());
    const crossing = await prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben.id } });
    expect(crossing).toMatchObject({ price: 4000, currency: "NOK", priceBase: 400, fxRate: 0.1 });
  });
});
