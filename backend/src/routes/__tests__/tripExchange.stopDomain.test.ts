import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
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
 * Sharing UAT 2 (2026-11-27): the owner's India trip holds 12 timeline stops of kind "poi" and
 * "train". The `.travstats` file left the kind out, so the copy's stops carried none and a link
 * listed all 12 as "only here" AND "only there" — a stop pairs on kind, title and day.
 */
describe("a trip file keeps a timeline stop's kind", () => {
  jest.setTimeout(60_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  beforeAll(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-sd");
    ben = await makeAccount("ben-sd");
    tripId = (await makeFullTrip(anna)).trip.id;
    await prisma.tripStop.create({
      data: {
        tripId,
        orderIdx: 9001,
        title: "New Delhi Railway Station",
        domain: "train",
        startDate: new Date("2025-03-23T00:00:00Z"),
        precision: "day",
      },
    });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("exports the kind and the import writes it back", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/export`)
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
    const stop = await prisma.tripStop.findFirstOrThrow({
      where: { tripId: imported as string, title: "New Delhi Railway Station" },
    });
    expect(stop.domain).toBe("train");
  });
});
