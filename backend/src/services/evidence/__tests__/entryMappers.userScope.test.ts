import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { hydrateFlightSumEntries, hydrateFlightDistinctEntries } from "../entryMappers";

/**
 * The hydration pass is the only query in the evidence feature whose `where`
 * is a LIST OF IDS rather than a predicate, and it was the only one carrying
 * no `userId`. Safe as written — every id reaching it came out of a
 * user-scoped pass — which is exactly why nothing would have noticed the day
 * an id arrived from somewhere else.
 *
 * So the guard is tested the only way it can be: by handing the mapper an id
 * it must refuse, i.e. another user's flight. A hydration without `userId`
 * answers with that flight's number and route; a scoped one finds nothing
 * and the entry falls back to the placeholder. The ROW still appears —
 * refusing to hydrate is not the same as dropping evidence, and the paging
 * arithmetic upstream must not shift underfoot.
 */
describe("entryMappers hydration — scoped to the calling user", () => {
  let ownerId: string;
  let strangerId: string;
  let flightId: string;

  const page = { offset: 0, limit: 100 };

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["evidencehydrateowner", "evidencehydratestranger"] } },
    });
    const [owner, stranger] = await Promise.all([
      prisma.user.create({
        data: { username: "evidencehydrateowner", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: {
          username: "evidencehydratestranger",
          passwordHash: await hashPassword("password123"),
        },
      }),
    ]);
    ownerId = owner.id;
    strangerId = stranger.id;

    const flight = await prisma.flight.create({
      data: {
        userId: ownerId,
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 51.47,
        arrLon: -0.4543,
        depIata: "FRA",
        arrIata: "LHR",
        departureTime: new Date("2025-01-10T08:00:00Z"),
        arrivalTime: new Date("2025-01-10T09:30:00Z"),
        status: "flown",
        flightNumber: "HY100",
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  });

  const sumSkeleton = () => [{ id: flightId, date: null, contribution: 1 }];
  const distinctSkeleton = () => [{ id: flightId, date: null, credits: ["LH"] }];

  it("hydrates the owner's own flight with its real number and route", async () => {
    const { entries } = await hydrateFlightSumEntries(ownerId, sumSkeleton(), page);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toEqual({ text: "HY100" });
    expect(entries[0].subtitle).toEqual({ text: "FRA → LHR" });
  });

  it("never reads another user's flight columns, even when handed that flight's id", async () => {
    const { entries } = await hydrateFlightSumEntries(strangerId, sumSkeleton(), page);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toEqual({ text: "—" });
    expect(entries[0].subtitle).toEqual({ text: "? → ?" });
  });

  it("holds for the distinct mapper too — the same query, the same scoping", async () => {
    const mine = await hydrateFlightDistinctEntries(ownerId, distinctSkeleton(), page);
    expect(mine.entries[0].title).toEqual({ text: "HY100" });

    const theirs = await hydrateFlightDistinctEntries(strangerId, distinctSkeleton(), page);
    expect(theirs.entries[0].title).toEqual({ text: "—" });
  });
});
