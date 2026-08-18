import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

// Regression: GET /stats/cruise scoped its query to `status: { not: 'cancelled' }`,
// so a merely-booked (scheduled) cruise inflated cruisesCount, totalPortCalls and
// the visited-countries list — the same class of bug Task 1 fixed for
// /stats/countries. Brings /cruise in line with the shared done-predicate
// (backend/src/routes/stats.ts): `status: { in: ['flown', 'historical'] }`.
//
// Two cruises are seeded for a fresh user directly via Prisma (mirrors
// backend/src/routes/__tests__/cruises.test.ts's seeding, which sets `status`
// explicitly rather than going through the route's date-derivation): a
// 'flown' cruise with 2 port stops (Germany + Norway) and a 'scheduled'
// cruise with 2 port stops in different countries (Portugal + Morocco).
// Only the flown cruise's counts and countries may surface.

const UNLOCODE_FLOWN_1 = "DEHAM-LEAK";
const UNLOCODE_FLOWN_2 = "NOOSL-LEAK";
const UNLOCODE_SCHEDULED_1 = "PTLIS-LEAK";
const UNLOCODE_SCHEDULED_2 = "MACAS-LEAK";

describe("GET /stats/cruise — a scheduled cruise is not counted as sailed", () => {
  let authCookie: string;
  let userId: string;
  let portFlown1Id: number;
  let portFlown2Id: number;
  let portScheduled1Id: number;
  let portScheduled2Id: number;

  beforeAll(async () => {
    await prisma.cruise.deleteMany({ where: { user: { username: "cruisescheduledleak" } } });
    await prisma.user.deleteMany({ where: { username: "cruisescheduledleak" } });
    await prisma.port.deleteMany({
      where: {
        unlocode: {
          in: [UNLOCODE_FLOWN_1, UNLOCODE_FLOWN_2, UNLOCODE_SCHEDULED_1, UNLOCODE_SCHEDULED_2],
        },
      },
    });

    const user = await prisma.user.create({
      data: { username: "cruisescheduledleak", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    const [portFlown1, portFlown2, portScheduled1, portScheduled2] = await Promise.all([
      prisma.port.create({
        data: {
          name: "Hamburg",
          city: "Hamburg",
          country: "Germany",
          unlocode: UNLOCODE_FLOWN_1,
          lat: 53.5511,
          lon: 9.9937,
          isUserAdded: true,
        },
      }),
      prisma.port.create({
        data: {
          name: "Oslo",
          city: "Oslo",
          country: "Norway",
          unlocode: UNLOCODE_FLOWN_2,
          lat: 59.9139,
          lon: 10.7522,
          isUserAdded: true,
        },
      }),
      prisma.port.create({
        data: {
          name: "Lisbon",
          city: "Lisbon",
          country: "Portugal",
          unlocode: UNLOCODE_SCHEDULED_1,
          lat: 38.7223,
          lon: -9.1393,
          isUserAdded: true,
        },
      }),
      prisma.port.create({
        data: {
          name: "Casablanca",
          city: "Casablanca",
          country: "Morocco",
          unlocode: UNLOCODE_SCHEDULED_2,
          lat: 33.5731,
          lon: -7.5898,
          isUserAdded: true,
        },
      }),
    ]);
    portFlown1Id = portFlown1.id;
    portFlown2Id = portFlown2.id;
    portScheduled1Id = portScheduled1.id;
    portScheduled2Id = portScheduled2.id;
  });

  afterAll(async () => {
    // Cruises + stops cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.port.deleteMany({
      where: {
        unlocode: {
          in: [UNLOCODE_FLOWN_1, UNLOCODE_FLOWN_2, UNLOCODE_SCHEDULED_1, UNLOCODE_SCHEDULED_2],
        },
      },
    });
    await prisma.$disconnect();
  });

  it("counts only sailed cruises, not still-scheduled bookings", async () => {
    // Past, sailed cruise: 2 port calls in Germany + Norway.
    await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: "Flown Line",
        startDate: new Date("2020-06-01"),
        endDate: new Date("2020-06-08"),
        status: "flown",
        stops: {
          create: [
            { portId: portFlown1Id, dayNumber: 1, isAtSea: false },
            { portId: portFlown2Id, dayNumber: 3, isAtSea: false },
          ],
        },
      },
    });

    // Future, merely-booked cruise: 2 port calls in Portugal + Morocco —
    // these countries and this cruise must never surface in the response.
    await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: "Scheduled Line",
        startDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 67 * 24 * 60 * 60 * 1000),
        status: "scheduled",
        stops: {
          create: [
            { portId: portScheduled1Id, dayNumber: 1, isAtSea: false },
            { portId: portScheduled2Id, dayNumber: 3, isAtSea: false },
          ],
        },
      },
    });

    const res = await request(app)
      .get("/api/v1/stats/cruise")
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.cruisesCount).toBe(1);
    expect(res.body.totalPortCalls).toBe(2);
    expect(res.body.countries).toEqual(expect.arrayContaining(["Germany", "Norway"]));
    expect(res.body.countries).not.toEqual(
      expect.arrayContaining(["Portugal", "Morocco"]),
    );
  });
});
