import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { findEnrichmentCandidates } from "../flightEnrichmentService";

/** forgejo#339: the candidate test runs in SQL on a narrow select, and a failure is not "nothing to enrich". */
describe("findEnrichmentCandidates — real rows", () => {
  const settings = { enabled: true, minConfidence: 0, maxPerDay: 50 };
  let userId: string;
  const ids: Record<string, string> = {};

  const make = async (key: string, over: Prisma.FlightUncheckedCreateInput | object) => {
    const row = await prisma.flight.create({
      data: {
        userId,
        flightNumber: `EN${key}`,
        airline: "Lufthansa",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50,
        depLon: 8,
        arrLat: 40,
        arrLon: -73,
        status: "flown",
        departureTime: new Date(),
        aircraft: "A320",
        depIcao: "EDDF",
        arrIcao: "KJFK",
        actualRoute: [{ lat: 1, lon: 1 }],
        ...over,
      } as Prisma.FlightUncheckedCreateInput,
    });
    ids[key] = row.id;
  };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `enrich-cand-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    await make("complete", {});
    await make("noAircraft", { aircraft: null });
    await make("emptyRoute", { actualRoute: [] });
    await make("nullRoute", { actualRoute: Prisma.DbNull });
    await make("noIcao", { depIcao: null });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns exactly the flights that miss one of the five fields, with their missing fields", async () => {
    const found = await findEnrichmentCandidates(userId, settings);
    expect(found.map((c) => c.flightId).sort()).toEqual(
      [ids.noAircraft, ids.emptyRoute, ids.nullRoute, ids.noIcao].sort()
    );
    const byId = new Map(found.map((c) => [c.flightId, c]));
    expect(byId.get(ids.noAircraft)?.missingFields).toEqual(["aircraft"]);
    expect(byId.get(ids.emptyRoute)?.missingRoute).toBe(true);
    expect(byId.get(ids.nullRoute)?.missingFields).toEqual(["actualRoute"]);
    expect(byId.get(ids.noIcao)?.missingFields).toEqual(["depIcao"]);
  });

  it("rethrows a database error instead of answering an empty candidate list", async () => {
    const spy = jest.spyOn(prisma.flight, "findMany").mockRejectedValueOnce(new Error("db down"));
    try {
      await expect(findEnrichmentCandidates(userId, settings)).rejects.toThrow("db down");
    } finally {
      spy.mockRestore();
    }
  });
});
