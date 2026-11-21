/**
 * A duplicate merge deletes the twin, and the twin's photo links and the
 * stay's per-traveller facts hang off it with ON DELETE CASCADE. These pin that
 * the merge carries them over first (Codex, rc.41 integration, P2).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "@jest/globals";
import { prisma } from "../../../db";
import { mergeDuplicates } from "../duplicateMerge";

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const FLIGHT = {
  airline: "Lufthansa",
  flightNumber: "LH400",
  depIata: "FRA",
  depLat: 50.03,
  depLon: 8.57,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  status: "flown",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  depTimezone: "Europe/Berlin",
  arrTimezone: "America/New_York",
  departureTime: new Date("2026-03-10T08:00:00Z"),
  arrivalTime: new Date("2026-03-10T16:00:00Z"),
};

describe("duplicate merge carries photo links and traveller facts", () => {
  let userId: string;
  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-carry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "x",
      },
    });
    userId = user.id;
  });
  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps a removed flight's manual pick and refusal, and folds a shared photo to the stronger row", async () => {
    const kept = await prisma.flight.create({
      data: { ...FLIGHT, userId, createdAt: day("2026-03-01") },
    });
    const twin = await prisma.flight.create({
      data: { ...FLIGHT, userId, createdAt: day("2026-03-02") },
    });
    const link = (flightId: string, assetId: string, provenance: string, refused = false) =>
      prisma.entryPhotoLink.create({ data: { userId, flightId, assetId, provenance, refused } });
    await link(twin.id, "picked", "manual");
    await link(twin.id, "refused", "auto", true);
    await link(kept.id, "shared", "auto");
    await link(twin.id, "shared", "manual");
    await link(kept.id, "both", "manual");
    await link(twin.id, "both", "auto");

    await mergeDuplicates(userId, "flight", kept.id, [twin.id], async () => undefined);

    const rows = await prisma.entryPhotoLink.findMany({ where: { flightId: kept.id } });
    const by = Object.fromEntries(rows.map((r) => [r.assetId, r]));
    expect(rows).toHaveLength(4);
    expect(by.picked).toMatchObject({ provenance: "manual", refused: false });
    expect(by.refused).toMatchObject({ refused: true });
    expect(by.shared).toMatchObject({ provenance: "manual", refused: false });
    expect(by.both).toMatchObject({ provenance: "manual", refused: false });
  });

  it("keeps a removed stay's photo links and per-traveller facts", async () => {
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Roma" } });
    const stay = (createdAt: string) =>
      prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          createdAt: day(createdAt),
          checkIn: day("2026-06-10"),
          checkOut: day("2026-06-13"),
          checkInDate: day("2026-06-10"),
          checkOutDate: day("2026-06-13"),
        },
      });
    const kept = await stay("2026-05-01");
    const twin = await stay("2026-05-02");
    const [ann, bob] = await Promise.all(
      ["ann", "bob"].map((n) =>
        prisma.companion.create({
          data: { userId, canonicalName: n, displayName: n, searchName: n },
        })
      )
    );
    await prisma.lodgingStayCompanion.create({
      data: { lodgingStayId: kept.id, companionId: ann.id, bookingReference: "KEEP" },
    });
    await prisma.lodgingStayCompanion.createMany({
      data: [
        {
          lodgingStayId: twin.id,
          companionId: ann.id,
          bookingReference: "TWIN",
          loyaltyNumber: "L1",
        },
        { lodgingStayId: twin.id, companionId: bob.id, bookingReference: "BOB" },
      ],
    });
    await prisma.entryPhotoLink.create({
      data: { userId, lodgingStayId: twin.id, assetId: "p", provenance: "manual" },
    });

    await mergeDuplicates(userId, "lodging_stay", kept.id, [twin.id], async () => undefined);

    const facts = await prisma.lodgingStayCompanion.findMany({ where: { lodgingStayId: kept.id } });
    const by = Object.fromEntries(facts.map((f) => [f.companionId, f]));
    expect(by[ann.id]).toMatchObject({ bookingReference: "KEEP", loyaltyNumber: "L1" });
    expect(by[bob.id]).toMatchObject({ bookingReference: "BOB" });
    expect(await prisma.entryPhotoLink.count({ where: { lodgingStayId: kept.id } })).toBe(1);
  });
});
