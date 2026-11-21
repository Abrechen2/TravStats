import { prisma } from "../db";
import { backfillMissingCoordinates } from "../services/lodging/geocodeBackfill";
import { flagPinCountryContradictions } from "../services/lodging/locationCheck";
import { resolveLocation } from "../routes/lodgingGeocode";

const geocodeAddressDetailed = jest.fn();
const resolveCoordinates = jest.fn();
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddressDetailed: (parts: unknown) => geocodeAddressDetailed(parts),
  resolveCoordinates: (input: unknown) => resolveCoordinates(input),
  completeAddressFromCoordinates: jest.fn().mockResolvedValue(null),
  reverseGeocode: jest.fn().mockResolvedValue(null),
}));
const searchPlacesDetailed = jest.fn();
jest.mock("../services/geo/photon", () => ({
  searchPlacesDetailed: (...args: unknown[]) => searchPlacesDetailed(...args),
}));
const findLodgingPlace = jest.fn();
jest.mock("../services/geo/googlePlaces", () => ({
  findLodgingPlace: (...args: unknown[]) => findLodgingPlace(...args),
}));

// GitHub #401: "Tulip Inn Wolfenbuettel" (stay 2009-09-21..22) was pinned near
// Delhi, read "Library Bazaar, Indien" and carried the Indian flag, because a
// name search found the Indian "Tulip Inn" and nothing checked it against what
// the booking said.
const DELHI = { lat: 28.61, lon: 77.21 };
const WOLFENBUETTEL = { lat: 52.16, lon: 10.54 };

describe("lodging geocode plausibility (GitHub #401)", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "lodging-geocode-plausible-test", passwordHash: "x" },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    geocodeAddressDetailed.mockReset().mockResolvedValue({ coords: null, failed: false });
    resolveCoordinates.mockReset().mockResolvedValue(null);
    searchPlacesDetailed.mockReset().mockResolvedValue({ results: [], degraded: false });
    findLodgingPlace.mockReset().mockResolvedValue(null);
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const create = (data: Record<string, unknown>) =>
    prisma.lodging.create({
      data: { userId, name: "Tulip Inn Wolfenbuettel", ...data } as never,
    });
  const reload = (id: string) => prisma.lodging.findUniqueOrThrow({ where: { id } });

  describe("backfill", () => {
    it("does not pin a Wolfenbüttel hotel at a Nominatim hit in India", async () => {
      geocodeAddressDetailed.mockResolvedValue({
        coords: { ...DELHI, countryCode: "IN", country: "India", city: "New Delhi" },
        failed: false,
      });
      const row = await create({ city: "Wolfenbüttel", country: "Deutschland" });

      const result = await backfillMissingCoordinates(userId);

      const after = await reload(row.id);
      expect(result.filled).toBe(0);
      expect(after.lat).toBeNull();
      expect(after.lon).toBeNull();
      expect(after.locationCheck).toBe("contradicted");
    });

    it("does not pin at a Photon lodging hit in India either", async () => {
      searchPlacesDetailed.mockResolvedValue({
        results: [{ name: "Tulip Inn", type: "hotel", ...DELHI, city: "Delhi", country: "India" }],
        degraded: false,
      });
      const row = await create({ city: "Wolfenbüttel", country: "DE" });

      await backfillMissingCoordinates(userId);

      const after = await reload(row.id);
      expect(after.lat).toBeNull();
      expect(after.locationCheck).toBe("contradicted");
    });

    it("pins a hit that agrees with the stated country and town, and clears an old note", async () => {
      geocodeAddressDetailed.mockResolvedValue({
        coords: {
          ...WOLFENBUETTEL,
          countryCode: "DE",
          country: "Deutschland",
          city: "Wolfenbüttel",
        },
        failed: false,
      });
      const row = await create({
        city: "Wolfenbüttel",
        country: "Deutschland",
        locationCheck: "provider_unavailable",
      });

      const result = await backfillMissingCoordinates(userId);

      const after = await reload(row.id);
      expect(result.filled).toBe(1);
      expect(after.lat).toBeCloseTo(WOLFENBUETTEL.lat);
      expect(after.locationCheck).toBeNull();
    });

    it("applies no name-only hit: a bare name is not a place", async () => {
      geocodeAddressDetailed.mockResolvedValue({ coords: DELHI, failed: false });
      const row = await create({});

      const result = await backfillMissingCoordinates(userId);

      const after = await reload(row.id);
      expect(result.filled).toBe(0);
      expect(geocodeAddressDetailed).not.toHaveBeenCalled();
      expect(searchPlacesDetailed).not.toHaveBeenCalled();
      expect(after.lat).toBeNull();
      expect(after.locationCheck).toBe("name_only");
    });

    it("names a provider outage as such, not as 'no result'", async () => {
      geocodeAddressDetailed.mockResolvedValue({ coords: null, failed: true });
      const row = await create({ city: "Wolfenbüttel", country: "Deutschland" });

      await backfillMissingCoordinates(userId);

      expect((await reload(row.id)).locationCheck).toBe("provider_unavailable");
    });

    it("names an empty answer 'no_result' when every provider answered", async () => {
      const row = await create({ city: "Wolfenbüttel", country: "Deutschland" });

      await backfillMissingCoordinates(userId);

      expect((await reload(row.id)).locationCheck).toBe("no_result");
    });

    it("queries with the stated city and country", async () => {
      const row = await create({ city: "Wolfenbüttel", country: "Deutschland" });
      await backfillMissingCoordinates(userId);
      expect(geocodeAddressDetailed).toHaveBeenCalledWith(
        expect.objectContaining({ city: "Wolfenbüttel", country: "Deutschland" })
      );
      expect(row.id).toBeTruthy();
    });
  });

  describe("save (create / edit)", () => {
    it("drops a geocode that lands in another country than the one stated", async () => {
      resolveCoordinates.mockResolvedValue({ ...DELHI, countryCode: "IN", country: "India" });
      const patch = await resolveLocation({
        name: "Tulip Inn Wolfenbuettel",
        city: "Wolfenbüttel",
        country: "Deutschland",
      });
      expect(patch.lat).toBeUndefined();
      expect(patch.locationCheck).toBe("contradicted");
    });

    it("keeps a geocode that agrees and clears the note", async () => {
      resolveCoordinates.mockResolvedValue({ ...WOLFENBUETTEL, countryCode: "DE" });
      const patch = await resolveLocation({
        name: "Tulip Inn Wolfenbuettel",
        city: "Wolfenbüttel",
        country: "Deutschland",
      });
      expect(patch.lat).toBeCloseTo(WOLFENBUETTEL.lat);
      expect(patch.locationCheck).toBeNull();
    });

    it("notes a name-only create instead of leaving it silently unlocated", async () => {
      const patch = await resolveLocation({ name: "Tulip Inn Wolfenbuettel" });
      expect(patch.lat).toBeUndefined();
      expect(patch.locationCheck).toBe("name_only");
    });

    it("does not re-add a note the user dismissed", async () => {
      const patch = await resolveLocation(
        { locationCheck: "reviewed" },
        { name: "Tulip Inn Wolfenbuettel", lat: null, lon: null }
      );
      expect(patch.locationCheck).toBeUndefined();
    });
  });

  describe("detector for existing data", () => {
    it("flags a pin in another country than the stored one, and rewrites nothing", async () => {
      const wrong = await create({ ...DELHI, country: "Deutschland", city: "Wolfenbüttel" });
      const right = await create({ name: "Right", ...WOLFENBUETTEL, country: "Deutschland" });
      const reviewed = await create({
        name: "Reviewed",
        ...DELHI,
        country: "Deutschland",
        locationCheck: "reviewed",
      });

      const result = await flagPinCountryContradictions(userId);

      expect(result.flagged).toBe(1);
      const after = await reload(wrong.id);
      expect(after.locationCheck).toBe("pin_country_mismatch");
      expect(after.lat).toBeCloseTo(DELHI.lat);
      expect(after.country).toBe("Deutschland");
      expect((await reload(right.id)).locationCheck).toBeNull();
      expect((await reload(reviewed.id)).locationCheck).toBe("reviewed");
    });
  });
});
