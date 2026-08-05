import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { backfillAircraftNames } from "../backfillAircraftNames";

/**
 * normalizeAircraft only ever ran on the write path, so a library built up over
 * years reads as a mixture of vocabularies in one column — measured on a real
 * install: "Airbus A350-900" next to "B737-800" and "A320neo".
 */
describe("backfillAircraftNames", () => {
  let userId: string;

  const makeFlight = async (aircraft: string | null): Promise<string> => {
    const f = await prisma.flight.create({
      data: {
        userId,
        aircraft,
        depIata: "AAA",
        arrIata: "BBB",
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
        status: "flown",
      },
      select: { id: true },
    });
    return f.id;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "aircraftBackfill" } });
    const user = await prisma.user.create({
      data: { username: "aircraftBackfill", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("rewrites a short code to the catalogue's canonical name", async () => {
    const id = await makeFlight("A319");
    const n = await backfillAircraftNames();
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await prisma.flight.findUnique({ where: { id }, select: { aircraft: true } });
    expect(after?.aircraft).toBe("Airbus A319");
  });

  it("leaves an already-canonical name alone and reports no update for it", async () => {
    const id = await makeFlight("Airbus A319");
    const n = await backfillAircraftNames();
    const after = await prisma.flight.findUnique({ where: { id }, select: { aircraft: true } });
    expect(after?.aircraft).toBe("Airbus A319");
    expect(n).toBe(0);
  });

  it("never mangles a type it does not recognise", async () => {
    const id = await makeFlight("Some Experimental Prototype 9000");
    await backfillAircraftNames();
    const after = await prisma.flight.findUnique({ where: { id }, select: { aircraft: true } });
    expect(after?.aircraft).toBe("Some Experimental Prototype 9000");
  });

  it("is idempotent — a second run changes nothing", async () => {
    await makeFlight("A319");
    const first = await backfillAircraftNames();
    const second = await backfillAircraftNames();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  });

  it("skips flights with no aircraft at all", async () => {
    const id = await makeFlight(null);
    await backfillAircraftNames();
    const after = await prisma.flight.findUnique({ where: { id }, select: { aircraft: true } });
    expect(after?.aircraft).toBeNull();
  });
});
