import { prisma } from "../db";
import { seedAirlinesFromData } from "../seedAirlinesFromData";

describe("seedAirlinesFromData", () => {
  beforeEach(async () => {
    await prisma.airline.deleteMany({});
  });

  afterAll(async () => {
    await seedAirlinesFromData(); // leave dev DB populated
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
    await prisma.airline.create({
      data: { iata: "LH", name: "My Custom LH", isUserAdded: true },
    });
    await seedAirlinesFromData();
    const lh = await prisma.airline.findUnique({ where: { iata: "LH" } });
    expect(lh?.name).toBe("My Custom LH");
    expect(lh?.isUserAdded).toBe(true);
  });
});
