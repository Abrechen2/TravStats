import { prisma } from "../db";
import { seedAirlinesFromData } from "../seedAirlinesFromData";

describe("seedAirlinesFromData", () => {
  beforeEach(async () => {
    await prisma.airline.deleteMany({});
  });

  afterAll(async () => {
    // Wipe + reseed so no synthetic/user-added row from this suite survives
    // into downstream suites that share the dev DB (Jest runs serially).
    await prisma.airline.deleteMany({});
    await seedAirlinesFromData(); // leave dev DB populated, fully real
    await prisma.$disconnect();
  });

  it("inserts a large batch on a fresh table", async () => {
    const count = await seedAirlinesFromData();
    expect(count).toBeGreaterThan(140); // curated 147 + OpenFlights
    const lh = await prisma.airline.findUnique({ where: { iata: "LH" } });
    expect(lh?.name).toBe("Lufthansa");
  });

  it("is idempotent: a second run inserts 0", async () => {
    await seedAirlinesFromData();
    const second = await seedAirlinesFromData();
    expect(second).toBe(0);
  });

  it("never overwrites a user-added row", async () => {
    // Q9 is not synthetic enough (two real OpenFlights carriers use it:
    // Afrinat International Airlines, Arik Niger) — Q0 is absent from both
    // data/openflights/airlines.dat and src/data/airlines.ts, so even a
    // leaked row can't be mistaken for real data downstream.
    await prisma.airline.create({
      data: { iata: "Q0", name: "My Custom Q0", isUserAdded: true },
    });
    await seedAirlinesFromData();
    const q0 = await prisma.airline.findUnique({ where: { iata: "Q0" } });
    expect(q0?.name).toBe("My Custom Q0");
    expect(q0?.isUserAdded).toBe(true);
  });
});
