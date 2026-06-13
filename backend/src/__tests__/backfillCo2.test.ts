/**
 * Backfill script: CO2 fill for legacy NULL rows.
 *
 * Covers (a) idempotency, (b) cabin-class factor is applied (business >
 * economy for the same route), and (c) dry-run mode. The null-coord skip
 * branch is defensive only — the schema makes dep/arr coords non-null, so
 * it can't be seeded here; it's covered by the co2Calculator unit tests.
 */
import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { backfillCo2 } from "../../scripts/backfillCo2";

describe("backfillCo2", () => {
  let userId: string;
  const seededIds: string[] = [];
  let ecoId = "";
  let bizId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-backfill-co2-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;

    // FRA → JFK (~6200 km, long haul), economy + business + one without coords.
    const eco = await prisma.flight.create({
      data: {
        user: { connect: { id: userId } },
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0,
        depLon: 8.6,
        arrLat: 40.6,
        arrLon: -73.78,
        seatClass: "economy",
        status: "historical",
        co2Kg: null,
      },
    });
    const biz = await prisma.flight.create({
      data: {
        user: { connect: { id: userId } },
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0,
        depLon: 8.6,
        arrLat: 40.6,
        arrLon: -73.78,
        seatClass: "business",
        status: "historical",
        co2Kg: null,
      },
    });
    ecoId = eco.id;
    bizId = biz.id;
    seededIds.push(ecoId, bizId);
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: seededIds } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("dry-run reports candidates without writing", async () => {
    const local: PrismaClient = prisma as unknown as PrismaClient;
    const result = await backfillCo2(local, { dryRun: true, batchSize: 500 });
    // Two seeded rows are guaranteed NULL; other suites may add more.
    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.updated).toBeGreaterThanOrEqual(2);

    const stillNull = await prisma.flight.count({
      where: { id: { in: [ecoId, bizId] }, co2Kg: null },
    });
    expect(stillNull).toBe(2);
  });

  it("fills CO2 with the cabin-class factor applied", async () => {
    const local: PrismaClient = prisma as unknown as PrismaClient;
    await backfillCo2(local, { dryRun: false, batchSize: 500 });

    const eco = await prisma.flight.findUnique({ where: { id: ecoId } });
    const biz = await prisma.flight.findUnique({ where: { id: bizId } });
    expect(eco?.co2Kg).not.toBeNull();
    expect(biz?.co2Kg).not.toBeNull();
    // Same route, business cabin → strictly larger footprint than economy.
    expect(biz!.co2Kg!).toBeGreaterThan(eco!.co2Kg!);
  });

  it("is idempotent — re-run leaves the seeded rows populated", async () => {
    const local: PrismaClient = prisma as unknown as PrismaClient;
    await backfillCo2(local, { dryRun: false, batchSize: 500 });
    const stillNull = await prisma.flight.count({
      where: { id: { in: [ecoId, bizId] }, co2Kg: null },
    });
    expect(stillNull).toBe(0);
  });
});
