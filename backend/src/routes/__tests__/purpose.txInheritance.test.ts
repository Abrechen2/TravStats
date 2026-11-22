import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";

import { hashPassword } from "../../utils/password";

/**
 * Codex P2 (feat/purpose): the purpose inheritance in the Prisma hook looked the trip's category
 * up on the shared pool. Inside an interactive transaction that (a) cannot see a trip created a
 * statement earlier and (b) needs a second connection while the transaction holds the only one.
 * Run against a ONE-connection pool, so a second connection is a timeout, not a lucky pass.
 */
describe("purpose inheritance inside an interactive transaction", () => {
  let db: typeof import("../../db");
  const stamp = Date.now();
  let userId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    const single = url.replace(/([?&])connection_limit=\d+&?/, "$1").replace(/[?&]$/, "");
    process.env.DATABASE_URL = `${single}${single.includes("?") ? "&" : "?"}connection_limit=1&pool_timeout=3`;
    jest.resetModules();
    db = await import("../../db");
    userId = (
      await db.prisma.user.create({
        data: { username: `txinherit-${stamp}`, passwordHash: await hashPassword("x") },
      })
    ).id;
  });
  afterAll(async () => {
    await db.prisma.user.deleteMany({ where: { id: userId } });
    await db.prisma.$disconnect();
  });

  it("sees a trip created in the same transaction and needs no second connection", async () => {
    const flight = await db.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          userId,
          name: "tx trip",
          category: "business",
          startDate: new Date("2025-03-01T00:00:00Z"),
          endDate: new Date("2025-03-05T00:00:00Z"),
        },
      });
      return tx.flight.create({
        data: {
          userId,
          tripId: trip.id,
          depIata: "FRA",
          arrIata: "FCO",
          depLat: 50,
          depLon: 8,
          arrLat: 41,
          arrLon: 12,
          status: "flown",
          departureTime: new Date("2025-03-01T08:00:00Z"),
          arrivalTime: new Date("2025-03-01T10:00:00Z"),
        },
      });
    });
    expect(flight.purpose).toBe("business");
  });

  it("an array-form transaction resolves the trip before the batch opens: no pool deadlock", async () => {
    const trip = await db.prisma.trip.create({
      data: {
        userId,
        name: "batch trip",
        category: "business",
        startDate: new Date("2025-03-01T00:00:00Z"),
        endDate: new Date("2025-03-05T00:00:00Z"),
      },
    });
    const [flight] = await db.prisma.$transaction([
      db.prisma.flight.create({
        data: {
          userId,
          tripId: trip.id,
          depIata: "FRA",
          arrIata: "FCO",
          depLat: 50,
          depLon: 8,
          arrLat: 41,
          arrLon: 12,
          status: "flown",
          departureTime: new Date("2025-03-01T08:00:00Z"),
          arrivalTime: new Date("2025-03-01T10:00:00Z"),
        },
      }),
    ]);
    // The hook runs while the batch is still being built, before it holds the connection.
    expect(flight.purpose).toBe("business");
  });
});
