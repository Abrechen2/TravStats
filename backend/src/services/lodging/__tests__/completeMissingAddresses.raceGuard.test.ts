/**
 * The reverse pass must not write over something the user typed while it was
 * waiting for the geocoder.
 *
 * Reproduced by the 2026-09-19 integrity audit: the pass read a pinned lodging
 * with no address, asked Nominatim, and — seconds later — wrote "Spandauer
 * Straße" over the `USER-TYPED-DO-NOT-OVERWRITE` that had been saved in the
 * meantime. The forward pass has had the guard since AUD-062 (`updateMany
 * where lat/lon null`); the reverse pass wrote an unconditional `update`.
 *
 * The geocoder mock is what makes the window real: it performs the user's save
 * before it resolves, so the row genuinely changes between the read and the
 * write. A test that simply pre-set the field would prove nothing — the pass
 * would never have selected the row.
 */
import { prisma } from "../../../db";
import { completeMissingAddresses } from "../geocodeBackfill";

const reverseGeocode = jest.fn();
jest.mock("../../geo/nominatim", () => ({
  geocodeAddress: jest.fn(),
  reverseGeocode: (lat: number, lon: number) => reverseGeocode(lat, lon),
}));

const GEOCODER_ANSWER = {
  address: "Spandauer Straße 1",
  city: "Berlin",
  country: "Deutschland",
};

describe("completeMissingAddresses — a value typed during the lookup survives", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `lodging-address-race-${Date.now()}`, passwordHash: "x" },
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

  /** A pinned lodging with nothing but coordinates. */
  async function pinnedHouse(name: string) {
    return prisma.lodging.create({
      data: { userId, name, type: "hotel", lat: 52.5219, lon: 13.4132 },
    });
  }

  it("leaves an address the user saved mid-lookup alone", async () => {
    const house = await pinnedHouse("Pin ohne Adresse");
    reverseGeocode.mockImplementation(async () => {
      // The window: the user is editing while the geocoder is out.
      await prisma.lodging.update({
        where: { id: house.id },
        data: { address: "USER-TYPED-DO-NOT-OVERWRITE" },
      });
      return GEOCODER_ANSWER;
    });

    const result = await completeMissingAddresses(userId);

    const after = await prisma.lodging.findUnique({ where: { id: house.id } });
    expect(after?.address).toBe("USER-TYPED-DO-NOT-OVERWRITE");
    // The two fields the user did NOT touch are still filled — a correction to
    // one field must not cost the row the rest of the answer.
    expect(after?.city).toBe("Berlin");
    expect(after?.country).toBe("Deutschland");
    expect(result).toEqual({ attempted: 1, filled: 1 });
  });

  it("counts a row as unfilled when every field was superseded", async () => {
    const house = await pinnedHouse("Alles getippt");
    reverseGeocode.mockImplementation(async () => {
      await prisma.lodging.update({
        where: { id: house.id },
        data: { address: "Meine Adresse", city: "Meine Stadt", country: "Mein Land" },
      });
      return GEOCODER_ANSWER;
    });

    const result = await completeMissingAddresses(userId);

    const after = await prisma.lodging.findUnique({ where: { id: house.id } });
    expect(after?.address).toBe("Meine Adresse");
    expect(after?.city).toBe("Meine Stadt");
    expect(after?.country).toBe("Mein Land");
    // Attempted, not filled: nothing was written, and the counter says so.
    expect(result).toEqual({ attempted: 1, filled: 0 });
  });

  it("still replaces an unreadable value nobody has touched", async () => {
    // The guard is a compare-and-swap, not `address: null` — otherwise this
    // case, the whole reason the pass may replace rather than fill, would stop
    // working.
    const house = await prisma.lodging.create({
      data: {
        userId,
        name: "Unleserlich",
        type: "hotel",
        lat: 35.6895,
        lon: 139.6917,
        address: "東京都千代田区",
        city: "東京",
        country: "日本",
      },
    });
    reverseGeocode.mockResolvedValue({
      address: "1 Chiyoda",
      city: "Tokyo",
      country: "Japan",
    });

    const result = await completeMissingAddresses(userId);

    const after = await prisma.lodging.findUnique({ where: { id: house.id } });
    expect(after?.city).toBe("Tokyo");
    expect(after?.country).toBe("Japan");
    expect(result).toEqual({ attempted: 1, filled: 1 });
  });
});
