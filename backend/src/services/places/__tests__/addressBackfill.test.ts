jest.mock("../../geo/nominatim", () => ({
  completeAddressFromCoordinates: jest.fn(),
}));

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { completeAddressFromCoordinates } from "../../geo/nominatim";
import { completeMissingPlaceAddresses, completePlaceAddress } from "../addressBackfill";

const mockComplete = completeAddressFromCoordinates as jest.Mock;

/**
 * The rule this pass exists to keep: a place ends up with an address, and a
 * value the user supplied is never traded for one a geocoder guessed.
 *
 * The geocoder itself is mocked — its throttle, its parsing and its
 * fill-only-what-is-empty rule are covered next to it in services/geo. What is
 * under test here is which rows get fed to it and what is written back.
 */
describe("place address backfill", () => {
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["placeaddr", "placeaddr2"] } } });
    const user = await prisma.user.create({
      data: { username: "placeaddr", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    const other = await prisma.user.create({
      data: { username: "placeaddr2", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
  });

  beforeEach(async () => {
    mockComplete.mockReset();
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  afterAll(async () => {
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  const makePlace = (over: Record<string, unknown> = {}) =>
    prisma.place.create({
      data: {
        userId,
        name: "Machu Picchu",
        category: "landmark",
        lat: -13.1631,
        lon: -72.545,
        visited: true,
        ...over,
      },
    });

  it("fills a place that has a pin but no description", async () => {
    const place = await makePlace();
    mockComplete.mockResolvedValue({ address: "Camino Inca", city: "Cusco", country: "Peru" });

    expect(await completePlaceAddress(place.id)).toBe(true);

    const after = await prisma.place.findUnique({ where: { id: place.id } });
    expect(after?.address).toBe("Camino Inca");
    expect(after?.city).toBe("Cusco");
    expect(after?.country).toBe("Peru");
  });

  it("sets the ISO code alongside the country it just wrote", async () => {
    // A country name stored without its code is the state that leaves a place
    // out of every country filter and gives it no flag.
    const place = await makePlace();
    mockComplete.mockResolvedValue({ country: "Peru" });

    await completePlaceAddress(place.id);

    const after = await prisma.place.findUnique({ where: { id: place.id } });
    expect(after?.isoCountryCode).toBe("PE");
  });

  it("never overwrites what the user typed", async () => {
    const place = await makePlace({ address: "Meine eigene Adresse", city: "Meine Stadt" });
    // The geo helper is what enforces this, so it is handed the stored values
    // and returns only the genuinely missing field.
    mockComplete.mockResolvedValue({ country: "Peru" });

    await completePlaceAddress(place.id);

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({ address: "Meine eigene Adresse", city: "Meine Stadt" }),
    );
    const after = await prisma.place.findUnique({ where: { id: place.id } });
    expect(after?.address).toBe("Meine eigene Adresse");
    expect(after?.city).toBe("Meine Stadt");
  });

  it("writes nothing when the geocoder has nothing to add", async () => {
    const place = await makePlace({ address: "A", city: "B", country: "Peru" });
    mockComplete.mockResolvedValue(null);

    expect(await completePlaceAddress(place.id)).toBe(false);
  });

  it("does not throw when the geocoder fails — a bad row must not end the batch", async () => {
    await makePlace({ name: "Erster" });
    await makePlace({ name: "Zweiter" });
    mockComplete
      .mockRejectedValueOnce(new Error("geocoder down"))
      .mockResolvedValueOnce({ city: "Cusco" });

    const result = await completeMissingPlaceAddresses(userId);

    expect(result.attempted).toBe(2);
    expect(result.filled).toBe(1);
  });

  it("touches only the given user's places", async () => {
    await makePlace();
    await prisma.place.create({
      data: {
        userId: otherUserId,
        name: "Fremder Ort",
        category: "landmark",
        lat: 1,
        lon: 1,
        visited: true,
      },
    });
    mockComplete.mockResolvedValue({ city: "Cusco" });

    const result = await completeMissingPlaceAddresses(userId);

    expect(result.attempted).toBe(1);
    const foreign = await prisma.place.findFirst({ where: { userId: otherUserId } });
    expect(foreign?.city).toBeNull();
  });

  it("skips places that are already complete", async () => {
    await makePlace({ address: "A", city: "B", country: "Peru" });
    mockComplete.mockResolvedValue({ city: "X" });

    const result = await completeMissingPlaceAddresses(userId);

    // The WHERE never selects it, so the geocoder is not consulted at all.
    expect(result.attempted).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("respects the row limit", async () => {
    await makePlace({ name: "Eins" });
    await makePlace({ name: "Zwei" });
    await makePlace({ name: "Drei" });
    mockComplete.mockResolvedValue({ city: "Cusco" });

    const result = await completeMissingPlaceAddresses(userId, 2);

    expect(result.attempted).toBe(2);
  });
});
