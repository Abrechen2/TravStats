/**
 * forgejo#43 — the reverse pass (pin, no address) read the first 500 pinned
 * lodgings of a user and filtered those. A house created after 500 complete
 * ones was never looked at. The limit must bound the rows handed to the
 * geocoder, not the rows looked at.
 */
import { prisma } from "../../../db";
import { completeMissingAddresses, MAX_BACKFILL_ROWS } from "../geocodeBackfill";

const reverseGeocode = jest.fn();
jest.mock("../../geo/nominatim", () => ({
  geocodeAddress: jest.fn(),
  reverseGeocode: (lat: number, lon: number) => reverseGeocode(lat, lon),
}));

describe("completeMissingAddresses — the limit bounds the work, not the scan", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-address-scan-test", passwordHash: "x" },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    reverseGeocode.mockReset();
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("reaches a pinned house past the 500th row", async () => {
    expect(MAX_BACKFILL_ROWS).toBe(500);
    await prisma.lodging.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        userId,
        name: `Complete ${i}`,
        type: "hotel",
        lat: 47 + i / 10000,
        lon: 8 + i / 10000,
        address: "Bahnhofstrasse 1",
        city: "Zürich",
        country: "Schweiz",
      })),
    });
    const late = await prisma.lodging.create({
      data: { userId, name: "Die 501.", type: "hotel", lat: 47.37, lon: 8.54 },
    });
    reverseGeocode.mockResolvedValue({ address: "Bahnhofstrasse 2", city: "Zürich", country: "Schweiz" });

    const result = await completeMissingAddresses(userId);

    expect(result).toEqual({ attempted: 1, filled: 1 });
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    const after = await prisma.lodging.findUnique({ where: { id: late.id } });
    expect(after?.city).toBe("Zürich");
  });

  it("still stops handing rows to the geocoder at the limit", async () => {
    await prisma.lodging.createMany({
      data: Array.from({ length: MAX_BACKFILL_ROWS + 3 }, (_, i) => ({
        userId,
        name: `Pin only ${i}`,
        type: "hotel",
        lat: 47 + i / 10000,
        lon: 8 + i / 10000,
      })),
    });
    reverseGeocode.mockResolvedValue({ city: "Zürich" });

    const result = await completeMissingAddresses(userId);

    expect(result.attempted).toBe(MAX_BACKFILL_ROWS);
    expect(reverseGeocode).toHaveBeenCalledTimes(MAX_BACKFILL_ROWS);
  });
});
