jest.mock("../../instanceSettingsService", () => ({
  resolveGeocoderUrls: jest.fn(),
  DEFAULT_NOMINATIM_URL: "https://nominatim.openstreetmap.org",
  DEFAULT_PHOTON_URL: "https://photon.komoot.io",
}));

import {
  geocodeAddress,
  resolveCoordinates,
  reverseGeocode,
  completeAddressFromCoordinates,
} from "../nominatim";
import { resolveGeocoderUrls } from "../../instanceSettingsService";

const okResponse = (rows: unknown) =>
  ({ ok: true, json: async () => rows }) as unknown as Response;

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
      .mockResolvedValue(
        okResponse([{ lat: "47.3769", lon: "8.5417" }]),
      ) as unknown as typeof fetch;
    const out = await geocodeAddress({
      address: "Bahnhofstrasse 1",
      city: "Zürich",
      country: "CH",
    });
    expect(out).toEqual({ lat: 47.3769, lon: 8.5417 });
  });

  it("sends a descriptive User-Agent (Nominatim usage policy)", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "1", lon: "2" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Berlin" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(
      /TravStats/,
    );
  });

  it("returns null on empty input without any network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await geocodeAddress({ address: "", city: null, country: null }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the API fails or finds nothing", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await geocodeAddress({ city: "Nowhere" })).toBeNull();
    global.fetch = jest
      .fn()
      .mockResolvedValue(okResponse([])) as unknown as typeof fetch;
    expect(await geocodeAddress({ city: "Nowhere" })).toBeNull();
  });

  it("caches a repeated query (one network call)", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "52.52", lon: "13.405" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Berlin", country: "DE" });
    await geocodeAddress({ city: "Berlin", country: "DE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never geocodes when the caller supplied coordinates", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await resolveCoordinates({ lat: 1, lon: 2, city: "Berlin" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches against the instance-configured Nominatim URL, not a hardcoded host", async () => {
    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.self-hosted.example",
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "10", lon: "20" }]));
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
    const fetchA = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "1", lon: "1" }]));
    global.fetch = fetchA as unknown as typeof fetch;
    const resultA = await geocodeAddress({ city: "Shared Query City" });
    expect(resultA).toEqual({ lat: 1, lon: 1 });
    expect(fetchA).toHaveBeenCalledTimes(1);

    mockResolveGeocoderUrls.mockResolvedValue({
      photonUrl: "https://photon.komoot.io",
      nominatimUrl: "https://nominatim.instance-b.example",
    });
    const fetchB = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "2", lon: "2" }]));
    global.fetch = fetchB as unknown as typeof fetch;
    const resultB = await geocodeAddress({ city: "Shared Query City" });
    expect(resultB).toEqual({ lat: 2, lon: 2 });
    // A second network call was required — the cache key is not just the
    // query text, so instance B does not see instance A's cached coords.
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("never throws when resolveGeocoderUrls rejects, falls back to default URL", async () => {
    mockResolveGeocoderUrls.mockRejectedValue(
      new Error("DB connection failed"),
    );
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "47.3769", lon: "8.5417" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await geocodeAddress({ city: "Fallback Test City" });
    // Should resolve with coordinates, not throw
    expect(result).toEqual({ lat: 47.3769, lon: 8.5417 });
    // Should have called fetch against the default URL, not rejected
    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  });

  it("honors the NOMINATIM_URL env tier (not the public default) when resolveGeocoderUrls rejects", async () => {
    const realEnv = process.env.NOMINATIM_URL;
    process.env.NOMINATIM_URL = "https://nominatim.env-configured.example";
    try {
      mockResolveGeocoderUrls.mockRejectedValue(
        new Error("DB connection failed"),
      );
      const fetchMock = jest
        .fn()
        .mockResolvedValue(okResponse([{ lat: "5", lon: "6" }]));
      global.fetch = fetchMock as unknown as typeof fetch;
      const result = await geocodeAddress({ city: "Env Fallback City" });
      expect(result).toEqual({ lat: 5, lon: 6 });
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toMatch(
        /^https:\/\/nominatim\.env-configured\.example\/search\?/,
      );
    } finally {
      if (realEnv === undefined) delete process.env.NOMINATIM_URL;
      else process.env.NOMINATIM_URL = realEnv;
    }
  });

  // --- the name as geocode material -------------------------------------
  // Reported by the owner 2026-08-05: "Email einlesen hatte vorhin nicht die
  // Koordinaten aufgelöst". A parsed booking confirmation routinely carries the
  // HOTEL NAME and a city but no street — and the query was built from
  // address/city/country only, so the name (by far the most identifying part)
  // was thrown away. The lookup then either resolved to the city centre or,
  // with no city either, never ran at all.

  it("uses the name when there is no street address — the parsed-email case", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "52.516", lon: "13.379" }]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const out = await geocodeAddress({
      name: "Hotel Adlon Kempinski",
      city: "Berlin",
      country: "DE",
    });

    expect(out).toEqual({ lat: 52.516, lon: 13.379 });
    const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("Hotel Adlon Kempinski");
    expect(url).toContain("Berlin");
  });

  it("geocodes a name-only lodging instead of refusing to look", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "1", lon: "2" }]));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await geocodeAddress({ name: "Schlosshotel Kronberg" })).toEqual({
      lat: 1,
      lon: 2,
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("prefers the street address over the name when both exist (no regression)", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ lat: "3", lon: "4" }]));
    global.fetch = fetchMock as unknown as typeof fetch;

    // Distinct from every other query in this file — the module-level cache
    // lives for the whole process, so a reused address means no fetch at all.
    await geocodeAddress({
      name: "Ferienwohnung",
      address: "Musterweg 42",
      city: "Regressionsstadt",
      country: "CH",
    });

    const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("Musterweg 42");
    // A generic name must not displace a precise street address.
    expect(url).not.toContain("Ferienwohnung");
  });

  it("still returns null with nothing to search for at all", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await geocodeAddress({ name: "  ", address: null, city: null, country: null }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- reverse direction ------------------------------------------------
  // The rule: whatever the input method, always try to FIND and COMPLETE the
  // location. A dropped pin or pasted coordinate pair points the opposite way
  // from a typed address, so it needs the opposite lookup.

  const reverseResponse = (address: unknown) =>
    ({ ok: true, json: async () => ({ address }) }) as unknown as Response;

  it("turns coordinates into address parts", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      reverseResponse({
        road: "Unter den Linden",
        house_number: "77",
        city: "Berlin",
        country: "Deutschland",
      }),
    ) as unknown as typeof fetch;
    expect(await reverseGeocode(52.516, 13.379)).toEqual({
      address: "Unter den Linden 77",
      city: "Berlin",
      country: "Deutschland",
    });
  });

  it("reads the settlement from town/village/municipality, not just city", async () => {
    // Nominatim names the settlement by place type — a village returns no
    // `city` at all, and those are exactly the addresses hardest to type.
    const seen: string[] = [];
    let n = 0;
    for (const key of ["town", "village", "municipality"]) {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          reverseResponse({ [key]: `Place-${key}`, country: "DE" }),
        ) as unknown as typeof fetch;
      // Distinct coordinates per iteration — the cache is keyed on them.
      n += 1;
      const out = await reverseGeocode(60 + n, 20 + n);
      seen.push(out?.city ?? "MISSING");
    }
    expect(seen).toEqual(["Place-town", "Place-village", "Place-municipality"]);
  });

  it("returns null (never throws) when reverse lookup fails or is empty", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await reverseGeocode(10.1, 20.1)).toBeNull();

    global.fetch = jest
      .fn()
      .mockResolvedValue(reverseResponse({})) as unknown as typeof fetch;
    expect(await reverseGeocode(10.2, 20.2)).toBeNull();
  });

  it("rejects out-of-range coordinates without a network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await reverseGeocode(91, 0)).toBeNull();
    expect(await reverseGeocode(0, 181)).toBeNull();
    expect(await reverseGeocode(Number.NaN, 0)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches by rounded coordinate so nudging a pin a few metres is one call", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(reverseResponse({ city: "Cached Town" }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await reverseGeocode(48.1374, 11.575);
    await reverseGeocode(48.137401, 11.575001);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("completes ONLY the empty address fields, never overwriting user text", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      reverseResponse({
        road: "Nominatim Street",
        city: "Nominatim City",
        country: "Nominatim Country",
      }),
    ) as unknown as typeof fetch;

    const out = await completeAddressFromCoordinates({
      lat: 30.1,
      lon: 40.1,
      address: "Hotel Adlon",
      city: "",
      country: null,
    });

    // The typed address survives; only the blanks get filled.
    expect(out).toEqual({
      city: "Nominatim City",
      country: "Nominatim Country",
    });
  });

  it("does not call the geocoder when the address is already complete", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await completeAddressFromCoordinates({
        lat: 1,
        lon: 2,
        address: "A",
        city: "B",
        // A REAL country: the placeholder "C" used to stand here, and it now
        // counts as "present but not a country" — see the next test.
        country: "Schweiz",
      }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A country field that names no country is not complete, however full it
  // looks. An Armani confirmation prints "Burj Khalifa, Downtown Dubai" and
  // never the word "Emirates", so the field held "Dubai" — a city standing in
  // the country filter as its own country. The pin knew better all along.
  it("treats a country field that names no country as missing", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await completeAddressFromCoordinates({
      lat: 25.1972,
      lon: 55.2744,
      address: "Burj Khalifa",
      city: "Dubai",
      country: "Dubai",
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not call the geocoder without coordinates to reverse", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(
      await completeAddressFromCoordinates({ lat: null, lon: null, city: null }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
