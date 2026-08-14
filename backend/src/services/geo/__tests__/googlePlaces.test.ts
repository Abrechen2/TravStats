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
        { longText: "Shanghai", shortText: "Shanghai", types: ["locality"] },
        { longText: "China", shortText: "CN", types: ["country"] },
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
      chainName: null,
      countryCode: "CN",
    });
  });

  it("asks for German, because a Shanghai address in Chinese is unreadable here", async () => {
    mockedKey.mockResolvedValue("test-key");
    answer(place("hotel"));

    await findLodgingPlace("JI Hotel Shanghai");

    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    ) as { languageCode?: string };
    expect(body.languageCode).toBe("de");
  });

  it("reports the country as an ISO code — a flag cannot be drawn from \"China\"", async () => {
    mockedKey.mockResolvedValue("test-key");
    answer(place("hotel"));
    expect((await findLodgingPlace("JI Hotel Shanghai"))?.countryCode).toBe("CN");
  });

  it("reads the chain off the hotel's own website, which the NAME does not carry", async () => {
    mockedKey.mockResolvedValue("test-key");
    const withSite = place("hotel");
    withSite.places[0] = {
      ...withSite.places[0],
      websiteUri: "https://www.ihg.com/garner/hotels/de/de/erlangen",
    } as typeof withSite.places[0];
    answer(withSite);

    expect((await findLodgingPlace("Garner Hotel Erlangen Süd by IHG"))?.chainName).toBe("IHG");
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
