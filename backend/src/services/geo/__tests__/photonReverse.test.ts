jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
}));

import { reversePlacesDetailed } from "../photon";
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

  it("queries /reverse with lat, lon and limit, and normalizes the features", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ type: "FeatureCollection", features: [hotelFeature] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await reversePlacesDetailed(52.5163, 13.3803, { limit: 5 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/reverse");
    expect(url.searchParams.get("lat")).toBe("52.5163");
    expect(url.searchParams.get("lon")).toBe("13.3803");
    expect(url.searchParams.get("limit")).toBe("5");

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
      },
    ]);
  });

  it("rejects out-of-range coordinates without any network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const outcome = await reversePlacesDetailed(91, 0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({ results: [], degraded: false });
  });

  it("marks a geocoder failure as degraded and never throws", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("boom")) as unknown as typeof fetch;

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
});
