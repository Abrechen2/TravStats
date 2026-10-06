jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
}));

import { REVERSE_CANDIDATE_POOL, reversePlacesDetailed } from "../photon";
import { PLACE_RANK } from "../placeImportance";
import { resolveGeocoderUrls } from "../../instanceSettingsService";

const mockResolveGeocoderUrls = resolveGeocoderUrls as jest.Mock;

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const hotelFeature = {
  properties: {
    name: "Hotel Adlon Kempinski",
    street: "Unter den Linden",
    housenumber: "77",
    city: "Berlin",
    country: "Deutschland",
    countrycode: "DE",
    osm_key: "tourism",
    osm_value: "hotel",
  },
  geometry: { coordinates: [13.3803, 52.5163] }, // [lon, lat]
};

/**
 * Photon reverse with limit>1 — the "what is HERE?" list behind the map-pick
 * modal's POI selection (owner request 2026-08-21, Google-Maps-like). Same
 * never-throws / degraded contract as the forward search.
 */
describe("Photon reverse places", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.openstreetmap.org",
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it("queries /reverse with lat, lon and the candidate pool, and normalizes the features", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ type: "FeatureCollection", features: [hotelFeature] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await reversePlacesDetailed(52.5163, 13.3803, { limit: 5 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/reverse");
    expect(url.searchParams.get("lat")).toBe("52.5163");
    expect(url.searchParams.get("lon")).toBe("13.3803");
    // Photon is asked for the whole pool, not for `limit`: ranking the nearest
    // five would rank the wrong five (forgejo#209).
    expect(url.searchParams.get("limit")).toBe(String(REVERSE_CANDIDATE_POOL));
    // No radius asked for = none sent = Photon's own 1 km, as before.
    expect(url.searchParams.has("radius")).toBe(false);

    expect(outcome.degraded).toBe(false);
    expect(outcome.results).toEqual([
      {
        name: "Hotel Adlon Kempinski",
        address: "Unter den Linden 77",
        city: "Berlin",
        country: "Deutschland",
        countryCode: "DE",
        lat: 52.5163,
        lon: 13.3803,
        type: "hotel",
        rank: PLACE_RANK.MIDDLE,
      },
    ]);
  });

  describe("ranking (forgejo#209)", () => {
    const origin = { lat: 37.5796, lon: 126.977 };
    /** A hit `metres` due north of the origin. */
    const hit = (name: string, osmKey: string, osmValue: string, metres: number, id: number) => ({
      properties: {
        name,
        osm_key: osmKey,
        osm_value: osmValue,
        type: "house",
        osm_type: "N",
        osm_id: id,
        city: "Berlin",
        countrycode: "DE",
      },
      geometry: { coordinates: [origin.lon, origin.lat + metres / 111_195] },
    });
    // Photon's own order: nearest first.
    const nearestFirst = [
      hit("Bushaltestelle", "highway", "bus_stop", 50, 1),
      hit("Kiosk", "shop", "kiosk", 80, 2),
      hit("Café Mitte", "amenity", "cafe", 150, 3),
      hit("Bank", "amenity", "atm", 200, 4),
      hit("Stadtschloss", "historic", "castle", 400, 5),
      hit("Museum", "tourism", "museum", 300, 6),
    ];

    it("puts a palace 400 m away above a bus stop 50 m away; distance decides within a tier", async () => {
      global.fetch = jest.fn(async () =>
        jsonResponse({ features: nearestFirst })
      ) as unknown as typeof fetch;

      const outcome = await reversePlacesDetailed(origin.lat, origin.lon, { limit: 6 });

      expect(outcome.results.map((r) => [r.name, r.rank])).toEqual([
        ["Museum", PLACE_RANK.HIGH],
        ["Stadtschloss", PLACE_RANK.HIGH],
        ["Café Mitte", PLACE_RANK.MIDDLE],
        ["Bushaltestelle", PLACE_RANK.LOW],
        ["Kiosk", PLACE_RANK.LOW],
        ["Bank", PLACE_RANK.LOW],
      ]);
    });

    it("cuts the ranked pool to the limit, so a short list is the head of a long one", async () => {
      global.fetch = jest.fn(async () =>
        jsonResponse({ features: nearestFirst })
      ) as unknown as typeof fetch;

      const short = await reversePlacesDetailed(origin.lat, origin.lon, { limit: 2 });
      const long = await reversePlacesDetailed(origin.lat, origin.lon, { limit: 4 });

      expect(short.results.map((r) => r.name)).toEqual(["Museum", "Stadtschloss"]);
      expect(long.results.slice(0, 2)).toEqual(short.results);
      expect(long.results).toHaveLength(4);
    });

    it("sends the radius to Photon in km", async () => {
      const fetchMock = jest.fn(async () => jsonResponse({ features: [] }));
      global.fetch = fetchMock as unknown as typeof fetch;

      await reversePlacesDetailed(origin.lat, origin.lon, { radiusKm: 2.5 });

      const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
      expect(url.searchParams.get("radius")).toBe("2.5");
    });

    it("keeps the Latin/local name merge and the rank on the ranked list", async () => {
      const palace = (name: string) => ({
        properties: {
          name,
          osm_key: "historic",
          osm_value: "castle",
          osm_type: "W",
          osm_id: 2,
          city: "Seoul",
          countrycode: "KR",
        },
        geometry: { coordinates: [126.977, 37.5799] },
      });
      const busStop = (name: string) => ({
        properties: {
          name,
          osm_key: "highway",
          osm_value: "bus_stop",
          osm_type: "N",
          osm_id: 9,
          city: "Seoul",
          countrycode: "KR",
        },
        geometry: { coordinates: [126.977, 37.5797] },
      });
      global.fetch = jest.fn(async (url: string) => {
        const english = new URL(url).searchParams.get("lang") === "en";
        return jsonResponse({
          features: [
            busStop(english ? "Gyeongbokgung Stop" : "경복궁 정류장"),
            palace(english ? "Gyeongbokgung Palace" : "경복궁"),
          ],
        });
      }) as unknown as typeof fetch;

      const outcome = await reversePlacesDetailed(37.5796, 126.977, { lang: "de", limit: 5 });

      expect(outcome.results).toEqual([
        expect.objectContaining({
          name: "Gyeongbokgung Palace",
          localName: "경복궁",
          rank: PLACE_RANK.HIGH,
        }),
        expect.objectContaining({
          name: "Gyeongbokgung Stop",
          localName: "경복궁 정류장",
          rank: PLACE_RANK.LOW,
        }),
      ]);
    });
  });

  it("rejects out-of-range coordinates without any network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await reversePlacesDetailed(91, 0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({ results: [], degraded: false });
  });

  it("marks a geocoder failure as degraded and never throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;

    const outcome = await reversePlacesDetailed(52, 13);

    expect(outcome).toEqual({ results: [], degraded: true });
  });

  it("forwards lang when given", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ type: "FeatureCollection", features: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await reversePlacesDetailed(52, 13, { lang: "de" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("lang")).toBe("de");
  });

  it("names a Seoul hit in Latin script and keeps its Hangul name (forgejo#199)", async () => {
    const palace = (name: string) => ({
      properties: {
        name,
        osm_type: "W",
        osm_id: 2,
        city: "Seoul",
        countrycode: "KR",
        osm_value: "castle",
      },
      geometry: { coordinates: [126.977, 37.5796] },
    });
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      const lang = new URL(url).searchParams.get("lang");
      const name = lang === "en" ? "Gyeongbokgung Palace" : "경복궁";
      return jsonResponse({ features: [palace(name)] });
    }) as unknown as typeof fetch;

    const outcome = await reversePlacesDetailed(37.5796, 126.977, { lang: "de", limit: 5 });

    expect(outcome.degraded).toBe(false);
    expect(outcome.results[0]).toMatchObject({ name: "Gyeongbokgung Palace", localName: "경복궁" });
    expect(urls.map((u) => new URL(u).searchParams.get("lang")).sort()).toEqual([
      "de",
      "default",
      "en",
    ]);
  });

  it("asks only once when every hit is already readable", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ features: [hotelFeature] })
    ) as unknown as typeof fetch;
    await reversePlacesDetailed(52.5163, 13.3803, { lang: "de", limit: 5 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("asks in English only once when English was the requested language", async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      const lang = new URL(url).searchParams.get("lang");
      return jsonResponse({
        features: [
          {
            properties: {
              name: lang === "en" ? "Red Square" : "Красная площадь",
              osm_type: "W",
              osm_id: 7,
              countrycode: "RU",
            },
            geometry: { coordinates: [37.6208, 55.7539] },
          },
        ],
      });
    }) as unknown as typeof fetch;
    const outcome = await reversePlacesDetailed(55.7539, 37.6208, { lang: "en", limit: 5 });
    expect(outcome.results[0]).toMatchObject({ name: "Red Square", localName: "Красная площадь" });
    expect(urls.map((u) => new URL(u).searchParams.get("lang")).sort()).toEqual(["default", "en"]);
  });
});
