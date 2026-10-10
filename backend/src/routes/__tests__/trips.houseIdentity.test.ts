import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";
import { readTripArchive, type TripArchive } from "../../services/trip/exchange/readArchive";
import { buildTripFileProposal } from "../../services/trip/exchange/proposal";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { pickHouse } from "../../services/trip/package/matching";
import { buildPackageProposal } from "../../services/trip/package/proposal";
import { commitPackageProposal } from "../../services/trip/package/commit";
import type { PackageContract } from "../../services/trip/package/contract";
import { seedFullTrip, type SeededTrip } from "./tripExchange.fixture";

/**
 * forgejo#277: a package and a `.travstats` file decided "same hotel" on the
 * name alone, so "Hotel Central" in Lyon was skipped as the account's
 * "Hotel Central" in Paris — or its stay filed under the Paris house. Both now
 * use the sharing rule: name AND place (`houseVerdict` / `pickHouse`).
 */
const stamp = Date.now();

const house = (
  id: string,
  over: Partial<{ city: string | null; country: string | null; lat: number; lon: number }> = {}
) => ({
  id,
  name: "Hotel Central",
  city: null,
  country: null,
  isoCountryCode: null,
  lat: null,
  lon: null,
  ...over,
});

describe("pickHouse — the import's house rule", () => {
  const paris = house("paris", { city: "Paris", country: "France", lat: 48.8566, lon: 2.3522 });
  const lyon = house("lyon", { city: "Lyon", country: "France", lat: 45.764, lon: 4.8357 });

  it("keeps same-named houses in different cities apart", () => {
    expect(pickHouse([paris], { name: "Hotel Central", city: "Lyon", country: "France" })).toBe(
      null
    );
    expect(pickHouse([paris], { name: "Hotel Central", lat: 45.764, lon: 4.8357 })).toBe(null);
  });

  it("finds the house the place data proves, among others of the name", () => {
    expect(pickHouse([paris, lyon], { name: "hotel  central", lat: 45.7641, lon: 4.8358 })).toBe(
      lyon
    );
    expect(
      pickHouse([paris, lyon], { name: "Hotel Central", city: "Paris", country: "France" })
    ).toBe(paris);
  });

  it("does not pick the oldest of candidates it cannot tell apart", () => {
    expect(pickHouse([paris, lyon], { name: "Hotel Central" })).toBe(null);
  });

  it("reuses the one same-named house when nothing contradicts and nothing competes", () => {
    expect(pickHouse([paris], { name: "Hotel Central" })).toBe(paris);
  });

  it("prefers, among proven duplicates, the one holding the stay", () => {
    const twin = { ...paris, id: "twin" };
    expect(
      pickHouse(
        [paris, twin],
        { name: "Hotel Central", city: "Paris", country: "France" },
        (c) => c.id === "twin"
      )
    ).toBe(twin);
  });
});

describe("imports keep same-named hotels of different places apart (forgejo#277)", () => {
  let owner: string;
  let importer: string;
  let seeded: SeededTrip;
  let exported: TripArchive;

  beforeAll(async () => {
    owner = (
      await prisma.user.create({ data: { username: `hx-owner-${stamp}`, passwordHash: "x" } })
    ).id;
    importer = (
      await prisma.user.create({ data: { username: `hx-importer-${stamp}`, passwordHash: "x" } })
    ).id;
    seeded = await seedFullTrip(owner, stamp);
    const res = await request(app)
      .get(`/api/v1/trips/${seeded.tripId}/export`)
      .set("Cookie", `auth_token=${generateToken(owner)}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    exported = readTripArchive(res.body as Buffer);
  });

  afterAll(async () => {
    const ids = [owner, importer];
    const photos = await prisma.tripPhoto.findMany({
      where: { trip: { userId: { in: ids } } },
      select: { filename: true },
    });
    for (const p of photos) fs.rmSync(path.join(getTripPhotoDir(), p.filename), { force: true });
    await prisma.document.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.port.deleteMany({ where: { id: seeded.portId } });
    await prisma.$disconnect();
  });

  it("creates the file's stay in Lisbon beside the account's same-named house in Porto", async () => {
    const [stay] = exported.file.stays;
    const porto = await prisma.lodging.create({
      data: {
        userId: importer,
        name: stay.lodging.name,
        city: "Porto",
        country: "Portugal",
        lat: 41.1496,
        lon: -8.611,
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: importer,
        lodgingId: porto.id,
        checkIn: new Date("2026-05-01T00:00:00Z"),
        checkOut: new Date("2026-05-02T00:00:00Z"),
        checkInDate: new Date("2026-05-01T00:00:00Z"),
        checkOutDate: new Date("2026-05-02T00:00:00Z"),
        nights: 1,
        status: "completed",
      },
    });

    const proposal = await buildTripFileProposal(importer, exported);
    expect(proposal.entries.find((e) => e.kind === "stay")).toMatchObject({
      action: "create",
      id: null,
    });

    await commitTripFile(importer, exported);
    const houses = await prisma.lodging.findMany({
      where: { userId: importer, name: stay.lodging.name },
      include: { stays: true },
      orderBy: { createdAt: "asc" },
    });
    expect(houses.map((h) => [h.city, h.stays.length])).toEqual([
      ["Porto", 1],
      ["Lisboa", 1],
    ]);

    // The genuine repeat finds the Lisbon house and its stay — idempotent.
    const again = await buildTripFileProposal(importer, exported);
    expect(again.entries.find((e) => e.kind === "stay")).toMatchObject({ action: "skip" });
    await commitTripFile(importer, exported);
    expect(await prisma.lodging.count({ where: { userId: importer } })).toBe(2);
    expect(await prisma.lodgingStay.count({ where: { userId: importer } })).toBe(2);
  }, 30_000);

  it("keeps a package's same-named hotel in another city apart — preview and commit", async () => {
    const name = `Hotel Seeblick ${stamp}`;
    const berlin = await prisma.lodging.create({
      data: {
        userId: importer,
        name,
        city: "Berlin",
        country: "Deutschland",
        isoCountryCode: "DE",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: importer,
        lodgingId: berlin.id,
        checkIn: new Date("2027-04-19T00:00:00Z"),
        checkOut: new Date("2027-04-20T00:00:00Z"),
        checkInDate: new Date("2027-04-19T00:00:00Z"),
        checkOutDate: new Date("2027-04-20T00:00:00Z"),
        nights: 1,
        status: "scheduled",
      },
    });
    const contract = {
      bookingReference: `HX${String(stamp).slice(-8)}`,
      issuedOn: "2027-01-30",
      flights: [],
      stays: [
        { name, checkIn: "2027-04-19", checkOut: "2027-04-26", city: "Naivasha", country: "Kenia" },
      ],
    } as unknown as PackageContract;

    const proposal = await buildPackageProposal(importer, contract);
    expect(proposal.stays[0]).toMatchObject({ action: "create", lodging: { action: "create" } });
    await commitPackageProposal(importer, contract);
    const houses = await prisma.lodging.findMany({ where: { userId: importer, name } });
    expect(houses.map((h) => h.city).sort()).toEqual(["Berlin", "Naivasha"]);

    // Re-reading the same package finds its own house and stay again.
    const again = await buildPackageProposal(importer, contract);
    expect(again.stays[0]).toMatchObject({ action: "skip", lodging: { action: "reuse" } });
    expect(again.stays[0].lodging.id).not.toBe(berlin.id);
  }, 30_000);
});
