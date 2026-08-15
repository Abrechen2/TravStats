import { prisma } from "../db";
import { backfillMissingCoordinates } from "../services/lodging/geocodeBackfill";

const geocodeAddress = jest.fn();
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: (parts: unknown) => geocodeAddress(parts),
}));

describe("backfillMissingCoordinates", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-geocode-backfill-test", passwordHash: "x" },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    geocodeAddress.mockReset();
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // The policy CHANGED on 2026-08-05: a row used to be skipped unless it had a
  // city or an address, which silently excluded exactly what a parsed booking
  // confirmation produces — a hotel name and nothing else. That is why an
  // e-mail import came out with no pin. Every row now gets an attempt, because
  // `name` is NOT NULL and "Schlosshotel Kronberg" is perfectly geocodable.
  it("attempts every row that lacks coordinates, including a name-only one", async () => {
    geocodeAddress.mockResolvedValue({ lat: 52.5, lon: 13.4 });

    const needsCoords = await prisma.lodging.create({
      data: {
        userId,
        name: "Needs Coords",
        city: "Berlin",
        country: "Deutschland",
      },
    });
    const hasCoords = await prisma.lodging.create({
      data: { userId, name: "Has Coords", city: "Berlin", lat: 1, lon: 2 },
    });
    const nameOnly = await prisma.lodging.create({
      data: { userId, name: "Schlosshotel Kronberg" },
    });

    const result = await backfillMissingCoordinates(userId);

    // Two attempts: the city row and the name-only row. The row that already
    // has a pin is still skipped — the geocoder is never asked for nothing.
    expect(result.attempted).toBe(2);
    expect(result.filled).toBe(2);
    expect(geocodeAddress).toHaveBeenCalledTimes(2);

    // The name reaches the geocoder — without it the query would be empty and
    // the lookup would never run.
    expect(geocodeAddress).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Schlosshotel Kronberg" }),
    );

    expect(
      (await prisma.lodging.findUnique({ where: { id: needsCoords.id } }))?.lat,
    ).toBeCloseTo(52.5, 3);
    expect(
      (await prisma.lodging.findUnique({ where: { id: hasCoords.id } }))?.lat,
    ).toBeCloseTo(1, 3);
    expect(
      (await prisma.lodging.findUnique({ where: { id: nameOnly.id } }))?.lat,
    ).toBeCloseTo(52.5, 3);
  });

  it("leaves a row pin-less when the geocoder finds nothing — and never throws", async () => {
    geocodeAddress.mockResolvedValue(null);
    const row = await prisma.lodging.create({
      data: { userId, name: "Unfindable", city: "Atlantis" },
    });

    const result = await backfillMissingCoordinates(userId);

    expect(result.attempted).toBe(1);
    expect(result.filled).toBe(0);
    expect(
      (await prisma.lodging.findUnique({ where: { id: row.id } }))?.lat,
    ).toBeNull();
  });

  it("swallows a geocoder throw and keeps going with the next row", async () => {
    geocodeAddress
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ lat: 48.1, lon: 11.6 });

    await prisma.lodging.create({
      data: { userId, name: "A Boom", city: "Boomtown" },
    });
    await prisma.lodging.create({
      data: { userId, name: "B Fine", city: "München" },
    });

    const result = await backfillMissingCoordinates(userId);

    expect(result.attempted).toBe(2);
    expect(result.filled).toBe(1);
  });

  it("scopes to a single batch when a batchId is given", async () => {
    geocodeAddress.mockResolvedValue({ lat: 10, lon: 20 });
    const batch = await prisma.importBatch.create({
      data: { domain: "lodging", userId, source: "csv", fileName: "b.csv" },
    });
    await prisma.lodging.create({
      data: { userId, name: "In Batch", city: "Rome", batchId: batch.id },
    });
    await prisma.lodging.create({
      data: { userId, name: "Out Of Batch", city: "Paris" },
    });

    const result = await backfillMissingCoordinates(userId, batch.id);

    expect(result.attempted).toBe(1);
    expect(
      (
        await prisma.lodging.findFirst({
          where: { userId, name: "Out Of Batch" },
        })
      )?.lat,
    ).toBeNull();

    await prisma.lodging.deleteMany({ where: { batchId: batch.id } });
    await prisma.importBatch.delete({ where: { id: batch.id } });
  });

  it("never touches another user's rows, even via a real batch id owned by them", async () => {
    geocodeAddress.mockResolvedValue({ lat: 1, lon: 1 });

    const otherUser = await prisma.user.create({
      data: { username: "lodging-geocode-backfill-other", passwordHash: "x" },
    });
    try {
      const otherBatch = await prisma.importBatch.create({
        data: { domain: "lodging", userId: otherUser.id, source: "csv", fileName: "other.csv" },
      });
      const otherLodging = await prisma.lodging.create({
        data: {
          userId: otherUser.id,
          name: "Other User's Hotel",
          city: "Vienna",
          batchId: otherBatch.id,
        },
      });

      // Attacker (userId) supplies the victim's real batch id.
      const result = await backfillMissingCoordinates(userId, otherBatch.id);

      expect(result.attempted).toBe(0);
      expect(geocodeAddress).not.toHaveBeenCalled();
      expect(
        (await prisma.lodging.findUnique({ where: { id: otherLodging.id } }))
          ?.lat,
      ).toBeNull();
    } finally {
      await prisma.lodging.deleteMany({ where: { userId: otherUser.id } });
      await prisma.importBatch.deleteMany({
        where: { userId: otherUser.id },
      });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });
});
