import { findLodgingPlace } from "../googlePlaces";
import { getApiKey } from "../../apiKeyResolver";

jest.mock("../../apiKeyResolver", () => ({ getApiKey: jest.fn() }));

const mockedKey = getApiKey as jest.MockedFunction<typeof getApiKey>;
const answer = (body: unknown, ok = true): void => {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;
};

const place = (primaryType: string) => ({
  places: [
    {
      displayName: { text: "JI Hotel Shanghai Railway Station West Tianmu Road" },
      primaryType,
      location: { latitude: 31.24477, longitude: 121.45181 },
      shortFormattedAddress: "1001 Chang An Lu, Zhabei Qu",
      addressComponents: [
        { longText: "Shanghai", types: ["locality"] },
        { longText: "China", types: ["country"] },
      ],
    },
  ],
});

describe("Google Places tier", () => {
  afterEach(() => jest.resetAllMocks());

  it("stays out of the way entirely when no key is configured", async () => {
    mockedKey.mockResolvedValue(null);
    global.fetch = jest.fn() as unknown as typeof fetch;

    expect(await findLodgingPlace("JI Hotel Shanghai")).toBeNull();
    // Not merely "no result" — it must not call out at all.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the hotel with our own type vocabulary", async () => {
    mockedKey.mockResolvedValue("test-key");
    answer(place("hotel"));

    const hit = await findLodgingPlace("JI Hotel Shanghai Railway Station West Tianmu Road");

    expect(hit).toEqual({
      lat: 31.24477,
      lon: 121.45181,
      type: "hotel",
      name: "JI Hotel Shanghai Railway Station West Tianmu Road",
      city: "Shanghai",
      country: "China",
      address: "1001 Chang An Lu, Zhabei Qu",
    });
  });

  it("maps a campground onto our campsite, so a KOA stops being a hotel", async () => {
    mockedKey.mockResolvedValue("test-key");
    answer(place("rv_park"));
    expect((await findLodgingPlace("Needles KOA Journey"))?.type).toBe("campsite");
  });

  it("DISCARDS a match that is not a place to sleep", async () => {
    // The whole reason this tier has a type table: the keyless tier answered
    // "Thon Hotel Halden" with a charging station, and a wrong pin that looks
    // right is worse than no pin. A restaurant is a real answer to the wrong
    // question.
    mockedKey.mockResolvedValue("test-key");
    answer(place("restaurant"));
    expect(await findLodgingPlace("Hotel Restaurant Gruber")).toBeNull();
  });

  it("never throws, whatever comes back", async () => {
    mockedKey.mockResolvedValue("test-key");

    answer({ places: [{ location: { latitude: "nope" } }] });
    expect(await findLodgingPlace("Kaputt")).toBeNull();

    answer({ error: { status: "PERMISSION_DENIED" } }, false);
    expect(await findLodgingPlace("Abgelehnt")).toBeNull();

    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    expect(await findLodgingPlace("Offline")).toBeNull();
  });
});
