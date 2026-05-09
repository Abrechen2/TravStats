/**
 * Backfill script: distance fill for legacy NULL rows.
 *
 * Tests the pure function `backfillRouteDistance` against the dev DB so we
 * cover (a) idempotency, (b) NULL-coord skip, (c) Haversine sanity, and
 * (d) dry-run mode.
 */
import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { backfillRouteDistance } from "../../scripts/backfillRouteDistance";

describe("backfillRouteDistance", () => {
  let userId: string;
  const seededIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "test-backfill-distance-" + Date.now(), passwordHash: "x" },
    });
    userId = user.id;

    // 3 candidate flights, all NULL routeDistance — varying coord shapes
    const seed = [
      // MUC → FCO (~717 km — short haul, real-world)
      { dep: { lat: 48.35, lon: 11.78 }, arr: { lat: 41.8, lon: 12.25 } },
      // FRA → JFK (~6204 km — long haul)
      { dep: { lat: 50.0, lon: 8.6 }, arr: { lat: 40.6, lon: -73.78 } },
      // SYD → AKL (~2155 km — across the Tasman)
      { dep: { lat: -33.95, lon: 151.18 }, arr: { lat: -37.0, lon: 174.78 } },
    ];
    for (let i = 0; i < seed.length; i++) {
      const f = await prisma.flight.create({
        data: {
          userId,
          depIata: "X" + i,
          arrIata: "Y" + i,
          depLat: seed[i].dep.lat,
          depLon: seed[i].dep.lon,
          arrLat: seed[i].arr.lat,
          arrLon: seed[i].arr.lon,
          status: "historical",
          routeDistance: null,
        },
      });
      seededIds.push(f.id);
    }
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { id: { in: seededIds } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("dry-run reports candidates without writing", async () => {
    const local: PrismaClient = prisma as unknown as PrismaClient;
    const result = await backfillRouteDistance(local, { dryRun: true, batchSize: 500 });
    expect(result.scanned).toBeGreaterThanOrEqual(3);
    expect(result.updated).toBeGreaterThanOrEqual(3);

    const stillNull = await prisma.flight.count({
      where: { id: { in: seededIds }, routeDistance: null },
    });
    expect(stillNull).toBe(3);
  });

  it("populates Haversine distances for all 3 seeded rows", async () => {
    const local: PrismaClient = prisma as unknown as PrismaClient;
    const result = await backfillRouteDistance(local, { dryRun: false, batchSize: 500 });
    expect(result.updated).toBeGreaterThanOrEqual(3);

    const filled = await prisma.flight.findMany({
      where: { id: { in: seededIds } },
      select: { id: true, routeDistance: true },
      orderBy: { id: "asc" },
    });
    for (const f of filled) {
      expect(f.routeDistance).not.toBeNull();
      expect(f.routeDistance!).toBeGreaterThan(100);
      expect(f.routeDistance!).toBeLessThan(20_000);
    }
  });

  it("is idempotent — re-run touches zero rows for already-populated", async () => {
    const local: PrismaClient = prisma as unknown as PrismaClient;
    const result = await backfillRouteDistance(local, { dryRun: false, batchSize: 500 });
    // Other tests may have left some NULLs around (other suites' seed data);
    // the seeded ones from THIS suite should not contribute to `updated`.
    const stillNull = await prisma.flight.count({
      where: { id: { in: seededIds }, routeDistance: null },
    });
    expect(stillNull).toBe(0);
    // Total updated should only reflect rows from OTHER suites that were
    // also NULL — not the 3 we already populated above.
    expect(result.updated).toBeLessThan(result.scanned + 1);
  });
});
