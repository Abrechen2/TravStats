import { prisma } from "../db";
import {
  agreesWithRow,
  backfillMissingCoordinates,
  MAX_BACKFILL_ROWS,
} from "../services/lodging/geocodeBackfill";

const geocodeAddress = jest.fn();
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: (parts: unknown) => geocodeAddress(parts),
}));

// The other two tiers, so this file makes no outbound request. They were not
// mocked before, which is why every case here waited on a real Photon call
// before falling through to the mocked Nominatim.
const searchPlaces = jest.fn();
jest.mock("../services/geo/photon", () => ({
  searchPlaces: (...args: unknown[]) => searchPlaces(...args),
}));
const findLodgingPlace = jest.fn();
jest.mock("../services/geo/googlePlaces", () => ({
  findLodgingPlace: (...args: unknown[]) => findLodgingPlace(...args),
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
    searchPlaces.mockReset().mockResolvedValue([]);
    findLodgingPlace.mockReset().mockResolvedValue(null);
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
      expect.objectContaining({ name: "Schlosshotel Kronberg" })
    );

    expect((await prisma.lodging.findUnique({ where: { id: needsCoords.id } }))?.lat).toBeCloseTo(
      52.5,
      3
    );
    expect((await prisma.lodging.findUnique({ where: { id: hasCoords.id } }))?.lat).toBeCloseTo(
      1,
      3
    );
    expect((await prisma.lodging.findUnique({ where: { id: nameOnly.id } }))?.lat).toBeCloseTo(
      52.5,
      3
    );
    // Ten round-trips against a containerised Postgres: three creates, the
    // service's own reads and updates, then three verifying reads. Measured at
    // 6.0 s on a Windows/Docker dev database, i.e. just over the 5 s default,
    // so this test failed the gate on timing alone while asserting correctly.
    // The neighbours in this file swing ~40% with machine load; raising only
    // the heaviest one keeps that pressure visible instead of hiding it behind
    // a file-wide default.
  }, 15000);

  it("leaves a row pin-less when the geocoder finds nothing — and never throws", async () => {
    geocodeAddress.mockResolvedValue(null);
    const row = await prisma.lodging.create({
      data: { userId, name: "Unfindable", city: "Atlantis" },
    });

    const result = await backfillMissingCoordinates(userId);

    expect(result.attempted).toBe(1);
    expect(result.filled).toBe(0);
    expect((await prisma.lodging.findUnique({ where: { id: row.id } }))?.lat).toBeNull();
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
      )?.lat
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
      expect((await prisma.lodging.findUnique({ where: { id: otherLodging.id } }))?.lat).toBeNull();
    } finally {
      await prisma.lodging.deleteMany({ where: { userId: otherUser.id } });
      await prisma.importBatch.deleteMany({
        where: { userId: otherUser.id },
      });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  /**
   * AUD-061. The guard against a same-named hotel in the wrong town was added
   * for the Google tier. Photon is the PREFERRED tier and bypassed it entirely,
   * because the city and country it had already normalized were dropped on the
   * way into `ResolvedCoordinates`. A Berlin row took a pin in Rome and kept
   * its German address, so the card read Germany and the map showed Italy with
   * nothing marked as wrong.
   */
  it("discards a photon hit that lands in a different place than the row says", async () => {
    searchPlaces.mockResolvedValue([
      {
        name: "Hotel Sankt Martin",
        type: "hotel",
        lat: 41.9,
        lon: 12.5,
        city: "Roma",
        country: "Italia",
      },
    ]);
    geocodeAddress.mockResolvedValue(null);

    const row = await prisma.lodging.create({
      data: { userId, name: "Hotel Sankt Martin", city: "Berlin", country: "Deutschland" },
    });

    const result = await backfillMissingCoordinates(userId);

    expect(result.filled).toBe(0);
    const after = await prisma.lodging.findUnique({ where: { id: row.id } });
    expect(after?.lat).toBeNull();
    // And it fell THROUGH rather than stopping: the next tier was asked.
    expect(geocodeAddress).toHaveBeenCalled();
  });

  it("keeps a photon hit that agrees with the row", async () => {
    // The control — otherwise the fix could be "never trust photon".
    searchPlaces.mockResolvedValue([
      {
        name: "Hotel Adlon",
        type: "hotel",
        lat: 52.516,
        lon: 13.38,
        city: "Berlin",
        country: "Deutschland",
      },
    ]);

    const row = await prisma.lodging.create({
      data: { userId, name: "Hotel Adlon", city: "Berlin", country: "Deutschland" },
    });

    await backfillMissingCoordinates(userId);

    const after = await prisma.lodging.findUnique({ where: { id: row.id } });
    expect(after?.lat).toBeCloseTo(52.516, 3);
  });

  /**
   * AUD-070. The batch was ordered by `createdAt` and capped, so the same
   * oldest rows were handed to the geocoder on every run. Once a capful of
   * permanently unresolvable ones sat at the front, a row added afterwards was
   * never reached — not slowly, never.
   *
   * Asserted as the ORDER the rows are offered in rather than by building a
   * capful of them: the cap only bites because the order never changes, and an
   * order test says that in three rows instead of five hundred.
   */
  it("offers a never-tried row before ones that already had their turn", async () => {
    geocodeAddress.mockResolvedValue(null);

    const older = await prisma.lodging.create({
      data: { userId, name: "Older", city: "Nirgendwo" },
    });
    await prisma.lodging.create({ data: { userId, name: "Second", city: "Nirgendwo" } });

    await backfillMissingCoordinates(userId);
    // Both had their turn, and both are stamped — including the one that
    // resolved to nothing, which is the point: a failure that left the row
    // unstamped would keep it at the head of the queue for ever.
    const stamped = await prisma.lodging.findUnique({ where: { id: older.id } });
    expect(stamped?.geocodeAttemptedAt).not.toBeNull();

    // A row created afterwards is the LEAST recently tried: never.
    await prisma.lodging.create({ data: { userId, name: "Latecomer", city: "Berlin" } });

    geocodeAddress.mockClear();
    await backfillMissingCoordinates(userId);

    const order = geocodeAddress.mock.calls.map((c) => (c[0] as { name: string }).name);
    // Ordered by `createdAt` it would have come last, behind everything older.
    expect(order[0]).toBe("Latecomer");
  });
});

/**
 * AUD-063. The guard that keeps a same-named hotel in the wrong town out of
 * the database, checked on the two ways it got the comparison wrong.
 */
describe("agreesWithRow", () => {
  const found = (over: Record<string, unknown> = {}) => ({
    lat: 1,
    lon: 2,
    source: "google" as const,
    ...over,
  });

  it("accepts an ISO code against the country's name", () => {
    // `CN` and `China` share no substring, so a word comparison rejected a
    // perfectly good Beijing hit and the hotel stayed unlocated.
    expect(
      agreesWithRow(
        { name: "Hotel", type: "hotel", chainId: null, address: null, city: "北京", country: "CN" },
        found({ city: "北京", countryName: "China" })
      )
    ).toBe(true);
  });

  it("rejects two different non-Latin cities in the same country", () => {
    // Tokyo against Osaka. Both normalized to the empty string under an ASCII
    // filter, and two empty strings compare equal — so every non-Latin city
    // agreed with every other one.
    //
    // The country is spelled the SAME WAY on both sides on purpose. Written as
    // `JP` against `Japan` this test passed even with the fix reverted — the
    // country comparison failed first and the city never decided anything.
    expect(
      agreesWithRow(
        {
          name: "Hotel",
          type: "hotel",
          chainId: null,
          address: null,
          city: "東京",
          country: "Japan",
        },
        found({ city: "大阪", countryName: "Japan" })
      )
    ).toBe(false);
  });

  it("still accepts the same non-Latin city", () => {
    expect(
      agreesWithRow(
        {
          name: "Hotel",
          type: "hotel",
          chainId: null,
          address: null,
          city: "東京",
          country: "Japan",
        },
        found({ city: "東京", countryName: "Japan" })
      )
    ).toBe(true);
  });

  it("still rejects a Latin mismatch, and still accepts Rom/Roma", () => {
    const subject = (city: string, country: string) => ({
      name: "Hotel",
      type: "hotel",
      chainId: null,
      address: null,
      city,
      country,
    });
    expect(
      agreesWithRow(
        subject("Berlin", "Deutschland"),
        found({ city: "Roma", countryName: "Italia" })
      )
    ).toBe(false);
    expect(
      agreesWithRow(subject("Rom", "Italien"), found({ city: "Roma", countryName: "Italy" }))
    ).toBe(true);
  });

  it("accepts a row that says nothing about where it is", () => {
    expect(
      agreesWithRow(
        { name: "Hotel", type: "hotel", chainId: null, address: null, city: null, country: null },
        found({ city: "Roma", countryName: "Italy" })
      )
    ).toBe(true);
  });
});
