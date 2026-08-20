jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
}));

import http from "http";
import { AddressInfo } from "net";
import { searchPlaces } from "../photon";
import { resolveGeocoderUrls } from "../../instanceSettingsService";

const mockResolveGeocoderUrls = resolveGeocoderUrls as jest.Mock;

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const featureCollection = (features: unknown[]) => ({
  type: "FeatureCollection",
  features,
});

const zurichFeature = {
  properties: {
    name: "Zürich",
    street: "Bahnhofstrasse",
    housenumber: "1",
    city: "Zürich",
    country: "Switzerland",
    countrycode: "CH",
    osm_value: "city",
  },
  geometry: { coordinates: [8.5417, 47.3769] }, // [lon, lat]
};

describe("Photon place search", () => {
  const realFetch = global.fetch;
  const realTimeoutEnv = process.env.PHOTON_SEARCH_TIMEOUT_MS;
  const realMaxBytesEnv = process.env.PHOTON_SEARCH_MAX_BYTES;

  beforeEach(() => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.openstreetmap.org",
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
    if (realTimeoutEnv === undefined)
      delete process.env.PHOTON_SEARCH_TIMEOUT_MS;
    else process.env.PHOTON_SEARCH_TIMEOUT_MS = realTimeoutEnv;
    if (realMaxBytesEnv === undefined)
      delete process.env.PHOTON_SEARCH_MAX_BYTES;
    else process.env.PHOTON_SEARCH_MAX_BYTES = realMaxBytesEnv;
  });

  it("normalizes a feature, respecting GeoJSON [lon, lat] coordinate order", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([zurichFeature])));
    const results = await searchPlaces("Zürich");
    expect(results).toEqual([
      {
        name: "Zürich",
        address: "Bahnhofstrasse 1",
        city: "Zürich",
        country: "Switzerland",
        countryCode: "CH",
        lat: 47.3769,
        lon: 8.5417,
        type: "city",
      },
    ]);
  });

  it("skips features without a name or without coordinates", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              properties: { city: "No Name" },
              geometry: { coordinates: [1, 2] },
            },
            { properties: { name: "No Coords" }, geometry: {} },
            {
              properties: { name: "Bad Coords" },
              geometry: { coordinates: [1] },
            },
            zurichFeature,
          ]),
        ),
      );
    const results = await searchPlaces("test");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Zürich");
  });

  it("rejects a query shorter than 2 characters without any network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await searchPlaces("a")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades to [] on a non-200 response", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 503));
    expect(await searchPlaces("Berlin")).toEqual([]);
  });

  it("degrades to [] when the response body is not valid JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "<html>not json</html>",
    } as unknown as Response);
    expect(await searchPlaces("Berlin")).toEqual([]);
  });

  it("degrades to [] on a garbage/wrong-shape JSON response", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ features: "not-an-array" }));
    expect(await searchPlaces("Berlin")).toEqual([]);
  });

  it("degrades to [] when the response exceeds the size cap", async () => {
    process.env.PHOTON_SEARCH_MAX_BYTES = "10";
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([zurichFeature])));
    expect(await searchPlaces("Berlin")).toEqual([]);
  });

  it("degrades to [] on a network error (never throws)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network"));
    await expect(searchPlaces("Berlin")).resolves.toEqual([]);
  });

  it("degrades to [] when resolveGeocoderUrls rejects, falling back to the default URL", async () => {
    mockResolveGeocoderUrls.mockRejectedValue(new Error("DB down"));
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([zurichFeature])));
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await searchPlaces("Berlin");
    expect(results).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/photon\.komoot\.io\/api\/\?/);
  });

  it("honors the PHOTON_URL env tier (not the public default) when resolveGeocoderUrls rejects", async () => {
    const realEnv = process.env.PHOTON_URL;
    process.env.PHOTON_URL = "https://photon.env-configured.example";
    try {
      mockResolveGeocoderUrls.mockRejectedValue(new Error("DB down"));
      const fetchMock = jest
        .fn()
        .mockResolvedValue(jsonResponse(featureCollection([zurichFeature])));
      global.fetch = fetchMock as unknown as typeof fetch;
      const results = await searchPlaces("Berlin");
      expect(results).toHaveLength(1);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toMatch(
        /^https:\/\/photon\.env-configured\.example\/api\/\?/,
      );
    } finally {
      if (realEnv === undefined) delete process.env.PHOTON_URL;
      else process.env.PHOTON_URL = realEnv;
    }
  });

  it("searches against the instance-configured Photon URL, not a hardcoded host", async () => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.self-hosted.example",
      nominatimUrl: "https://nominatim.openstreetmap.org",
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([zurichFeature])));
    global.fetch = fetchMock as unknown as typeof fetch;
    await searchPlaces("Berlin");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/photon\.self-hosted\.example\/api\/\?/);
  });

  it("passes q, limit and lang as query params", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([])));
    global.fetch = fetchMock as unknown as typeof fetch;
    await searchPlaces("Berlin", { limit: 3, lang: "de" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("q")).toBe("Berlin");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.searchParams.get("lang")).toBe("de");
  });

  it("enforces a REAL wall-clock deadline against a server that trickles bytes (never an idle timer)", async () => {
    global.fetch = realFetch; // use the real fetch against a local server
    process.env.PHOTON_SEARCH_TIMEOUT_MS = "100";

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Trickle one byte at a time, well past the 100ms deadline. A naive
      // `req.setTimeout()` idle-timer would keep resetting on every byte
      // and never fire; AbortSignal.timeout must fire regardless.
      const body = JSON.stringify(featureCollection([zurichFeature]));
      let i = 0;
      const interval = setInterval(() => {
        if (i >= body.length) {
          clearInterval(interval);
          res.end();
          return;
        }
        res.write(body[i]);
        i += 1;
      }, 50);
      req.on("close", () => clearInterval(interval));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: `http://127.0.0.1:${port}`,
      nominatimUrl: "https://nominatim.openstreetmap.org",
    });

    const start = Date.now();
    const results = await searchPlaces("Berlin");
    const elapsed = Date.now() - start;

    expect(results).toEqual([]);
    // Well under the time it would take the trickling body to finish
    // (20+ chars * 50ms = 1000ms+), proving the deadline actually fired.
    expect(elapsed).toBeLessThan(1000);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 10_000);

  // ——— #263: the OSM path returned nothing on some self-hosted instances ———

  it("sends a descriptive User-Agent (anonymous requests are what OSM infrastructure blocks)", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([zurichFeature])));
    global.fetch = fetchMock;

    await searchPlaces("Zürich");

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringContaining("TravStats"),
    });
  });

  it("strips a trailing /api from an admin-entered base URL instead of requesting /api/api/", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([])));
    global.fetch = fetchMock;
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.example.com/api",
      nominatimUrl: "https://nominatim.openstreetmap.org",
    });

    await searchPlaces("Berlin");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("https://photon.example.com/api/?");
    expect(url).not.toContain("/api/api/");
  });

  it("retries once without lang when the lang-bearing request fails at HTTP level", async () => {
    // Public Photon rejects unsupported languages with an HTTP error — a UI
    // language like "pt" used to make EVERY typeahead search silently empty.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 400))
      .mockResolvedValueOnce(jsonResponse(featureCollection([zurichFeature])));
    global.fetch = fetchMock;

    const results = await searchPlaces("Zürich", { lang: "pt" });

    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("lang=pt");
    expect(fetchMock.mock.calls[1][0]).not.toContain("lang=");
  });

  it("does not retry a network failure without lang (would double the timeout for nothing)", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    global.fetch = fetchMock;

    const results = await searchPlaces("Zürich", { lang: "pt" });

    expect(results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks a geocoder failure as degraded, and a clean zero-hit search as not degraded", async () => {
    const { searchPlacesDetailed } = await import("../photon");

    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 503));
    const failed = await searchPlacesDetailed("Berlin");
    expect(failed).toEqual({ results: [], degraded: true });

    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection([])));
    const empty = await searchPlacesDetailed("Berlin");
    expect(empty).toEqual({ results: [], degraded: false });
  });
});
