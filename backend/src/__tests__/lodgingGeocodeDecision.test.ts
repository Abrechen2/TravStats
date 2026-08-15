import { resolveLocation } from "../routes/lodgingGeocode";
import * as geo from "../services/geo/nominatim";

jest.mock("../services/geo/nominatim", () => ({
  resolveCoordinates: jest.fn(),
  completeAddressFromCoordinates: jest.fn(),
}));

const resolveCoordinates = geo.resolveCoordinates as jest.MockedFunction<
  typeof geo.resolveCoordinates
>;
const completeAddress = geo.completeAddressFromCoordinates as jest.MockedFunction<
  typeof geo.completeAddressFromCoordinates
>;

/**
 * What a lodging's location becomes on a write.
 *
 * The rule these tests pin down is one the code was missing entirely: an
 * explicitly emptied field is an INSTRUCTION, not a gap to be filled. Without
 * it, clearing a wrong address handed the user a different wrong address —
 * observed in the browser on a house called "Hotel Sankt Martin", which came
 * back as Frankenwerft 31 in Cologne with a pin to match.
 */
describe("resolveLocation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveCoordinates.mockResolvedValue(null);
    completeAddress.mockResolvedValue(null);
  });

  const stored = {
    name: "Hotel Sankt Martin",
    address: "Hauptstr. 1",
    city: "St. Martin",
    country: "Deutschland",
    lat: 49.3,
    lon: 8.1,
  };

  describe("removing a location", () => {
    // The bug, in one test: the user empties every address field, and the app
    // answers with an address it invented from the name alone.
    it("does not geocode when address, city and country are all cleared", async () => {
      const patch = await resolveLocation(
        { name: stored.name, address: null, city: null, country: null, lat: null, lon: null },
        stored,
      );

      expect(resolveCoordinates).not.toHaveBeenCalled();
      expect(patch.lat).toBeUndefined();
      expect(patch.lon).toBeUndefined();
    });

    it("never refills a field the user just emptied", async () => {
      // Even if a reverse lookup were to answer, an explicit null wins.
      completeAddress.mockResolvedValue({
        address: "Frankenwerft 31",
        city: "Köln",
        country: "Deutschland",
      });

      const patch = await resolveLocation(
        { name: stored.name, address: null, city: null, country: null },
        stored,
      );

      expect(patch.address).toBeUndefined();
      expect(patch.city).toBeUndefined();
      expect(patch.country).toBeUndefined();
    });

    // Deliberately a case where a lookup WOULD run — the address changed — so
    // this proves the explicit null wins rather than passing because nothing
    // was looked up at all.
    it("does not put a pin back when the user removed it", async () => {
      resolveCoordinates.mockResolvedValue({ lat: 50.9, lon: 6.9 });

      const patch = await resolveLocation(
        { name: stored.name, address: "Eine andere Strasse 5", lat: null, lon: null },
        stored,
      );

      expect(patch.lat).toBeUndefined();
      expect(patch.lon).toBeUndefined();
    });
  });

  describe("a name is not a location", () => {
    // The same mistake that put a Bavarian hotel in Rome, made by the app
    // itself: with nothing but a name to go on, the first hit wins.
    it("refuses to geocode a new lodging that has only a name", async () => {
      await resolveLocation({ name: "Hotel St. Martin" });
      expect(resolveCoordinates).not.toHaveBeenCalled();
    });

    it("still geocodes a name once there is a city to place it in", async () => {
      await resolveLocation({ name: "Hotel St. Martin", city: "Marktoberdorf" });
      expect(resolveCoordinates).toHaveBeenCalled();
    });
  });

  describe("what must keep working", () => {
    it("geocodes a changed address", async () => {
      resolveCoordinates.mockResolvedValue({ lat: 48.1, lon: 11.6 });

      const patch = await resolveLocation({ address: "Marienplatz 1", city: "München" }, stored);

      expect(resolveCoordinates).toHaveBeenCalled();
      expect(patch).toMatchObject({ lat: 48.1, lon: 11.6 });
    });

    // A row whose first geocode failed must get another chance on any save —
    // that is why the "no coordinates yet" branch exists.
    it("retries a row that has an address but never got a pin", async () => {
      resolveCoordinates.mockResolvedValue({ lat: 48.1, lon: 11.6 });

      const patch = await resolveLocation(
        { notes: "unrelated edit" } as never,
        { ...stored, lat: null, lon: null },
      );

      expect(resolveCoordinates).toHaveBeenCalled();
      expect(patch.lat).toBe(48.1);
    });

    it("fills an address field the request did not mention", async () => {
      completeAddress.mockResolvedValue({ address: "Hauptstr. 1", city: "St. Martin", country: null });

      const patch = await resolveLocation({ lat: 49.3, lon: 8.1 }, { ...stored, city: null });

      expect(patch.city).toBe("St. Martin");
    });
  });
});
