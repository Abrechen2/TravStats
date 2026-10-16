import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { strToU8, zipSync } from "fflate";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { buildTripFileProposal } from "../../services/trip/exchange/proposal";
import { readTripArchive, unpackEntries } from "../../services/trip/exchange/readArchive";
import { makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";

/**
 * A crossing travels in a `.travstats` file (spec 2026-10-16, §8): facts in
 * the open, the passenger's own fields only in a private file, the vehicle and
 * the roadtrip leg never. A file with crossings is version 3, so an older
 * importer refuses it by name instead of importing the trip minus its ferry.
 */
describe("trip export / import — ferry crossings", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  const binary = (
    res: NodeJS.ReadableStream,
    done: (err: Error | null, body: Buffer) => void
  ): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };
  const exportAs = (who: TestAccount, query = "") =>
    request(app)
      .get(`/api/v1/trips/${tripId}/export${query}`)
      .set("Cookie", who.cookie)
      .buffer(true)
      .parse(binary);

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xferry");
    ben = await makeAccount("ben-xferry");
    tripId = (
      await prisma.trip.create({
        data: { userId: anna.id, name: "Ostsee", startDate: new Date("2026-06-01T00:00:00Z") },
      })
    ).id;
    await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        operator: "Color Line",
        vesselName: "Color Fantasy",
        vesselMmsi: "257123450",
        roadtripLegBefore: { mode: "drive", source: "ors" },
        depStationName: "Kiel Norwegenkai",
        depLat: 54.3234,
        depLon: 10.1356,
        depTimezone: "Europe/Berlin",
        arrStationName: "Oslo",
        arrLat: 59.9021,
        arrLon: 10.7392,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2026-06-01T12:00:00Z"),
        arrivalTime: new Date("2026-06-02T08:00:00Z"),
        status: "scheduled",
        cabinType: "inside",
        seat: "PRIVATE",
        vehicleRegistration: "KI-XY 1",
        price: 520,
      },
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("writes crossings as version 3, without private or vehicle fields by default", async () => {
    const res = await exportAs(anna);
    expect(res.status).toBe(200);
    const entries = unpackEntries(res.body as Buffer);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    const file = JSON.parse(entries.get("trip.json")!.toString());
    expect(manifest.formatVersion).toBe(3);
    expect(file.ferry).toHaveLength(1);
    expect(file.ferry[0]).toMatchObject({ operator: "Color Line", vesselName: "Color Fantasy" });
    expect(file.ferry[0].private).toBeUndefined();
    expect(JSON.stringify(file)).not.toContain("KI-XY 1");
  });

  it("never writes the vessel binding, the vehicle or the roadtrip leg — not even privately", async () => {
    const res = await exportAs(anna, "?private=1");
    const text = unpackEntries(res.body as Buffer)
      .get("trip.json")!
      .toString();
    expect(text).toContain("PRIVATE");
    expect(text).not.toContain("257123450");
    expect(text).not.toContain("KI-XY 1");
    expect(text).not.toMatch(/vesselMmsi|vehicle|roadtripLeg/);
  });

  it("imports a crossing into another account", async () => {
    const res = await exportAs(anna, "?private=1");
    await commitTripFile(ben.id, readTripArchive(res.body as Buffer));
    const crossing = await prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben.id } });
    expect(crossing).toMatchObject({
      vesselName: "Color Fantasy",
      cabinType: "inside",
      seat: "PRIVATE",
      price: 520,
      vehicleRegistration: null,
      vesselMmsi: null,
      roadtripLegId: null,
    });
    expect(crossing.roadtripLegBefore).toBeNull();
  });

  it("skips a crossing the account already holds on a second import", async () => {
    const archive = readTripArchive((await exportAs(anna, "?private=1")).body as Buffer);
    await commitTripFile(ben.id, archive);
    const again = await buildTripFileProposal(ben.id, archive);
    expect(again.entries.find((e) => e.kind === "ferry")).toMatchObject({ action: "skip" });
    await commitTripFile(ben.id, archive);
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(1);
  });

  it("keeps a crossing whose operator and terminals no catalogue knows", async () => {
    await prisma.ferryJourney.updateMany({
      where: { userId: anna.id },
      data: { operator: null, depStationName: "Nowhere Pier 9", arrStationName: "Unmapped Quay" },
    });
    const archive = readTripArchive((await exportAs(anna)).body as Buffer);
    const proposal = await buildTripFileProposal(ben.id, archive);
    expect(proposal.entries.find((e) => e.kind === "ferry")).toMatchObject({
      action: "create",
      label: "Nowhere Pier 9–Unmapped Quay",
    });
    await commitTripFile(ben.id, archive);
    expect(await prisma.ferryJourney.findFirstOrThrow({ where: { userId: ben.id } })).toMatchObject(
      { operator: null, depStationName: "Nowhere Pier 9" }
    );
  });

  it("still reads a version-2 file, which has no ferry key", async () => {
    const entries = unpackEntries((await exportAs(anna)).body as Buffer);
    const trip = JSON.parse(entries.get("trip.json")!.toString());
    delete trip.ferry;
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    manifest.formatVersion = 2;
    const older = Buffer.from(
      zipSync({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        "trip.json": strToU8(JSON.stringify(trip)),
      })
    );
    const result = await commitTripFile(ben.id, readTripArchive(older));
    expect(result.tripId).toBeTruthy();
    expect(await prisma.trip.count({ where: { userId: ben.id } })).toBe(1);
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(0);
  });
});
