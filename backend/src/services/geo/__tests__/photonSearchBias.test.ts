jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
}));

import { searchPlacesDetailed } from "../photon";
import { resolveGeocoderUrls } from "../../instanceSettingsService";

const mockResolveGeocoderUrls = resolveGeocoderUrls as jest.Mock;

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

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
  geometry: { coordinates: [126.977, 37.5796] },
});

/**
 * `/geo/search` with a location bias (forgejo#209): a name typed in Seoul
 * should find the palace nearby first. Photon does that itself given `lat`
 * and `lon`; this pins that they reach it — on the first request, on the
 * retry without `lang`, and on the name-merge lookups.
 */
describe("Photon search location bias", () => {
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

  it("sends lat and lon when a point is given", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ features: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPlacesDetailed("palace", { near: { lat: 37.5796, lon: 126.977 } });

    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/api/");
    expect(url.searchParams.get("lat")).toBe("37.5796");
    expect(url.searchParams.get("lon")).toBe("126.977");
    // Photon's defaults stand; nothing else is added.
    expect(url.searchParams.has("location_bias_scale")).toBe(false);
    expect(url.searchParams.has("zoom")).toBe(false);
  });

  it("sends no position without a point", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ features: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPlacesDetailed("palace", { lang: "de" });

    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.has("lat")).toBe(false);
    expect(url.searchParams.has("lon")).toBe(false);
  });

  it("keeps the bias on the lang retry and on the name-merge lookups", async () => {
    const urls: URL[] = [];
    global.fetch = jest.fn(async (raw: string) => {
      const url = new URL(raw);
      urls.push(url);
      const lang = url.searchParams.get("lang");
      if (lang === "pt") return jsonResponse({ message: "unsupported" }, 400);
      return jsonResponse({
        features: [palace(lang === "en" ? "Gyeongbokgung Palace" : "경복궁")],
      });
    }) as unknown as typeof fetch;

    const outcome = await searchPlacesDetailed("palace", {
      lang: "pt",
      near: { lat: 37.5796, lon: 126.977 },
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.results[0]).toMatchObject({ name: "Gyeongbokgung Palace", localName: "경복궁" });
    // A search is not ranked: no rank beside an order it did not decide.
    expect(outcome.results[0].rank).toBeUndefined();
    // pt (refused), retry without lang, then en + default for the names.
    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url.searchParams.get("lat")).toBe("37.5796");
      expect(url.searchParams.get("lon")).toBe("126.977");
    }
  });
});
