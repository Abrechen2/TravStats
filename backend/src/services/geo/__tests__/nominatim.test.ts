jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
}));

import { geocodeAddress, resolveCoordinates } from "../nominatim";
import { resolveGeocoderUrls } from "../../instanceSettingsService";

const okResponse = (rows: unknown) => ({ ok: true, json: async () => rows }) as unknown as Response;

const mockResolveGeocoderUrls = resolveGeocoderUrls as jest.Mock;

describe("nominatim geocoder", () => {
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

  it("returns coordinates for an address", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "47.3769", lon: "8.5417" }])) as unknown as typeof fetch;
    const out = await geocodeAddress({ address: "Bahnhofstrasse 1", city: "Zürich", country: "CH" });
    expect(out).toEqual({ lat: 47.3769, lon: 8.5417 });
  });

  it("sends a descriptive User-Agent (Nominatim usage policy)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([{ lat: "1", lon: "2" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Berlin" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/TravStats/);
  });

  it("returns null on empty input without any network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await geocodeAddress({ address: "", city: null, country: null })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the API fails or finds nothing", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await geocodeAddress({ city: "Nowhere" })).toBeNull();
    global.fetch = jest.fn().mockResolvedValue(okResponse([])) as unknown as typeof fetch;
    expect(await geocodeAddress({ city: "Nowhere" })).toBeNull();
  });

  it("caches a repeated query (one network call)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([{ lat: "52.52", lon: "13.405" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Berlin", country: "DE" });
    await geocodeAddress({ city: "Berlin", country: "DE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never geocodes when the caller supplied coordinates", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await resolveCoordinates({ lat: 1, lon: 2, city: "Berlin" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches against the instance-configured Nominatim URL, not a hardcoded host", async () => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.self-hosted.example",
    });
    const fetchMock = jest.fn().mockResolvedValue(okResponse([{ lat: "10", lon: "20" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Configured City" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/nominatim\.self-hosted\.example\/search\?/);
  });

  it("isolates the cache by resolved URL so switching instances never serves a stale cross-instance result", async () => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.instance-a.example",
    });
    const fetchA = jest.fn().mockResolvedValue(okResponse([{ lat: "1", lon: "1" }]));
    global.fetch = fetchA as unknown as typeof fetch;
    const resultA = await geocodeAddress({ city: "Shared Query City" });
    expect(resultA).toEqual({ lat: 1, lon: 1 });
    expect(fetchA).toHaveBeenCalledTimes(1);

    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.instance-b.example",
    });
    const fetchB = jest.fn().mockResolvedValue(okResponse([{ lat: "2", lon: "2" }]));
    global.fetch = fetchB as unknown as typeof fetch;
    const resultB = await geocodeAddress({ city: "Shared Query City" });
    expect(resultB).toEqual({ lat: 2, lon: 2 });
    // A second network call was required — the cache key is not just the
    // query text, so instance B does not see instance A's cached coords.
    expect(fetchB).toHaveBeenCalledTimes(1);
  });
});
