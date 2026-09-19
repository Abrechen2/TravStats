import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import type { EvidenceScope } from "../../../shared/evidence";
import {
  resolveFlightCount,
  resolveAirlineCount,
  resolveBusinessTotalCost,
} from "../metricEvidenceFlightCore";

/**
 * The flight-core family shares one `where` and one page of hydration, and
 * for a while it also shared one twenty-column `select` with a `booking`
 * join — while the file's own header said each resolver read only the
 * columns its measure needed. `flightCount`, which needs an id and a date,
 * was pulling prices, coordinates, durations and a joined booking row for
 * every countable flight on the account, on an endpoint one click opens.
 *
 * Nothing about the ANSWER changes when a select is too wide, so no
 * behavioural test can see this. What can is the query itself: spy on
 * `findMany` (calling through, so the resolvers still work) and read the
 * projections back.
 */
describe("the flight-core resolvers project only the columns they read", () => {
  let userId: string;
  const allTime: EvidenceScope = { period: { kind: "allTime" } };
  const page = { offset: 0, limit: 10 };

  type Recorded = { select?: Record<string, unknown> };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceprojection" } });
    const user = await prisma.user.create({
      data: { username: "evidenceprojection", passwordHash: await hashPassword("pw123456") },
    });
    userId = user.id;
    await prisma.flight.create({
      data: {
        userId,
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 51.47,
        arrLon: -0.4543,
        depIata: "FRA",
        arrIata: "LHR",
        departureTime: new Date("2025-01-10T08:00:00Z"),
        arrivalTime: new Date("2025-01-10T09:30:00Z"),
        status: "flown",
        flightNumber: "PJ100",
        airline: "Lufthansa",
        price: 100,
        currency: "EUR",
      },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  afterEach(() => jest.restoreAllMocks());

  async function projectionsOf(
    run: () => Promise<unknown>
  ): Promise<Array<Record<string, unknown>>> {
    const spy = jest.spyOn(prisma.flight, "findMany");
    await run();
    return spy.mock.calls
      .map((call) => (call[0] as Recorded | undefined)?.select)
      .filter((select): select is Record<string, unknown> => Boolean(select));
  }

  it("flightCount reads an id and a date, and never joins a booking", async () => {
    const projections = await projectionsOf(() => resolveFlightCount(userId, allTime, page));
    expect(projections.length).toBeGreaterThan(0);
    for (const select of projections) {
      expect(select.booking).toBeUndefined();
      expect(select.price).toBeUndefined();
      expect(select.depLat).toBeUndefined();
      expect(select.durationMinutes).toBeUndefined();
    }
  });

  it("airlineCount reads the three airline columns, and no money or coordinates", async () => {
    const projections = await projectionsOf(() => resolveAirlineCount(userId, allTime, page));
    const identity = projections[0];
    expect(identity.airline).toBe(true);
    expect(identity.airlineIata).toBe(true);
    expect(identity.airlineIcao).toBe(true);
    for (const select of projections) {
      expect(select.booking).toBeUndefined();
      expect(select.price).toBeUndefined();
      expect(select.depLat).toBeUndefined();
    }
  });

  it("businessTotalCost is the one that joins a booking — the cost rule needs it", async () => {
    const projections = await projectionsOf(() => resolveBusinessTotalCost(userId, allTime, page));
    const withBooking = projections.filter((select) => select.booking !== undefined);
    expect(withBooking).toHaveLength(1);
    expect(withBooking[0].price).toBe(true);
    // Even here, the columns no cost rule reads stay out.
    expect(withBooking[0].depLat).toBeUndefined();
    expect(withBooking[0].durationMinutes).toBeUndefined();
  });
});
