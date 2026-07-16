import { prisma } from "../../db";
import { preloadAirlineCatalog } from "../../services/airlineCatalogCache";
import { backfillAirlineCodes } from "../backfillAirlineCodes";

describe("backfillAirlineCodes", () => {
  let userId: string;
  beforeAll(async () => {
    await preloadAirlineCatalog();
    const u = await prisma.user.create({
      data: { username: `bf_${Date.now()}`, passwordHash: "x" },
    });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("fills iata/icao from a resolvable name and is idempotent", async () => {
    const f = await prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        airlineIata: null,
        airlineIcao: null,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0, // minimal required fields
      },
    });
    const n1 = await backfillAirlineCodes();
    expect(n1).toBeGreaterThanOrEqual(1);
    const after = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(after?.airlineIata).toBe("LH");
    // second run is a no-op for this row
    const n2 = await backfillAirlineCodes();
    const after2 = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(after2?.airlineIata).toBe("LH");
    expect(n2).toBeLessThan(n1 + 1); // did not re-touch the filled row
  });

  it("never overwrites an existing structured code", async () => {
    const f = await prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        airlineIata: "XX",
        airlineIcao: null,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });
    await backfillAirlineCodes();
    const after = await prisma.flight.findUnique({ where: { id: f.id } });
    expect(after?.airlineIata).toBe("XX");
  });
});
