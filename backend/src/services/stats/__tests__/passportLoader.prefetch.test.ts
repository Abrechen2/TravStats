import { describe, it, expect, jest, afterEach, afterAll } from "@jest/globals";

import { prisma } from "../../../db";
import { loadPassport, type PassportLoaderFlight } from "../passportLoader";

/**
 * forgejo#49. `routes/stats.ts` held nineteen `prisma.flight.findMany` calls,
 * one per endpoint, each reading the caller's whole flight history — and two
 * endpoints did it TWICE inside a single request, because `loadPassport` went
 * and fetched the same rows again. `/stats/hero` managed three, counting
 * `computeSummary`.
 *
 * The contract pinned here: given rows, the loader must not go to the database
 * for flights at all. Without the `prefetchedFlights` parameter the first
 * assertion fails, because the call happens unconditionally.
 *
 * Deliberately NOT built on a mocked `db`. The loader reaches several tables
 * and two of them through other services, so a mock would have to grow a stub
 * per transitive call and would then be testing the stub. Spying on the one
 * query that matters, against the real database, keeps everything else honest.
 */
describe("loadPassport — prefetched flights", () => {
  const NOBODY = "00000000-0000-4000-8000-000000000000";

  const row = (): PassportLoaderFlight =>
    ({
      depIata: "FRA",
      depIcao: "EDDF",
      depLat: 50.0379,
      depLon: 8.5622,
      arrIata: "JFK",
      arrIcao: "KJFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date("2026-05-01T06:00:00.000Z"),
      arrivalTime: new Date("2026-05-01T14:00:00.000Z"),
      depTimeSemantics: "utc",
      arrTimeSemantics: "utc",
      status: "flown",
    }) as PassportLoaderFlight;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not read the flight table when rows are handed over", async () => {
    const spy = jest.spyOn(prisma.flight, "findMany");

    await loadPassport(NOBODY, [row()]);

    expect(spy).not.toHaveBeenCalled();
  });

  it("still reads it when they are not", async () => {
    const spy = jest.spyOn(prisma.flight, "findMany");

    await loadPassport(NOBODY);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("uses the rows it was given, not an empty list", async () => {
    // The account does not exist, so the database can contribute nothing. A
    // passport that names any country can only have come from the handed-over
    // flight — which is what makes the first assertion a saved scan rather
    // than a skipped one.
    const passport = await loadPassport(NOBODY, [row()]);

    expect(passport.countries.length).toBeGreaterThan(0);
  });
});
