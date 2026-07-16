import { prisma } from "../db";
import { seedAircraftFromData } from "../seedAircraftFromData";

describe("seedAircraftFromData", () => {
  beforeEach(async () => {
    await prisma.aircraft.deleteMany({});
  });

  afterAll(async () => {
    // Wipe + reseed so no synthetic/user-added row from this suite survives
    // into downstream suites that share the dev DB (Jest runs serially).
    await prisma.aircraft.deleteMany({});
    await seedAircraftFromData();
    await prisma.$disconnect();
  });

  it("inserts a batch and keeps curated names", async () => {
    const count = await seedAircraftFromData();
    expect(count).toBeGreaterThan(100);
    const at72 = await prisma.aircraft.findUnique({ where: { icao: "AT72" } });
    expect(at72?.name).toBe("ATR 72-500");
  });

  it("is idempotent: second run inserts 0", async () => {
    await seedAircraftFromData();
    expect(await seedAircraftFromData()).toBe(0);
  });

  it("never overwrites a user-added row", async () => {
    // ZZ9 is absent from both data/openflights/planes.dat and
    // src/data/aircraftTypes.ts, so even a leaked row can't be mistaken
    // for real data downstream.
    await prisma.aircraft.create({ data: { icao: "ZZ9", name: "Custom", isUserAdded: true } });
    await seedAircraftFromData();
    const row = await prisma.aircraft.findUnique({ where: { icao: "ZZ9" } });
    expect(row?.name).toBe("Custom");
    expect(row?.isUserAdded).toBe(true);
  });
});
