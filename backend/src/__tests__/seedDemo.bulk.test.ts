import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { BULK_CITIES } from "../seedDemo/bulk";
import { seedBulk } from "../seedDemo/seedBulk";

describe("seedBulk", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedBulkUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedBulkUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("writes one stay per city, every place, and two lists with members", async () => {
    const result = await seedBulk(userId);
    expect(result.stays).toBe(BULK_CITIES.length);
    expect(result.places).toBe(BULK_CITIES.reduce((n, c) => n + c.places.length, 0));
    expect(result.lists).toBe(2);
    const lists = await prisma.placeList.findMany({ where: { userId }, include: { entries: true } });
    for (const list of lists) {
      if (list.entries.length === 0) throw new Error(`${list.name}: expected at least one entry`);
    }
    // Unattached: bulk rows belong to no trip.
    expect(await prisma.lodgingStay.count({ where: { userId, tripId: { not: null } } })).toBe(0);
  });
});
